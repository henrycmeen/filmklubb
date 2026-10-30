import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { getTmdbMovieList, hasTmdbApiKey } from '@/lib/tmdb';

const listTypes = ['popular', 'top_rated', 'upcoming', 'now_playing'] as const;

const querySchema = z.object({
  listType: z.enum(listTypes).default('popular'),
  limit: z.number().int().min(1).max(20).default(12),
});

const getQueryValue = (
  value: string | string[] | undefined
): string | undefined => {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  if (!hasTmdbApiKey()) {
    return res.status(503).json({ message: 'TMDB is not configured.' });
  }

  const parsedQuery = querySchema.safeParse({
    listType: getQueryValue(req.query.listType),
    limit: Number(getQueryValue(req.query.limit) ?? 12),
  });

  if (!parsedQuery.success) {
    return res.status(400).json({
      message: 'Invalid query params.',
      issues: parsedQuery.error.issues,
    });
  }

  try {
    const movies = await getTmdbMovieList(parsedQuery.data.listType, 1);

    return res.status(200).json({
      listType: parsedQuery.data.listType,
      limit: parsedQuery.data.limit,
      count: Math.min(parsedQuery.data.limit, movies.length),
      movies: movies.slice(0, parsedQuery.data.limit),
    });
  } catch {
    return res.status(500).json({ message: 'Movies are temporarily unavailable.' });
  }
}
