import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import { z } from 'zod';
import { scheduleCachePrune } from '@/lib/cacheMaintenance';
import {
  TMDB_BACKDROP_CACHE_DIRECTORY,
  TMDB_CACHE_ROOT,
  TMDB_IMAGE_CACHE_DIRECTORY,
  TMDB_LEGACY_POSTER_CACHE_DIRECTORY,
  TMDB_LIST_CACHE_DIRECTORY,
  TMDB_POSTER_CACHE_DIRECTORY,
  TMDB_SEARCH_CACHE_DIRECTORY,
} from '@/lib/storagePaths';
import type {
  TmdbMovieTicketDetails,
  TmdbTicketCredit,
  TmdbTicketImage,
} from '@/lib/ticketMetadata';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w780';
const TMDB_IMAGE_SOURCE_BASE_URL = 'https://image.tmdb.org/t/p/original';

const DEFAULT_CACHE_TTL_SECONDS = 60 * 30;
const DEFAULT_FETCH_TIMEOUT_MS = 9_000;
const DEFAULT_FETCH_RETRIES = 2;
const DEFAULT_FETCH_RETRY_BASE_MS = 300;
const DEFAULT_TMDB_CACHE_MAX_MB = 768;
const DEFAULT_TMDB_CACHE_MAX_AGE_DAYS = 30;
const TMDB_CACHE_PRUNE_THROTTLE_MS = 5 * 60 * 1000;
const TMDB_TICKET_IMAGE_LANGUAGES =
  'en,null,nb,no,sv,da,de,fr,es,it,pt,ja,ko,zh,ru,pl,tr,fi,is,ar,he,cs,hu,th,el,hi,uk,ro';

export type TmdbMovieListType =
  | 'popular'
  | 'top_rated'
  | 'upcoming'
  | 'now_playing';

export interface TmdbTitleQuery {
  title: string;
  year?: number;
}

const tmdbMovieSchema = z.object({
  id: z.number(),
  title: z.string(),
  release_date: z.string(),
  poster_path: z.string().nullable(),
  backdrop_path: z.string().nullable().optional(),
  overview: z.string(),
  vote_average: z.number(),
  vote_count: z.number(),
  popularity: z.number(),
});

const tmdbMovieListResponseSchema = z.object({
  results: z.array(tmdbMovieSchema),
});

export interface ClubMovie {
  id: number;
  title: string;
  year: number | null;
  releaseDate: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  overview: string;
  voteAverage: number;
  voteCount: number;
  popularity: number;
}

const tmdbImageEntrySchema = z.object({
  file_path: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  vote_average: z.number().optional().default(0),
  vote_count: z.number().optional().default(0),
});

const tmdbMovieImagesResponseSchema = z.object({
  backdrops: z.array(tmdbImageEntrySchema).default([]),
  posters: z.array(tmdbImageEntrySchema).default([]),
});

const tmdbTicketImageSchema = z.object({
  file_path: z.string().min(1),
  iso_639_1: z.string().nullable().optional().default(null),
  width: z.number().int().nonnegative().optional().default(0),
  height: z.number().int().nonnegative().optional().default(0),
  vote_average: z.number().optional().default(0),
  vote_count: z.number().optional().default(0),
});

const tmdbTicketCreditsSchema = z.object({
  crew: z
    .array(
      z.object({
        job: z.string(),
        name: z.string(),
      }),
    )
    .default([]),
});

const tmdbTicketImagesSchema = z.object({
  logos: z.array(tmdbTicketImageSchema).default([]),
  backdrops: z.array(tmdbTicketImageSchema).default([]),
  posters: z.array(tmdbTicketImageSchema).default([]),
});

const tmdbMovieTicketResponseSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  release_date: z.string().optional().default(''),
  original_language: z.string().nullable().optional().default(null),
  poster_path: z.string().nullable().optional().default(null),
  backdrop_path: z.string().nullable().optional().default(null),
  credits: tmdbTicketCreditsSchema.optional().default({ crew: [] }),
  images: tmdbTicketImagesSchema
    .optional()
    .default({ logos: [], backdrops: [], posters: [] }),
});

const tmdbVideoSchema = z.object({
  key: z.string().min(1),
  site: z.string(),
  type: z.string(),
  official: z.boolean().optional().default(false),
});

const tmdbMovieVideosResponseSchema = z.object({
  results: z.array(tmdbVideoSchema).default([]),
});

export type TmdbVideoOption = z.infer<typeof tmdbVideoSchema>;

export interface TmdbMovieImageOption {
  kind: 'poster' | 'backdrop';
  sourceUrl: string;
  previewUrl: string;
  width: number;
  height: number;
  voteAverage: number;
  voteCount: number;
}

export interface TmdbMovieImages {
  posters: TmdbMovieImageOption[];
  backdrops: TmdbMovieImageOption[];
}

const fileExists = async (absolutePath: string): Promise<boolean> => {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
};

const parsePositiveIntEnv = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return Math.floor(parsed);
};

const getCacheTtlSeconds = (): number =>
  parsePositiveIntEnv(process.env.TMDB_LIST_CACHE_TTL_SECONDS) ??
  DEFAULT_CACHE_TTL_SECONDS;

const getFetchTimeoutMs = (): number =>
  parsePositiveIntEnv(process.env.TMDB_FETCH_TIMEOUT_MS) ??
  DEFAULT_FETCH_TIMEOUT_MS;

const getFetchRetries = (): number =>
  Math.min(
    5,
    parsePositiveIntEnv(process.env.TMDB_FETCH_RETRIES) ?? DEFAULT_FETCH_RETRIES
  );

const getFetchRetryBaseMs = (): number =>
  parsePositiveIntEnv(process.env.TMDB_FETCH_RETRY_BASE_MS) ??
  DEFAULT_FETCH_RETRY_BASE_MS;

const getTmdbCacheMaxBytes = (): number =>
  (parsePositiveIntEnv(process.env.TMDB_CACHE_MAX_MB) ?? DEFAULT_TMDB_CACHE_MAX_MB) *
  1024 *
  1024;

const getTmdbCacheMaxAgeMs = (): number =>
  (parsePositiveIntEnv(process.env.TMDB_CACHE_MAX_AGE_DAYS) ??
    DEFAULT_TMDB_CACHE_MAX_AGE_DAYS) *
  24 *
  60 *
  60 *
  1000;

const getListCachePath = (listType: TmdbMovieListType, page: number): string =>
  path.join(TMDB_LIST_CACHE_DIRECTORY, `${listType}-page-${page}.json`);

const getSearchCachePath = (title: string, year?: number): string => {
  const key = `${title.trim().toLowerCase()}::${year ?? ''}`;
  const hash = createHash('sha1').update(key).digest('hex');
  return path.join(TMDB_SEARCH_CACHE_DIRECTORY, `${hash}.json`);
};

const getImagesCachePath = (movieId: number): string =>
  path.join(TMDB_IMAGE_CACHE_DIRECTORY, `movie-${movieId}-images.json`);

const getTicketDetailsCachePath = (movieId: number): string =>
  path.join(TMDB_CACHE_ROOT, 'tickets', `movie-${movieId}-details.json`);

const readFreshCache = async <T>(
  cachePath: string,
  payloadSchema: z.ZodType<T>
): Promise<T | null> => {
  if (!(await fileExists(cachePath))) {
    return null;
  }

  const raw = await fs.readFile(cachePath, 'utf8');
  const parsedRaw: unknown = JSON.parse(raw);

  const entrySchema = z.object({
    cachedAt: z.string(),
    payload: payloadSchema,
  });

  const parsed = entrySchema.parse(parsedRaw);

  const ageMs = Date.now() - new Date(parsed.cachedAt).getTime();
  const ttlMs = getCacheTtlSeconds() * 1000;

  if (ageMs > ttlMs) {
    return null;
  }

  return parsed.payload ?? null;
};

const writeCache = async <T>(cachePath: string, payload: T): Promise<void> => {
  await fs.mkdir(path.dirname(cachePath), { recursive: true });

  const content = {
    cachedAt: new Date().toISOString(),
    payload,
  };

  await fs.writeFile(cachePath, JSON.stringify(content), 'utf8');

  scheduleCachePrune(TMDB_CACHE_ROOT, {
    maxBytes: getTmdbCacheMaxBytes(),
    maxAgeMs: getTmdbCacheMaxAgeMs(),
    throttleMs: TMDB_CACHE_PRUNE_THROTTLE_MS,
  });
};

const mapTmdbMovieToClubMovie = (
  movie: z.infer<typeof tmdbMovieSchema>
): ClubMovie => ({
  id: movie.id,
  title: movie.title,
  year: movie.release_date ? Number(movie.release_date.slice(0, 4)) : null,
  releaseDate: movie.release_date,
  posterUrl: movie.poster_path ? `${TMDB_IMAGE_BASE_URL}${movie.poster_path}` : null,
  backdropUrl: movie.backdrop_path
    ? `${TMDB_IMAGE_BASE_URL}${movie.backdrop_path}`
    : null,
  overview: movie.overview,
  voteAverage: movie.vote_average,
  voteCount: movie.vote_count,
  popularity: movie.popularity,
});

const mapTmdbResponseToMovies = (
  data: z.infer<typeof tmdbMovieListResponseSchema>
): ClubMovie[] => data.results.map(mapTmdbMovieToClubMovie);

const getPosterExtension = (posterUrl: string, contentType: string): string => {
  const urlPathExt = path.extname(new URL(posterUrl).pathname).toLowerCase();
  if (urlPathExt === '.jpg' || urlPathExt === '.jpeg' || urlPathExt === '.png') {
    return urlPathExt;
  }

  if (contentType.includes('png')) {
    return '.png';
  }

  return '.jpg';
};

type TmdbAuthMode = 'api-key' | 'read-token';

type TmdbAuth = {
  mode: TmdbAuthMode;
  token: string;
};

const resolveTmdbAuth = (): TmdbAuth => {
  const apiKey = process.env.TMDB_API_KEY?.trim();
  if (apiKey) {
    return { mode: 'api-key', token: apiKey };
  }

  const readToken =
    process.env.TMDB_READ_ACCESS_TOKEN?.trim() ??
    process.env.TMDB_READ_TOKEN?.trim();
  if (readToken) {
    return { mode: 'read-token', token: readToken };
  }

  throw new Error(
    'TMDB API access mangler. Sett TMDB_API_KEY eller TMDB_READ_ACCESS_TOKEN i .env.'
  );
};

const createTmdbRequest = (url: URL): { url: string; requestInit?: RequestInit } => {
  const auth = resolveTmdbAuth();

  if (auth.mode === 'api-key') {
    url.searchParams.set('api_key', auth.token);
    return { url: url.toString() };
  }

  return {
    url: url.toString(),
    requestInit: {
      headers: {
        accept: 'application/json',
        Authorization: `Bearer ${auth.token}`,
      },
    },
  };
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const withTimeoutSignal = (
  requestInit: RequestInit | undefined,
  timeoutMs: number
): { requestInit: RequestInit; cleanup: () => void } => {
  const controller = new AbortController();
  const externalSignal = requestInit?.signal;

  const onAbort = () => {
    controller.abort();
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onAbort);
    }
  }

  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  return {
    requestInit: {
      ...(requestInit ?? {}),
      signal: controller.signal,
    },
    cleanup: () => {
      clearTimeout(timeout);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onAbort);
      }
    },
  };
};

const isRetriableStatus = (status: number): boolean =>
  status === 408 || status === 429 || status >= 500;

const isRetriableError = (error: unknown): boolean => {
  if (error instanceof Error && error.name === 'AbortError') {
    return true;
  }

  return error instanceof TypeError;
};

const fetchWithRetry = async (
  requestUrl: string,
  requestInit?: RequestInit
): Promise<Response> => {
  const retries = getFetchRetries();
  const timeoutMs = getFetchTimeoutMs();
  const retryBaseMs = getFetchRetryBaseMs();

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const { requestInit: timedInit, cleanup } = withTimeoutSignal(requestInit, timeoutMs);
    try {
      const response = await fetch(requestUrl, timedInit);

      if (response.ok || attempt === retries || !isRetriableStatus(response.status)) {
        return response;
      }

      void response.body?.cancel();
    } catch (error) {
      if (attempt === retries || !isRetriableError(error)) {
        throw error;
      }
    } finally {
      cleanup();
    }

    const jitter = Math.floor(Math.random() * retryBaseMs * 0.35);
    const backoffMs = retryBaseMs * Math.pow(2, attempt) + jitter;
    await sleep(backoffMs);
  }

  throw new Error('TMDB request failed after retries.');
};

const normalizeTitle = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const scoreSearchCandidate = (
  movie: z.infer<typeof tmdbMovieSchema>,
  query: TmdbTitleQuery
): number => {
  const queryTitle = normalizeTitle(query.title);
  const movieTitle = normalizeTitle(movie.title);

  let score = 0;

  if (movieTitle === queryTitle) {
    score += 1000;
  }

  if (movieTitle.includes(queryTitle) || queryTitle.includes(movieTitle)) {
    score += 300;
  }

  if (query.year && movie.release_date) {
    const movieYear = Number(movie.release_date.slice(0, 4));
    if (Number.isFinite(movieYear)) {
      const delta = Math.abs(movieYear - query.year);
      score += Math.max(0, 200 - delta * 40);
    }
  }

  score += Math.min(movie.vote_count / 10, 200);
  score += Math.min(movie.popularity / 10, 100);

  return score;
};

const fetchTmdbSearchResults = async (
  query: TmdbTitleQuery
): Promise<z.infer<typeof tmdbMovieListResponseSchema>> => {
  const cachePath = getSearchCachePath(query.title, query.year);
  const cached = await readFreshCache(cachePath, tmdbMovieListResponseSchema);
  if (cached) {
    return cached;
  }

  const url = new URL(`${TMDB_BASE_URL}/search/movie`);

  url.searchParams.set('language', 'en-US');
  url.searchParams.set('include_adult', 'false');
  url.searchParams.set('query', query.title);
  if (query.year) {
    url.searchParams.set('year', String(query.year));
  }

  const { url: requestUrl, requestInit } = createTmdbRequest(url);
  const response = await fetchWithRetry(requestUrl, requestInit);
  if (!response.ok) {
    throw new Error(`TMDB search error (${response.status})`);
  }

  const rawData: unknown = await response.json();
  const data = tmdbMovieListResponseSchema.parse(rawData);
  await writeCache(cachePath, data);

  return data;
};

const searchTmdbMovie = async (query: TmdbTitleQuery): Promise<ClubMovie | null> => {
  const data = await fetchTmdbSearchResults(query);
  if (data.results.length === 0) {
    return null;
  }

  const sorted = [...data.results].sort(
    (a, b) => scoreSearchCandidate(b, query) - scoreSearchCandidate(a, query)
  );

  const bestMatch = sorted[0];
  if (!bestMatch) {
    return null;
  }

  return mapTmdbMovieToClubMovie(bestMatch);
};

export const hasTmdbApiKey = (): boolean => {
  const apiKey = process.env.TMDB_API_KEY?.trim();
  const readToken =
    process.env.TMDB_READ_ACCESS_TOKEN?.trim() ??
    process.env.TMDB_READ_TOKEN?.trim();

  return Boolean((apiKey?.length ?? 0) > 0 || (readToken?.length ?? 0) > 0);
};

export const getTmdbMovieList = async (
  listType: TmdbMovieListType,
  page = 1
): Promise<ClubMovie[]> => {
  const cachePath = getListCachePath(listType, page);
  const cached = await readFreshCache(cachePath, tmdbMovieListResponseSchema);
  if (cached) {
    return mapTmdbResponseToMovies(cached);
  }

  const url = new URL(`${TMDB_BASE_URL}/movie/${listType}`);

  url.searchParams.set('language', 'en-US');
  url.searchParams.set('page', String(page));

  const { url: requestUrl, requestInit } = createTmdbRequest(url);
  const response = await fetchWithRetry(requestUrl, requestInit);
  if (!response.ok) {
    throw new Error(`TMDB API error (${response.status})`);
  }

  const rawData: unknown = await response.json();
  const data = tmdbMovieListResponseSchema.parse(rawData);

  await writeCache(cachePath, data);

  return mapTmdbResponseToMovies(data);
};

export const getTmdbMoviesByTitleQueries = async (
  queries: TmdbTitleQuery[]
): Promise<ClubMovie[]> => {
  const output: ClubMovie[] = [];

  for (const query of queries) {
    const movie = await searchTmdbMovie(query);
    if (movie) {
      output.push(movie);
    }
  }

  return output;
};

export const getTmdbMoviesBySearchQuery = async (
  query: string,
  limit = 8
): Promise<ClubMovie[]> => {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return [];
  }

  const cappedLimit = Math.max(1, Math.min(Math.floor(limit), 20));
  const data = await fetchTmdbSearchResults({ title: trimmedQuery });
  const scored = [...data.results].sort(
    (a, b) =>
      scoreSearchCandidate(b, { title: trimmedQuery }) -
      scoreSearchCandidate(a, { title: trimmedQuery })
  );

  const output: ClubMovie[] = [];
  const seen = new Set<number>();

  for (const movie of scored) {
    if (seen.has(movie.id)) {
      continue;
    }

    seen.add(movie.id);
    output.push(mapTmdbMovieToClubMovie(movie));

    if (output.length >= cappedLimit) {
      break;
    }
  }

  return output;
};

export const getTmdbMovieById = async (
  movieId: number
): Promise<ClubMovie | null> => {
  if (!Number.isFinite(movieId) || movieId <= 0) {
    return null;
  }

  const url = new URL(`${TMDB_BASE_URL}/movie/${Math.floor(movieId)}`);
  url.searchParams.set('language', 'en-US');

  const { url: requestUrl, requestInit } = createTmdbRequest(url);
  const response = await fetchWithRetry(requestUrl, requestInit);
  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`TMDB movie lookup error (${response.status})`);
  }

  const rawData: unknown = await response.json();
  const parsed = tmdbMovieSchema.parse(rawData);
  return mapTmdbMovieToClubMovie(parsed);
};

const mapTmdbTicketImage = (
  image: z.infer<typeof tmdbTicketImageSchema>
): TmdbTicketImage => ({
  filePath: image.file_path,
  language: image.iso_639_1 ?? null,
  width: image.width,
  height: image.height,
  voteAverage: image.vote_average,
  voteCount: image.vote_count,
});

const mapTmdbTicketCredit = (
  credit: z.infer<typeof tmdbTicketCreditsSchema>['crew'][number]
): TmdbTicketCredit => ({
  job: credit.job,
  name: credit.name,
});

const mapTmdbTicketDetails = (
  details: z.infer<typeof tmdbMovieTicketResponseSchema>
): TmdbMovieTicketDetails => ({
  id: details.id,
  title: details.title,
  releaseDate: details.release_date,
  originalLanguage: details.original_language,
  posterPath: details.poster_path,
  backdropPath: details.backdrop_path,
  credits: {
    crew: details.credits.crew.map(mapTmdbTicketCredit),
  },
  images: {
    logos: details.images.logos.map(mapTmdbTicketImage),
    backdrops: details.images.backdrops.map(mapTmdbTicketImage),
    posters: details.images.posters.map(mapTmdbTicketImage),
  },
});

const fetchTmdbMovieTicketDetails = async (
  movieId: number
): Promise<TmdbMovieTicketDetails | null> => {
  const cachePath = getTicketDetailsCachePath(movieId);
  let cached: z.infer<typeof tmdbMovieTicketResponseSchema> | null;

  try {
    cached = (await readFreshCache(
      cachePath,
      tmdbMovieTicketResponseSchema
    )) as z.infer<typeof tmdbMovieTicketResponseSchema> | null;
  } catch {
    // Ignore an invalid cache entry and refresh it from TMDB.
    cached = null;
  }

  if (cached) {
    return mapTmdbTicketDetails(cached);
  }

  const url = new URL(`${TMDB_BASE_URL}/movie/${movieId}`);
  url.searchParams.set('language', 'en-US');
  url.searchParams.set('append_to_response', 'credits,images');
  url.searchParams.set('include_image_language', TMDB_TICKET_IMAGE_LANGUAGES);

  const { url: requestUrl, requestInit } = createTmdbRequest(url);
  const response = await fetchWithRetry(requestUrl, requestInit);
  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`TMDB ticket metadata error (${response.status})`);
  }

  const rawData: unknown = await response.json();
  const parsed = tmdbMovieTicketResponseSchema.parse(rawData);
  const details = mapTmdbTicketDetails(parsed);

  try {
    await writeCache(cachePath, parsed);
  } catch {
    // A cache write is best effort; keep the successful upstream response.
  }

  return details;
};

const tmdbTicketRequests = new Map<
  number,
  Promise<TmdbMovieTicketDetails | null>
>();

/** Fetch one movie's ticket fields with bounded, cached, deduplicated I/O. */
export const getTmdbMovieTicketDetails = async (
  movieId: number
): Promise<TmdbMovieTicketDetails | null> => {
  if (!Number.isSafeInteger(movieId) || movieId <= 0) {
    return null;
  }

  const existing = tmdbTicketRequests.get(movieId);
  if (existing) {
    return existing;
  }

  const request = fetchTmdbMovieTicketDetails(movieId);
  tmdbTicketRequests.set(movieId, request);

  try {
    return await request;
  } finally {
    if (tmdbTicketRequests.get(movieId) === request) {
      tmdbTicketRequests.delete(movieId);
    }
  }
};

export const selectTmdbYoutubeTrailer = (
  videos: readonly TmdbVideoOption[]
): string | null => {
  const candidates = videos.filter(
    (video) => video.site.toLowerCase() === 'youtube' && video.key.trim()
  );

  const selected = [...candidates].sort((first, second) => {
    const score = (video: TmdbVideoOption): number =>
      (video.type.toLowerCase() === 'trailer' ? 4 : 0) +
      (video.official ? 2 : 0);

    return score(second) - score(first);
  })[0];

  return selected?.key ?? null;
};

export const getTmdbMovieTrailerYoutubeId = async (
  movieId: number
): Promise<string | null> => {
  if (!Number.isFinite(movieId) || movieId <= 0) {
    return null;
  }

  const url = new URL(`${TMDB_BASE_URL}/movie/${Math.floor(movieId)}/videos`);
  url.searchParams.set('language', 'en-US');

  const { url: requestUrl, requestInit } = createTmdbRequest(url);
  const response = await fetchWithRetry(requestUrl, requestInit);
  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`TMDB trailer lookup error (${response.status})`);
  }

  const rawData: unknown = await response.json();
  const parsed = tmdbMovieVideosResponseSchema.parse(rawData);
  const englishTrailer = selectTmdbYoutubeTrailer(parsed.results);
  if (englishTrailer) return englishTrailer;

  // TMDB filters videos by language. A missing English trailer does not
  // mean the film has no trailer (for example Ju-on: The Curse).
  const detailsUrl = new URL(`${TMDB_BASE_URL}/movie/${Math.floor(movieId)}`);
  const detailsRequest = createTmdbRequest(detailsUrl);
  const detailsResponse = await fetchWithRetry(
    detailsRequest.url, detailsRequest.requestInit
  );
  if (!detailsResponse.ok) return null;
  const details = z.object({
    original_language: z.string().nullable().optional(),
  }).parse(await detailsResponse.json());
  const language = details.original_language;
  if (!language || language === 'en' || !/^[a-z]{2}$/.test(language)) return null;

  url.searchParams.set('language', language);
  const nativeRequest = createTmdbRequest(url);
  const nativeResponse = await fetchWithRetry(
    nativeRequest.url, nativeRequest.requestInit
  );
  if (!nativeResponse.ok) return null;
  const nativeVideos = tmdbMovieVideosResponseSchema.parse(
    await nativeResponse.json()
  );
  return selectTmdbYoutubeTrailer(nativeVideos.results);
};

const toMovieImageOption = (
  image: z.infer<typeof tmdbImageEntrySchema>,
  kind: 'poster' | 'backdrop'
): TmdbMovieImageOption => ({
  kind,
  sourceUrl: `${TMDB_IMAGE_SOURCE_BASE_URL}${image.file_path}`,
  previewUrl: `${TMDB_IMAGE_BASE_URL}${image.file_path}`,
  width: image.width,
  height: image.height,
  voteAverage: image.vote_average ?? 0,
  voteCount: image.vote_count ?? 0,
});

export const getTmdbMovieImages = async (
  movieId: number,
  limit = 24,
  options?: { useCache?: boolean }
): Promise<TmdbMovieImages> => {
  if (!Number.isFinite(movieId) || movieId <= 0) {
    return {
      posters: [],
      backdrops: [],
    };
  }

  const normalizedId = Math.floor(movieId);
  const cappedLimit = Math.max(1, Math.min(Math.floor(limit), 60));
  const useCache = options?.useCache ?? true;
  const cachePath = getImagesCachePath(normalizedId);
  const cached = useCache
    ? await readFreshCache(cachePath, tmdbMovieImagesResponseSchema)
    : null;

  let payload: z.infer<typeof tmdbMovieImagesResponseSchema>;
  if (cached) {
    payload = tmdbMovieImagesResponseSchema.parse(cached);
  } else {
    const url = new URL(`${TMDB_BASE_URL}/movie/${normalizedId}/images`);
    url.searchParams.set(
      'include_image_language',
      'null,en,nb,no,sv,da,de,fr,es,it,pt,ja,ko,zh,ru,pl,tr'
    );

    const { url: requestUrl, requestInit } = createTmdbRequest(url);
    const response = await fetchWithRetry(requestUrl, requestInit);
    if (!response.ok) {
      throw new Error(`TMDB images error (${response.status})`);
    }

    const rawData: unknown = await response.json();
    payload = tmdbMovieImagesResponseSchema.parse(rawData);
    if (useCache) {
      await writeCache(cachePath, payload);
    }
  }

  const sortByRank = (
    left: z.infer<typeof tmdbImageEntrySchema>,
    right: z.infer<typeof tmdbImageEntrySchema>
  ): number =>
    (right.vote_count ?? 0) - (left.vote_count ?? 0) ||
    (right.vote_average ?? 0) - (left.vote_average ?? 0) ||
    right.width * right.height - left.width * left.height;

  const posters = [...payload.posters]
    .sort(sortByRank)
    .slice(0, cappedLimit)
    .map((image) => toMovieImageOption(image, 'poster'));

  const backdrops = [...payload.backdrops]
    .sort(sortByRank)
    .slice(0, cappedLimit)
    .map((image) => toMovieImageOption(image, 'backdrop'));

  return {
    posters,
    backdrops,
  };
};

export const getCachedTmdbImagePath = async (
  movieId: number,
  imageUrl: string,
  imageKind: 'poster' | 'backdrop' = 'poster'
): Promise<string> => {
  const imageCacheDirectory =
    imageKind === 'backdrop'
      ? TMDB_BACKDROP_CACHE_DIRECTORY
      : TMDB_POSTER_CACHE_DIRECTORY;

  await fs.mkdir(imageCacheDirectory, { recursive: true });

  const hash = createHash('sha1').update(imageUrl).digest('hex').slice(0, 12);
  const filePrefix = `${movieId}-${imageKind}-${hash}.`;
  const lookupDirectories = [imageCacheDirectory];
  if (TMDB_LEGACY_POSTER_CACHE_DIRECTORY !== imageCacheDirectory) {
    lookupDirectories.push(TMDB_LEGACY_POSTER_CACHE_DIRECTORY);
  }

  for (const directory of lookupDirectories) {
    try {
      const possibleFiles = await fs.readdir(directory);
      const existing = possibleFiles.find((name) => name.startsWith(filePrefix));
      if (existing) {
        return path.join(directory, existing);
      }
    } catch {
      // Ignore missing cache directories and keep searching.
    }
  }

  const response = await fetchWithRetry(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch TMDB ${imageKind} (${response.status})`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.startsWith('image/')) {
    throw new Error('TMDB poster URL did not return an image.');
  }

  const extension = getPosterExtension(imageUrl, contentType);
  const fileName = `${movieId}-${imageKind}-${hash}${extension}`;
  const absolutePath = path.join(imageCacheDirectory, fileName);

  const posterBuffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(absolutePath, posterBuffer);

  scheduleCachePrune(TMDB_CACHE_ROOT, {
    maxBytes: getTmdbCacheMaxBytes(),
    maxAgeMs: getTmdbCacheMaxAgeMs(),
    throttleMs: TMDB_CACHE_PRUNE_THROTTLE_MS,
  });

  return absolutePath;
};

export const getCachedTmdbPosterPath = async (
  movieId: number,
  posterUrl: string
): Promise<string> => getCachedTmdbImagePath(movieId, posterUrl, 'poster');
