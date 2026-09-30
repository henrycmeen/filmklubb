import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import artwork from "@/data/ticketDemoArt.json";
import { applyRateLimit } from "@/lib/rateLimit";
import { combinedFilmCatalogue } from "@/lib/filmCatalogue";
import { getTmdbMovieTicketDetails, hasTmdbApiKey } from "@/lib/tmdb";
import {
  selectTicketMetadata,
  type TicketMetadata,
} from "@/lib/ticketMetadata";

const movieIdSchema = z
  .string()
  .regex(/^[1-9][0-9]*$/)
  .transform(Number)
  .refine(Number.isSafeInteger, "Invalid movie id");

const querySchema = z
  .object({
    movieId: movieIdSchema,
  })
  .strict();

type ErrorResponse = { message: string };

const getMovieOptions = (
  movieId: number,
): { coverImage?: string; fallback?: string } => {
  const film = combinedFilmCatalogue.find(
    (candidate) => candidate.id === movieId,
  );
  const existingArtwork = artwork[String(movieId) as keyof typeof artwork];

  return {
    coverImage: film?.coverImage,
    fallback: existingArtwork?.fallback ?? film?.coverImage,
  };
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<TicketMetadata | ErrorResponse>,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  if (
    !applyRateLimit(req, res, {
      key: "tmdb-ticket",
      maxRequests: 90,
      windowMs: 60_000,
    })
  ) {
    return;
  }

  const parsedQuery = querySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    return res.status(400).json({ message: "Invalid movie id" });
  }

  if (!hasTmdbApiKey()) {
    return res.status(500).json({
      message: "TMDB ticket metadata is unavailable.",
    });
  }

  try {
    const details = await getTmdbMovieTicketDetails(parsedQuery.data.movieId);
    if (!details) {
      return res.status(404).json({ message: "Film not found." });
    }

    return res
      .status(200)
      .json(selectTicketMetadata(details, getMovieOptions(details.id)));
  } catch {
    // Do not forward TMDB's response or request URL, which may contain secrets.
    return res.status(502).json({
      message: "TMDB ticket metadata is temporarily unavailable.",
    });
  }
}
