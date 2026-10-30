import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { applyRateLimit } from '@/lib/rateLimit';
import { getTmdbMovieImages, hasTmdbApiKey } from '@/lib/tmdb';

const querySchema = z.object({
  movieId: z.string().regex(/^[0-9]+$/).transform(Number).pipe(z.number().int().safe().positive()),
  limit: z.string().regex(/^[0-9]+$/).default('24').transform(Number).pipe(z.number().int().min(1).max(60)),
  kind: z.enum(['all', 'poster', 'backdrop']).default('all'),
  cache: z.enum(['1', 'true', 'yes', '0', 'false', 'no']).default('true').transform(value => ['1', 'true', 'yes'].includes(value)),
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
      key: 'tmdb-images',
      maxRequests: 120,
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
    const images = await getTmdbMovieImages(
      parsedQuery.data.movieId,
      parsedQuery.data.limit,
      { useCache: parsedQuery.data.cache }
    );

    const posters =
      parsedQuery.data.kind === 'backdrop' ? [] : images.posters;
    const backdrops =
      parsedQuery.data.kind === 'poster' ? [] : images.backdrops;

    return res.status(200).json({
      movieId: parsedQuery.data.movieId,
      posters,
      backdrops,
    });
  } catch {
    return res.status(500).json({ message: 'TMDB images are temporarily unavailable.' });
  }
}
