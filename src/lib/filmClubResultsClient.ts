import { z } from "zod";
import { resolveClubSlugParam } from "@/lib/clubSlug";
import { withBasePath } from "@/lib/basePath";

const resultFilmSchema = z
  .object({
    filmId: z.number().int().positive(),
    title: z.string().trim().min(1),
    coverImage: z.string().trim().min(1),
    votes: z.number().int().nonnegative(),
  })
  .strict();

const rankingFilmSchema = resultFilmSchema
  .extend({
    rank: z.number().int().positive(),
    tmdbVoteAverage: z.number().min(0).max(10),
  })
  .strict();

const activeScreeningSchema = z
  .object({
    id: z.string().trim().min(1),
    scheduledAt: z.string().trim().min(1),
  })
  .strict();

const statsSchema = z
  .object({
    totalVotes: z.number().int().nonnegative(),
    participatingDevices: z.number().int().nonnegative(),
    lastVoteAt: z.string().trim().min(1).nullable(),
  })
  .strict();

const historyEntrySchema = z
  .object({
    screeningId: z.string().trim().min(1),
    scheduledAt: z.string().trim().min(1),
    winner: resultFilmSchema,
    totalVotes: z.number().int().nonnegative(),
    participatingDevices: z.number().int().nonnegative(),
  })
  .strict();

const filmClubResultsSchema = z
  .object({
    club: z
      .object({
        id: z.string().trim().min(1),
        name: z.string().trim().min(1),
      })
      .strict(),
    activeScreening: activeScreeningSchema.nullable(),
    ranking: z.array(rankingFilmSchema),
    stats: statsSchema,
    history: z.array(historyEntrySchema),
    revision: z.number().int().nonnegative(),
    generatedAt: z.string().trim().min(1),
  })
  .strict();

export type FilmClubResults = z.infer<typeof filmClubResultsSchema>;
export type FilmClubResultsRankingEntry = FilmClubResults["ranking"][number];
export type FilmClubResultsHistoryEntry = FilmClubResults["history"][number];

export const parseFilmClubResults = (
  value: unknown,
): FilmClubResults | null => {
  const parsed = filmClubResultsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

export const getFilmClubResultsRequestUrl = (
  clubSlug: string | string[] | undefined,
): string => {
  const normalizedClubSlug = resolveClubSlugParam(clubSlug);
  const params = new URLSearchParams({ clubSlug: normalizedClubSlug });
  return withBasePath(`/api/club/results?${params.toString()}`);
};

export const fetchFilmClubResults = async (
  clubSlug: string | string[] | undefined,
  signal?: AbortSignal,
): Promise<FilmClubResults> => {
  const response = await fetch(getFilmClubResultsRequestUrl(clubSlug), {
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });

  if (!response.ok) {
    throw new Error("Resultatene er ikke tilgjengelige akkurat nå.");
  }

  const parsed = parseFilmClubResults(await response.json());
  if (!parsed) {
    throw new Error("Resultatene kom tilbake i et ugyldig format.");
  }

  return parsed;
};
