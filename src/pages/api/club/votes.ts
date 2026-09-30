import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { normalizeClubSlug } from "@/lib/clubSlug";
import {
  combinedFilmIds,
  legacyFilmCatalogue,
  legacyFilmIds,
} from "@/lib/filmCatalogue";
import { getLegacyVoteBoardIds } from "@/lib/filmClubProgramme";
import { FilmRoundClosedError } from "@/lib/filmRound";
import {
  FilmRoundNotOpenError,
  FilmRoundCandidateError,
  getFilmVoteStore,
  type FilmVoteSnapshot,
} from "@/lib/filmVotes";
import {
  createDeviceIdentity,
  DEVICE_COOKIE_NAME,
  getOrCreateVoterSecret,
  parseDeviceIdentity,
  serializeDeviceCookie,
} from "@/lib/voterIdentity";

interface ApiError {
  error: {
    code:
      | "INVALID_REQUEST"
      | "METHOD_NOT_ALLOWED"
      | "ROUND_CLOSED"
      | "VOTING_UNAVAILABLE";
    message: string;
  };
}

type ApiResponse = FilmVoteSnapshot | ApiError;

const legacyCatalogueFilmIds = legacyFilmCatalogue.map((film) => film.id);
const tieBreakScores = new Map(
  legacyFilmCatalogue.map((film) => [film.id, film.tmdbVoteAverage]),
);
const legacyBoardIds = new Set(getLegacyVoteBoardIds());

const voteInputSchema = z
  .object({
    filmId: z.number().int().positive(),
    hasVoted: z.boolean().optional(),
  })
  .strict()
  // Scheduled rounds may use seasonal IDs, but the store performs the final
  // candidate check against the frozen round metadata. This schema only
  // rejects IDs unknown to every supported catalogue.
  .refine(({ filmId }) => combinedFilmIds.has(filmId));

const getQueryValue = (
  value: string | string[] | undefined,
): string | undefined => (Array.isArray(value) ? value[0] : value);

const resolveBoardId = (req: NextApiRequest): string | null => {
  const requestedBoardId = getQueryValue(req.query.boardId);
  if (!requestedBoardId?.trim()) {
    return null;
  }

  const boardId = normalizeClubSlug(requestedBoardId);
  return boardId.length <= 128 ? boardId : null;
};

const votingUnavailable = (res: NextApiResponse<ApiResponse>): void =>
  res.status(503).json({
    error: {
      code: "VOTING_UNAVAILABLE",
      message: "Avstemningen er ikke tilgjengelig akkurat nå.",
    },
  });

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>,
) {
  res.setHeader("Cache-Control", "private, no-store");

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Metoden er ikke tillatt.",
      },
    });
  }

  const boardId = resolveBoardId(req);
  if (!boardId) {
    return res.status(400).json({
      error: { code: "INVALID_REQUEST", message: "Ugyldig stemme." },
    });
  }

  try {
    const store = getFilmVoteStore();
    let scheduled = store.getScheduledRound(boardId);
    if (!scheduled && !legacyBoardIds.has(boardId)) {
      return res.status(400).json({
        error: { code: "INVALID_REQUEST", message: "Ugyldig stemme." },
      });
    }
    if (scheduled) {
      store.finalizeDueRounds(scheduled.clubId);
      const now = Date.now();
      if (
        !scheduled.published ||
        now < Date.parse(scheduled.voteStartsAt) ||
        (now >= Date.parse(scheduled.voteEndsAt) &&
          now < Date.parse(scheduled.resultsAt))
      ) {
        return res.status(409).json({
          error: {
            code: "ROUND_CLOSED",
            message:
              "Avstemningen er ikke åpen. Resultatene vises ved offentliggjøring.",
          },
        });
      }
    }
    const voterSecret = await getOrCreateVoterSecret();
    // Configuration or the deadline may have changed while reading identity.
    // Recheck before exposing a ranking, not just before accepting a vote.
    scheduled = store.getScheduledRound(boardId);
    if (scheduled) {
      store.finalizeDueRounds(scheduled.clubId);
      const now = Date.now();
      if (
        !scheduled.published ||
        now < Date.parse(scheduled.voteStartsAt) ||
        (now >= Date.parse(scheduled.voteEndsAt) &&
          now < Date.parse(scheduled.resultsAt))
      ) {
        return res.status(409).json({
          error: {
            code: "ROUND_CLOSED",
            message:
              "Avstemningen er ikke åpen. Resultatene vises ved offentliggjøring.",
          },
        });
      }
    }
    const existingVoterKey = parseDeviceIdentity(
      req.cookies?.[DEVICE_COOKIE_NAME],
      voterSecret,
    );
    const createdIdentity = existingVoterKey
      ? null
      : createDeviceIdentity(voterSecret);
    const voterKey = existingVoterKey ?? createdIdentity!.voterKey;
    if (createdIdentity) {
      res.setHeader(
        "Set-Cookie",
        serializeDeviceCookie(createdIdentity.cookieValue, {
          basePath: process.env.NEXT_PUBLIC_BASE_PATH,
          secure: process.env.NODE_ENV === "production",
        }),
      );
    }
    if (req.method === "POST") {
      const parsedVote = voteInputSchema.safeParse(req.body);
      if (!parsedVote.success) {
        return res.status(400).json({
          error: { code: "INVALID_REQUEST", message: "Ugyldig stemme." },
        });
      }

      // The unmanaged September board has no frozen schedule metadata. Keep
      // its historical 107-film boundary explicit; seasonal IDs are accepted
      // only when the store has a scheduled round whose catalogue contains
      // them.
      if (!scheduled && !legacyFilmIds.has(parsedVote.data.filmId)) {
        return res.status(400).json({
          error: { code: "INVALID_REQUEST", message: "Ugyldig stemme." },
        });
      }

      store.setVote(
        boardId,
        parsedVote.data.filmId,
        voterKey,
        parsedVote.data.hasVoted ?? true,
      );
    }

    const ids =
      scheduled?.metadata.catalogue.map((film) => film.id) ??
      legacyCatalogueFilmIds;
    const scores = scheduled
      ? new Map(
          scheduled.metadata.catalogue.map((film) => [
            film.id,
            film.tmdbVoteAverage,
          ]),
        )
      : tieBreakScores;
    const snapshot = store.getSnapshot(boardId, voterKey, ids, scores);
    const locked = store.getLockedRound(boardId);
    return res.status(200).json(
      locked
        ? {
            ...snapshot,
            ranking: locked.ranking.map(({ film, votes }) => ({
              filmId: film.id,
              votes,
            })),
            revision: locked.revision,
          }
        : snapshot,
    );
  } catch (error) {
    if (
      error instanceof FilmRoundClosedError ||
      error instanceof FilmRoundNotOpenError
    ) {
      return res.status(409).json({
        error: {
          code: "ROUND_CLOSED",
          message: "Avstemningen er låst.",
        },
      });
    }

    if (error instanceof FilmRoundCandidateError) {
      return res.status(400).json({
        error: {
          code: "INVALID_REQUEST",
          message: "Filmen er ikke med i denne avstemningen.",
        },
      });
    }

    return votingUnavailable(res);
  }
}
