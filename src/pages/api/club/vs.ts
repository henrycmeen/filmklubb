import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { getTmdbMovieById, hasTmdbApiKey } from '@/lib/tmdb';

const bodySchema = z
  .object({
    movieAId: z.number().int().positive(),
    movieBId: z.number().int().positive(),
  })
  .refine((body) => body.movieAId !== body.movieBId, {
    message: 'movieAId and movieBId must be different.',
  });

const normalizeVoteScore = (movie: {
  voteAverage: number;
  voteCount: number;
  popularity: number;
}): number => {
  const voteWeight = 1000;
  const voteCountWeight = 0.05;
  const popularityWeight = 0.2;

  return (
    movie.voteAverage * voteWeight +
    movie.voteCount * voteCountWeight +
    movie.popularity * popularityWeight
  );
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ message: 'Method not allowed' });
  }

  if (!hasTmdbApiKey()) {
    return res.status(503).json({ message: 'TMDB is not configured.' });
  }

  const parsedBody = bodySchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      message: 'Invalid request body.',
      issues: parsedBody.error.issues,
    });
  }

  try {
    const [movieA, movieB] = await Promise.all([
      getTmdbMovieById(parsedBody.data.movieAId),
      getTmdbMovieById(parsedBody.data.movieBId),
    ]);

    if (!movieA || !movieB) {
      return res.status(404).json({
        message: 'Could not load one or both movies from TMDB.',
      });
    }

    const scoreA = normalizeVoteScore(movieA);
    const scoreB = normalizeVoteScore(movieB);

    const winner = scoreA >= scoreB ? movieA : movieB;
    const loser = scoreA >= scoreB ? movieB : movieA;

    return res.status(200).json({
      winnerId: winner.id,
      loserId: loser.id,
      contenders: [
        {
          id: movieA.id,
          title: movieA.title,
          voteAverage: movieA.voteAverage,
          voteCount: movieA.voteCount,
          popularity: movieA.popularity,
        },
        {
          id: movieB.id,
          title: movieB.title,
          voteAverage: movieB.voteAverage,
          voteCount: movieB.voteCount,
          popularity: movieB.popularity,
        },
      ],
    });
  } catch {
    return res.status(500).json({ message: 'Movie comparison is temporarily unavailable.' });
  }
}
