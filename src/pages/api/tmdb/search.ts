import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { applyRateLimit } from '@/lib/rateLimit';
import { getTmdbMoviesBySearchQuery, hasTmdbApiKey } from '@/lib/tmdb';

const querySchema = z.object({
  query: z.string().trim().min(1),
  limit: z.number().int().min(1).max(20).default(8),
});

const getQueryValue = (
  value: string | string[] | undefined
): string | undefined => {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
};

const parseOptionalNumber = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return parsed;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
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

  const parsedQuery = querySchema.safeParse({
    query: getQueryValue(req.query.query),
    limit: parseOptionalNumber(getQueryValue(req.query.limit)),
  });

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
