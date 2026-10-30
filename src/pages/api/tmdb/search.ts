import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { applyRateLimit } from '@/lib/rateLimit';
import { getTmdbMoviesBySearchQuery, hasTmdbApiKey } from '@/lib/tmdb';

const querySchema = z.object({
  query: z.string().trim().min(1).max(256),
  limit: z.string().regex(/^[0-9]+$/).default('8').transform(Number).pipe(z.number().int().min(1).max(20)),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ message: 'Method not allowed' });
  }

  if (
    !applyRateLimit(req, res, {
      key: 'tmdb-search',
      maxRequests: 90,
      windowMs: 60_000,
    })
  ) {
    return;
  }

  if (!hasTmdbApiKey()) {
    return res.status(503).json({ message: 'TMDB is not configured.' });
  }

  const parsedQuery = querySchema.safeParse(req.query);

  if (!parsedQuery.success) {
    return res.status(400).json({
      message: 'Invalid query params.',
      issues: parsedQuery.error.issues,
    });
  }

  try {
    const movies = await getTmdbMoviesBySearchQuery(
      parsedQuery.data.query,
      parsedQuery.data.limit
    );

    return res.status(200).json({
      query: parsedQuery.data.query,
      count: movies.length,
      results: movies.map((movie) => ({
        id: movie.id,
        title: movie.title,
        year: movie.year,
        posterUrl: movie.posterUrl,
        backdropUrl: movie.backdropUrl,
      })),
    });
  } catch {
    return res.status(500).json({ message: 'TMDB search is temporarily unavailable.' });
  }
}
