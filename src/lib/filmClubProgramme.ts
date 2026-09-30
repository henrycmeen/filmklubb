import { z } from "zod";
import programmeConfig from "@/data/filmClubProgramme.json";
import filmVoteCatalogue from "@/data/filmVoteCatalogue.json";
import { normalizeClubSlug } from "@/lib/clubSlug";

const DEFAULT_CLUB_ID = "default";
const FILM_VOTE_CATALOGUE_IDS = new Set(
  filmVoteCatalogue.map((film) => film.id),
);

const screeningIdSchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9-]*$/);

const scheduledAtSchema = z.string().datetime({ offset: true });

export const filmClubHistoryEntrySchema = z
  .object({
    screeningId: screeningIdSchema,
    scheduledAt: scheduledAtSchema,
    winnerFilmId: z
      .number()
      .int()
      .positive()
      .refine((filmId) => FILM_VOTE_CATALOGUE_IDS.has(filmId), {
        message: "Winner film id must exist in the vote catalogue.",
      }),
    finalVoteCount: z.number().int().nonnegative(),
    totalVotes: z.number().int().nonnegative(),
    participatingDevices: z.number().int().nonnegative(),
  })
  .superRefine((entry, context) => {
    if (entry.finalVoteCount > entry.totalVotes) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["finalVoteCount"],
        message: "Final vote count cannot exceed total votes.",
      });
    }

    if (entry.participatingDevices > entry.totalVotes) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["participatingDevices"],
        message: "Participating devices cannot exceed total votes.",
      });
    }
  });

export const filmClubActiveScreeningSchema = z.object({
  id: screeningIdSchema,
  scheduledAt: scheduledAtSchema,
});

export const filmClubProgrammeSchema = z.object({
  name: z.string().trim().min(1),
  activeScreening: filmClubActiveScreeningSchema.nullable().default(null),
  history: z.array(filmClubHistoryEntrySchema),
});

export const filmClubProgrammeConfigSchema = z
  .object({
    clubs: z.record(filmClubProgrammeSchema),
    aliases: z.record(z.string().trim().min(1)),
  })
  .superRefine((config, context) => {
    for (const clubId of Object.keys(config.clubs)) {
      if (normalizeClubSlug(clubId) !== clubId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["clubs", clubId],
          message: "Canonical club ids must already be normalized.",
        });
      }
    }

    for (const [alias, canonicalId] of Object.entries(config.aliases)) {
      if (normalizeClubSlug(alias) !== alias) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["aliases", alias],
          message: "Club aliases must already be normalized.",
        });
      }

      if (!config.clubs[canonicalId]) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["aliases", alias],
          message: `Alias points to unknown club ${canonicalId}.`,
        });
      }

      if (config.clubs[alias]) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["aliases", alias],
          message: "An alias cannot also be a canonical club id.",
        });
      }
    }

    if (!config.clubs[DEFAULT_CLUB_ID]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["clubs"],
        message: `The ${DEFAULT_CLUB_ID} club configuration is required.`,
      });
    }
  });

export type FilmClubHistoryEntry = z.infer<typeof filmClubHistoryEntrySchema>;
export type FilmClubActiveScreening = z.infer<
  typeof filmClubActiveScreeningSchema
>;
export type FilmClubProgramme = z.infer<typeof filmClubProgrammeSchema>;
export type FilmClubProgrammeConfig = z.infer<
  typeof filmClubProgrammeConfigSchema
>;

const filmClubProgrammeConfig =
  filmClubProgrammeConfigSchema.parse(programmeConfig);

const cloneProgramme = (programme: FilmClubProgramme): FilmClubProgramme => ({
  name: programme.name,
  activeScreening: programme.activeScreening
    ? { ...programme.activeScreening }
    : null,
  history: programme.history.map((entry) => ({ ...entry })),
});

const getFallbackProgramme = (): FilmClubProgramme => {
  const defaultProgramme = filmClubProgrammeConfig.clubs[DEFAULT_CLUB_ID];

  if (!defaultProgramme) {
    throw new Error(
      "Filmklubb programme is missing the default configuration.",
    );
  }

  return cloneProgramme(defaultProgramme);
};

/**
 * Resolves a route slug to a canonical board namespace. Unknown slugs remain
 * isolated namespaces instead of silently joining the NA board.
 */
export const resolveCanonicalClubId = (clubSlug?: string): string => {
  const normalizedClubSlug = normalizeClubSlug(clubSlug);
  return (
    filmClubProgrammeConfig.aliases[normalizedClubSlug] ?? normalizedClubSlug
  );
};

// A descriptive alias for callers that use the "get" naming convention.
export const getCanonicalClubId = resolveCanonicalClubId;

export const getFilmClubProgramme = (clubSlug?: string): FilmClubProgramme => {
  const canonicalClubId = resolveCanonicalClubId(clubSlug);
  const programme = filmClubProgrammeConfig.clubs[canonicalClubId];

  return programme ? cloneProgramme(programme) : getFallbackProgramme();
};

export const getActiveVoteBoardId = (clubSlug?: string): string | null => {
  const canonicalClubId = resolveCanonicalClubId(clubSlug);
  const programme = getFilmClubProgramme(canonicalClubId);
  return programme.activeScreening
    ? `${canonicalClubId}-${programme.activeScreening.id}`
    : null;
};

/** Compatibility boards exist only for explicitly configured legacy elections. */
export const getLegacyVoteBoardIds = (): string[] =>
  Object.entries(filmClubProgrammeConfig.clubs).flatMap(
    ([clubId, programme]) =>
      programme.activeScreening
        ? [clubId, `${clubId}-${programme.activeScreening.id}`]
        : [],
  );
