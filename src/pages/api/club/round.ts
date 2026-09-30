import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { applyRateLimit } from "@/lib/rateLimit";
import {
  getPublicFilmRound,
  type PublicFilmRound,
} from "@/lib/filmScheduleService";

const screeningIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9-]*$/);

const querySchema = z
  .object({
    clubSlug: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9][a-z0-9-]*$/i)
      .default("default"),
    screeningId: screeningIdSchema.optional(),
  })
  .strict();

interface RoundErrorResponse {
  error: {
    code:
      | "INVALID_REQUEST"
      | "METHOD_NOT_ALLOWED"
      | "ROUND_NOT_FOUND"
      | "ROUND_UNAVAILABLE";
    message: string;
  };
}

type RoundResponse = PublicFilmRound | RoundErrorResponse;

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<RoundResponse>,
) {
  res.setHeader("Cache-Control", "private, no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Metoden er ikke tillatt.",
      },
    });
  }

  if (
    !applyRateLimit(req, res, {
      key: "club-round",
      maxRequests: 600,
      windowMs: 60_000,
    })
  ) {
    return;
  }

  const parsedQuery = querySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    return res.status(400).json({
      error: {
        code: "INVALID_REQUEST",
        message: "Ugyldig runde.",
      },
    });
  }

  try {
    const round = getPublicFilmRound(
      parsedQuery.data.clubSlug,
      parsedQuery.data.screeningId,
    );
    if (!round) {
      return res.status(404).json({
        error: {
          code: "ROUND_NOT_FOUND",
          message: "Runden finnes ikke.",
        },
      });
    }

    return res.status(200).json(round);
  } catch {
    return res.status(503).json({
      error: {
        code: "ROUND_UNAVAILABLE",
        message: "Runden er ikke tilgjengelig akkurat nå.",
      },
    });
  }
}
