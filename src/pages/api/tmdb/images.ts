import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { applyRateLimit } from '@/lib/rateLimit';
import { getTmdbMovieImages, hasTmdbApiKey } from '@/lib/tmdb';

const querySchema = z.object({
  movieId: z.number().int().positive(),
  limit: z.number().int().min(1).max(60).default(24),
  kind: z.enum(['all', 'poster', 'backdrop']).default('all'),
  cache: z.boolean().default(true),
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

const parseOptionalBoolean = (
  value: string | undefined
): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no') {
    return false;
  }

  return undefined;
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

  const parsedQuery = querySchema.safeParse({
    movieId: parseOptionalNumber(getQueryValue(req.query.movieId)),
    limit: Number(getQueryValue(req.query.limit) ?? 24),
    kind: getQueryValue(req.query.kind) ?? 'all',
    cache: parseOptionalBoolean(getQueryValue(req.query.cache)) ?? true,
  });

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
