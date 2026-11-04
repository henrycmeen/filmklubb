import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAppleTrailersUrl,
  buildWikidataAppleIdQuery,
  createAppleTrailerLookup,
  isAppleTrailerHlsUrl,
  parseAppleTrailerHlsUrl,
  parseWikidataAppleId,
  APPLE_STOREFRONTS,
} from "@/lib/appleTrailer";

const APPLE_ID = "umc.cmc.363aycnv6vy9qgekvew6fveb9";
const HLS_URL =
  "https://play-edge.itunes.apple.com/WebObjects/MZPlayLocal.woa/hls/playlist.m3u8?cc=NO&a=1725365997&id=789866031&l=nb-NO&aec=HD";

const wikidataAnswer = (apple?: string) => ({
  head: { vars: ["apple"] },
  results: {
    bindings: apple ? [{ apple: { type: "literal", value: apple } }] : [],
  },
});

const shelfAnswer = (
  hlsUrl: string,
  utsk = "6e3013c6d6fae3c2::::::235656c069bb0efb",
) => ({
  data: {
    shelf: {
      items: [
        {
          localizedType: "Trailer",
          playables: [
            { assets: { hlsUrl, fpsKeyServerUrl: "https://example" } },
          ],
        },
      ],
    },
  },
  utsk,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

void test("queries Wikidata by TMDB id for the Apple TV movie id", () => {
  assert.equal(
    buildWikidataAppleIdQuery(693134),
    'SELECT ?apple WHERE { ?item wdt:P4947 "693134" ; wdt:P9586 ?apple . } LIMIT 5',
  );
  assert.equal(parseWikidataAppleId(wikidataAnswer(APPLE_ID)), APPLE_ID);
  assert.equal(parseWikidataAppleId(wikidataAnswer("not-an-id")), null);
  assert.equal(parseWikidataAppleId(wikidataAnswer()), null);
  assert.equal(parseWikidataAppleId("<html>"), null);
});

void test("accepts only Apple's HLS host for trailer streams", () => {
  assert.equal(isAppleTrailerHlsUrl(HLS_URL), true);
  assert.equal(
    isAppleTrailerHlsUrl("http://play-edge.itunes.apple.com/x.m3u8"),
    false,
  );
  assert.equal(
    isAppleTrailerHlsUrl(
      "https://evil.example/play-edge.itunes.apple.com.m3u8",
    ),
    false,
  );
  assert.equal(
    isAppleTrailerHlsUrl("https://play-edge.itunes.apple.com/x.mp4"),
    false,
  );
  assert.equal(parseAppleTrailerHlsUrl(shelfAnswer(HLS_URL)), HLS_URL);
  assert.equal(
    parseAppleTrailerHlsUrl(shelfAnswer("https://evil.example/a.m3u8")),
    null,
  );
  assert.equal(parseAppleTrailerHlsUrl({ data: {} }), null);
});

void test("builds the trailer shelf request for a storefront", () => {
  const url = new URL(
    buildAppleTrailersUrl(APPLE_ID, APPLE_STOREFRONTS[0], "key"),
  );
  assert.equal(url.pathname, `/uts/v3/mcp/trailers/${APPLE_ID}`);
  assert.equal(url.searchParams.get("sf"), "143457");
  assert.equal(url.searchParams.get("locale"), "nb-NO");
  assert.equal(url.searchParams.get("utsk"), "key");
});

const createLookup = (answers: Array<Response | Error>) => {
  const calls: string[] = [];
  let now = 0;
  const lookup = createAppleTrailerLookup({
    fetch: (input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      calls.push(url);
      const answer = answers.shift();
      if (!answer) throw new Error(`Unexpected request ${url}`);
      return answer instanceof Error
        ? Promise.reject(answer)
        : Promise.resolve(answer);
    },
    now: () => now,
    timeoutMs: 1_000,
  });
  return {
    calls,
    lookup,
    advance: (ms: number) => {
      now += ms;
    },
  };
};

void test("falls back to the US store and caches the trailer", async () => {
  const { calls, lookup } = createLookup([
    json(wikidataAnswer(APPLE_ID)),
    new Response("400:Shelf not found", { status: 400 }),
    json(shelfAnswer(HLS_URL)),
  ]);

  assert.equal(await lookup(693134), HLS_URL);
  assert.equal(calls.length, 3);
  assert.match(calls[1] ?? "", /sf=143457/);
  assert.match(calls[2] ?? "", /sf=143441/);
  assert.equal(await lookup(693134), HLS_URL);
  assert.equal(calls.length, 3);
});

void test("adopts the utsk Apple returns for later requests", async () => {
  const { calls, lookup } = createLookup([
    json(wikidataAnswer(APPLE_ID)),
    json(shelfAnswer(HLS_URL, "abcdef0123456789::::::0123456789abcdef")),
    json(wikidataAnswer("umc.cmc.5j8t2blurpxgpnxeqtm15n8i1")),
    json(shelfAnswer(HLS_URL)),
  ]);

  await lookup(1);
  await lookup(2);
  assert.match(
    calls[3] ?? "",
    /utsk=abcdef0123456789%3A%3A%3A%3A%3A%3A0123456789abcdef/,
  );
});

void test("films without an Apple id do not ask Apple", async () => {
  const { calls, lookup } = createLookup([json(wikidataAnswer())]);
  assert.equal(await lookup(42), null);
  assert.equal(calls.length, 1);
});

void test("a failed lookup is retried after a short pause", async () => {
  const { calls, lookup, advance } = createLookup([
    new TypeError("fetch failed"),
    json(wikidataAnswer(APPLE_ID)),
    json(shelfAnswer(HLS_URL)),
  ]);

  assert.equal(await lookup(7), null);
  assert.equal(await lookup(7), null);
  assert.equal(calls.length, 1);
  advance(2 * 60 * 1000 + 1);
  assert.equal(await lookup(7), HLS_URL);
});

void test("an overloaded Apple API counts as a failed lookup", async () => {
  const { lookup, calls, advance } = createLookup([
    json(wikidataAnswer(APPLE_ID)),
    new Response("busy", { status: 503 }),
  ]);
  assert.equal(await lookup(9), null);
  advance(60 * 1000);
  assert.equal(await lookup(9), null);
  assert.equal(calls.length, 2);
});

void test("shares one lookup between simultaneous requests", async () => {
  const { calls, lookup } = createLookup([
    json(wikidataAnswer(APPLE_ID)),
    json(shelfAnswer(HLS_URL)),
  ]);
  const [first, second] = await Promise.all([lookup(5), lookup(5)]);
  assert.equal(first, HLS_URL);
  assert.equal(second, HLS_URL);
  assert.equal(calls.length, 2);
});

void test("ignores ids that are not TMDB ids", async () => {
  const { calls, lookup } = createLookup([]);
  assert.equal(await lookup(0), null);
  assert.equal(await lookup(1.5), null);
  assert.equal(calls.length, 0);
});
