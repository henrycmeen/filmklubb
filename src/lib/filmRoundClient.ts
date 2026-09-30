import { z } from "zod";
import type { TicketData } from "@/components/FilmTicket";
import { withBasePath } from "@/lib/basePath";

const filmSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().trim().min(1),
  year: z.number().int().nonnegative(),
  coverImage: z.string(),
});

const ticketSchema = z.object({
  film: filmSchema,
  image: z.string(),
  fallback: z.string(),
  logo: z.string().optional(),
  logoFallback: z.string().optional(),
  director: z.string().optional(),
  palette: z.string(),
  date: z.string(),
  time: z.string(),
  venue: z.string(),
  note: z.string(),
  serial: z.string(),
});

const rankingEntrySchema = z.object({
  film: filmSchema,
  votes: z.number().int().nonnegative(),
  tmdbVoteAverage: z.number().finite().optional(),
});

const statsSchema = z.object({
  totalVotes: z.number().int().nonnegative(),
  participatingDevices: z.number().int().nonnegative(),
  lastVoteAt: z.string().datetime({ offset: true }).nullable(),
});

const snapshotSchema = z.object({
  boardId: z.string().trim().min(1).max(64),
  clubId: z.string().trim().min(1).max(64),
  screeningId: z.string().trim().min(1).max(128),
  scheduledAt: z.string().datetime({ offset: true }),
  lockedAt: z.string().datetime({ offset: true }),
  snapshotId: z.string().trim().min(1).max(128),
  algorithmVersion: z.string().trim().min(1).max(128),
  revision: z.number().int().nonnegative(),
  ranking: rankingEntrySchema.array().max(200),
  stats: statsSchema,
  ticket: ticketSchema.nullable(),
});

const openRoundSchema = z.object({
  status: z.literal("open"),
  boardId: z.string().trim().min(1).max(64),
  scheduledAt: z.string().datetime({ offset: true }).optional(),
  venue: z.string().trim().min(1).max(256).optional(),
  candidateIds: z.array(z.number().int().positive()).max(200).optional(),
});

const scheduledRoundSchema = z.object({
  status: z.literal("scheduled"),
  boardId: z.string().trim().min(1).max(64),
  opensAt: z.string().datetime({ offset: true }),
  scheduledAt: z.string().datetime({ offset: true }),
  venue: z.string().trim().min(1).max(256).optional(),
});

const awaitingRoundSchema = z.object({
  status: z.literal("awaiting"),
  boardId: z.string().trim().min(1).max(64),
  resultsAt: z.string().datetime({ offset: true }),
  scheduledAt: z.string().datetime({ offset: true }),
  venue: z.string().trim().min(1).max(256).optional(),
});

const idleRoundSchema = z.object({
  status: z.literal("idle"),
});

const closedRoundSchema = z.object({
  status: z.literal("closed"),
  boardId: z.string().trim().min(1).max(64),
  snapshot: snapshotSchema,
});

const filmRoundResponseSchema = z.discriminatedUnion("status", [
  openRoundSchema,
  scheduledRoundSchema,
  awaitingRoundSchema,
  closedRoundSchema,
  idleRoundSchema,
]);

const historyEntrySchema = z.object({
  snapshot: snapshotSchema,
  completedAt: z.string().datetime({ offset: true }),
});

const filmClubHistoryResponseSchema = z.object({
  history: historyEntrySchema.array().max(200),
});

export type FilmRoundFilm = z.infer<typeof filmSchema>;
export type FilmRoundRankingEntry = z.infer<typeof rankingEntrySchema>;
export type FilmRoundStats = z.infer<typeof statsSchema>;
export type FilmRoundSnapshot = z.infer<typeof snapshotSchema>;
export type FilmRoundStatus = z.infer<typeof filmRoundResponseSchema>;
export type FilmRoundTicket = TicketData;
export type FilmClubHistoryEntry = z.infer<typeof historyEntrySchema>;

export interface FilmRoundFetchOptions {
  clubSlug: string;
  screeningId?: string;
  signal?: AbortSignal;
}

export class FilmRoundRequestError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "FilmRoundRequestError";
    this.status = status;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getErrorMessage = (value: unknown): string | null => {
  if (!isRecord(value)) {
    return null;
  }

  const error = value.error;
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  if (isRecord(error) && typeof error.message === "string") {
    const message = error.message.trim();
    return message || null;
  }
  if (typeof value.message === "string") {
    const message = value.message.trim();
    return message || null;
  }
  return null;
};

const validateSnapshot = (status: FilmRoundStatus): FilmRoundStatus | null => {
  if (status.status !== "closed") {
    return status;
  }

  if (status.snapshot.boardId !== status.boardId) {
    return null;
  }

  const rankedFilmIds = status.snapshot.ranking.map(({ film }) => film.id);
  if (new Set(rankedFilmIds).size !== rankedFilmIds.length) {
    return null;
  }

  return status;
};

/**
 * Parse one round response and reject a payload that belongs to another board.
 * The optional board guard lets a late response fail closed at the caller.
 */
export const parseFilmRoundResponse = (
  rawValue: unknown,
  expectedBoardId?: string,
): FilmRoundStatus | null => {
  const parsed = filmRoundResponseSchema.safeParse(rawValue);
  if (!parsed.success) {
    return null;
  }
  if (
    expectedBoardId &&
    "boardId" in parsed.data &&
    parsed.data.boardId !== expectedBoardId
  ) {
    return null;
  }
  return validateSnapshot(parsed.data);
};

export const fetchFilmRoundStatus = async ({
  clubSlug,
  screeningId,
  signal,
}: FilmRoundFetchOptions): Promise<FilmRoundStatus> => {
  const normalizedClubSlug = clubSlug.trim();
  if (!normalizedClubSlug) {
    throw new FilmRoundRequestError("Klubb mangler.", 400);
  }

  const query = new URLSearchParams({ clubSlug: normalizedClubSlug });
  const normalizedScreeningId = screeningId?.trim();
  if (normalizedScreeningId) {
    query.set("screeningId", normalizedScreeningId);
  }

  const response = await fetch(
    withBasePath(`/api/club/round?${query.toString()}`),
    {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal,
    },
  );

  if (!response.ok) {
    let message = "Rundestatus kunne ikke hentes.";
    try {
      message = getErrorMessage(await response.json()) ?? message;
    } catch {
      // Preserve the generic message when the server did not return JSON.
    }
    throw new FilmRoundRequestError(message, response.status);
  }

  const parsed = parseFilmRoundResponse(await response.json());
  if (!parsed) {
    throw new FilmRoundRequestError(
      "Rundestatus hadde et ugyldig format.",
      200,
    );
  }
  return parsed;
};

export const parseFilmClubHistoryResponse = (
  rawValue: unknown,
): FilmClubHistoryEntry[] | null => {
  const parsed = filmClubHistoryResponseSchema.safeParse(rawValue);
  if (!parsed.success) {
    return null;
  }

  if (parsed.data.history.some((entry) => !validateHistorySnapshot(entry))) {
    return null;
  }

  return parsed.data.history;
};

const validateHistorySnapshot = ({
  snapshot,
}: FilmClubHistoryEntry): boolean => {
  const rankedFilmIds = snapshot.ranking.map(({ film }) => film.id);
  return (
    new Set(rankedFilmIds).size === rankedFilmIds.length &&
    snapshot.ranking.every(({ votes }) => votes >= 0)
  );
};

export const getFilmClubHistoryRequestUrl = (clubSlug: string): string => {
  const normalizedClubSlug = clubSlug.trim();
  const query = new URLSearchParams({ clubSlug: normalizedClubSlug });
  return withBasePath(`/api/club/history?${query.toString()}`);
};

export const fetchFilmClubHistory = async (
  clubSlug: string,
  signal?: AbortSignal,
): Promise<FilmClubHistoryEntry[]> => {
  const normalizedClubSlug = clubSlug.trim();
  if (!normalizedClubSlug) {
    throw new FilmRoundRequestError("Klubb mangler.", 400);
  }

  const response = await fetch(
    getFilmClubHistoryRequestUrl(normalizedClubSlug),
    {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal,
    },
  );

  if (!response.ok) {
    let message = "Historikken kunne ikke hentes.";
    try {
      message = getErrorMessage(await response.json()) ?? message;
    } catch {
      // Preserve the generic message when the server did not return JSON.
    }
    throw new FilmRoundRequestError(message, response.status);
  }

  const parsed = parseFilmClubHistoryResponse(await response.json());
  if (!parsed) {
    throw new FilmRoundRequestError(
      "Historikken hadde et ugyldig format.",
      200,
    );
  }
  return parsed;
};

export const isFilmRoundAbortError = (error: unknown): boolean =>
  isRecord(error) && error.name === "AbortError";
