// Apple's own trailers are plain HLS streams without DRM. The path is:
// TMDB id -> Wikidata "Apple TV movie ID" (P9586) -> Apple's trailer shelf.
// Apple's trailer API is unofficial, so every failure is a missing trailer
// and the caller keeps YouTube as the fallback.

const WIKIDATA_SPARQL_URL = "https://query.wikidata.org/sparql";
const APPLE_TRAILERS_URL =
  "https://uts-api.itunes.apple.com/uts/v3/mcp/trailers/";
const APPLE_HLS_HOST = "play-edge.itunes.apple.com";
const USER_AGENT =
  "Filmklubben/1.0 (+https://github.com/henrycmeen/my-letterboxd)";

// Public web-client parameters from tv.apple.com. Apple accepts an outdated
// utsk and returns the current one, which later requests then use.
const APPLE_UTSCF = "OjAAAAEAAAAAAAMAEAAAACMAKwAtADgA";
const DEFAULT_APPLE_UTSK = "6e3013c6d6fae3c2::::::235656c069bb0efb";

// The Norwegian store first (Norwegian titles), then the US store, which has
// some trailers Norway lacks.
export const APPLE_STOREFRONTS = [
  { storefront: "143457", locale: "nb-NO" },
  { storefront: "143441", locale: "en-US" },
] as const;

const FOUND_TTL_MS = 12 * 60 * 60 * 1000;
const MISSING_TTL_MS = 6 * 60 * 60 * 1000;
const FAILED_TTL_MS = 2 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const MAX_RESPONSE_BYTES = 512 * 1024;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isAppleTvMovieId = (value: unknown): value is string =>
  typeof value === "string" && /^umc\.cmc\.[a-z0-9]{8,40}$/.test(value);

export const buildWikidataAppleIdQuery = (tmdbId: number): string =>
  `SELECT ?apple WHERE { ?item wdt:P4947 "${Math.floor(tmdbId)}" ; wdt:P9586 ?apple . } LIMIT 5`;

export const parseWikidataAppleId = (payload: unknown): string | null => {
  if (!isRecord(payload) || !isRecord(payload.results)) return null;
  const bindings = payload.results.bindings;
  if (!Array.isArray(bindings)) return null;
  for (const binding of bindings) {
    if (!isRecord(binding) || !isRecord(binding.apple)) continue;
    const value = binding.apple.value;
    if (isAppleTvMovieId(value)) return value;
  }
  return null;
};

export const isAppleTrailerHlsUrl = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === APPLE_HLS_HOST &&
      url.pathname.endsWith(".m3u8")
    );
  } catch {
    return false;
  }
};

// The shelf lists the film's main trailer first.
export const parseAppleTrailerHlsUrl = (payload: unknown): string | null => {
  if (!isRecord(payload) || !isRecord(payload.data)) return null;
  const shelf = payload.data.shelf;
  if (!isRecord(shelf) || !Array.isArray(shelf.items)) return null;
  for (const item of shelf.items) {
    if (!isRecord(item) || !Array.isArray(item.playables)) continue;
    for (const playable of item.playables) {
      if (!isRecord(playable) || !isRecord(playable.assets)) continue;
      const hlsUrl = playable.assets.hlsUrl;
      if (isAppleTrailerHlsUrl(hlsUrl)) return hlsUrl;
    }
  }
  return null;
};

export const parseAppleUtsk = (payload: unknown): string | null => {
  const utsk = isRecord(payload) ? payload.utsk : null;
  return typeof utsk === "string" && /^[0-9a-f:]{8,120}$/i.test(utsk)
    ? utsk
    : null;
};

export const buildAppleTrailersUrl = (
  appleId: string,
  storefront: (typeof APPLE_STOREFRONTS)[number],
  utsk: string,
): string => {
  const url = new URL(`${APPLE_TRAILERS_URL}${appleId}`);
  url.searchParams.set("utscf", APPLE_UTSCF);
  url.searchParams.set("utsk", utsk);
  url.searchParams.set("caller", "web");
  url.searchParams.set("sf", storefront.storefront);
  url.searchParams.set("v", "101");
  url.searchParams.set("pfm", "web");
  url.searchParams.set("locale", storefront.locale);
  return url.toString();
};

class TransientLookupError extends Error {}

interface LookupDependencies {
  fetch: typeof fetch;
  now: () => number;
  timeoutMs: number;
}

interface CacheEntry {
  hlsUrl: string | null;
  expiresAt: number;
}

export const createAppleTrailerLookup = (dependencies: LookupDependencies) => {
  const cache = new Map<number, CacheEntry>();
  const inFlight = new Map<number, Promise<string | null>>();
  let utsk = DEFAULT_APPLE_UTSK;

  const requestJson = async (
    url: string,
    headers: Record<string, string>,
  ): Promise<{ status: number; body: unknown }> => {
    let response: Response;
    let text: string;
    try {
      response = await dependencies.fetch(url, {
        headers,
        signal: AbortSignal.timeout(dependencies.timeoutMs),
      });
      text = await response.text();
    } catch {
      throw new TransientLookupError("Trailer lookup did not answer");
    }
    if (response.status === 429 || response.status >= 500) {
      throw new TransientLookupError(`Trailer lookup error ${response.status}`);
    }
    if (text.length > MAX_RESPONSE_BYTES) return { status: 413, body: null };
    try {
      return { status: response.status, body: JSON.parse(text) as unknown };
    } catch {
      // Apple answers a missing shelf with plain text such as "Shelf not found".
      return { status: response.status, body: null };
    }
  };

  const findAppleId = async (tmdbId: number): Promise<string | null> => {
    const url = new URL(WIKIDATA_SPARQL_URL);
    url.searchParams.set("query", buildWikidataAppleIdQuery(tmdbId));
    url.searchParams.set("format", "json");
    const { status, body } = await requestJson(url.toString(), {
      Accept: "application/sparql-results+json",
      "User-Agent": USER_AGENT,
    });
    return status === 200 ? parseWikidataAppleId(body) : null;
  };

  const findTrailer = async (appleId: string): Promise<string | null> => {
    for (const storefront of APPLE_STOREFRONTS) {
      const { status, body } = await requestJson(
        buildAppleTrailersUrl(appleId, storefront, utsk),
        {
          Accept: "application/json",
          Origin: "https://tv.apple.com",
          Referer: "https://tv.apple.com/",
          "User-Agent": "Mozilla/5.0",
        },
      );
      utsk = parseAppleUtsk(body) ?? utsk;
      const hlsUrl = status === 200 ? parseAppleTrailerHlsUrl(body) : null;
      if (hlsUrl) return hlsUrl;
    }
    return null;
  };

  const remember = (tmdbId: number, hlsUrl: string | null, ttlMs: number) => {
    cache.delete(tmdbId);
    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(tmdbId, { hlsUrl, expiresAt: dependencies.now() + ttlMs });
  };

  return (tmdbId: number): Promise<string | null> => {
    if (!Number.isInteger(tmdbId) || tmdbId <= 0) return Promise.resolve(null);
    const cached = cache.get(tmdbId);
    if (cached && cached.expiresAt > dependencies.now()) {
      return Promise.resolve(cached.hlsUrl);
    }
    const pending = inFlight.get(tmdbId);
    if (pending) return pending;

    const request = (async () => {
      try {
        const appleId = await findAppleId(tmdbId);
        const hlsUrl = appleId ? await findTrailer(appleId) : null;
        remember(tmdbId, hlsUrl, hlsUrl ? FOUND_TTL_MS : MISSING_TTL_MS);
        return hlsUrl;
      } catch {
        remember(tmdbId, null, FAILED_TTL_MS);
        return null;
      } finally {
        inFlight.delete(tmdbId);
      }
    })();
    inFlight.set(tmdbId, request);
    return request;
  };
};

let serverLookup: ((tmdbId: number) => Promise<string | null>) | null = null;

export const getAppleTrailerHlsUrl = (tmdbId: number) => {
  serverLookup ??= createAppleTrailerLookup({
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    timeoutMs: 4_000,
  });
  return serverLookup(tmdbId);
};
