import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { applyRateLimit } from '@/lib/rateLimit';
import type { TmdbTitleQuery } from '@/lib/tmdb';
import { hasTmdbApiKey } from '@/lib/tmdb';
import {
  syncFrontSideVhsCovers,
  type VhsRenderer,
  type VhsSourceImageType,
} from '@/lib/vhs/covers';

const listTypes = ['popular', 'top_rated', 'upcoming', 'now_playing'] as const;
const renderers = ['sharp', 'photoshop'] as const;
const formats = ['png', 'webp'] as const;
const imageTypes = ['poster', 'backdrop'] as const;

const querySchema = z.object({
  listType: z.enum(listTypes).default('popular'),
  movieId: z.string().regex(/^[0-9]+$/).transform(Number).pipe(z.number().int().safe().positive()).optional(),
  query: z.string().trim().min(1).max(256).optional(),
  limit: z.string().regex(/^[0-9]+$/).default('8').transform(Number).pipe(z.number().int().min(1).max(20)),
  force: z.enum(['1', 'true', 'yes', 'on', '0', 'false', 'no', 'off']).default('false').transform(value => ['1', 'true', 'yes', 'on'].includes(value)),
  format: z.enum(formats).default('webp'),
  renderer: z.enum(renderers).default(() => getDefaultRenderer()),
  imageType: z.enum(imageTypes).default(() => getDefaultImageType()),
  templateId: z.string().min(1).max(128).optional(),
  smartObjectLayerName: z.string().min(1).max(256).optional(),
  titles: z.string().max(6000).refine(value => {
    const entries = value.split('|').filter(entry => entry.trim());
    return entries.length <= 20 && entries.every(entry => {
      const parts = entry.split('::');
      const title = parts[0]?.trim() ?? '';
      const year = parts[1]?.trim();
      return title.length > 0 && title.length <= 256 && parts.length <= 2 &&
        (!year || (/^[0-9]{4}$/.test(year) && Number(year) >= 1800 && Number(year) <= 2200));
    });
  }, 'Invalid title queries.').optional(),
});

const parseTitleQueries = (value: string | undefined): TmdbTitleQuery[] => {
  if (!value) {
    return [];
  }

  return value
    .split('|')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const parts = entry.split('::').map((part) => part.trim());
      const titleRaw = parts[0] ?? '';
      const yearRaw = parts[1];
      const year = yearRaw ? Number(yearRaw) : undefined;

      return {
        title: titleRaw,
        year: Number.isFinite(year) ? year : undefined,
      };
    })
    .filter((query) => query.title.length > 0);
};

const getDefaultRenderer = (): VhsRenderer => {
  const configured = process.env.VHS_RENDERER?.trim().toLowerCase();
  if (configured === 'photoshop') {
    return 'photoshop';
  }

  return 'sharp';
};

const getDefaultImageType = (): VhsSourceImageType => {
  const configured = process.env.VHS_SOURCE_IMAGE_TYPE?.trim().toLowerCase();
  if (configured === 'backdrop') {
    return 'backdrop';
  }

  return 'poster';
};

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
      key: 'vhs-covers',
      maxRequests: 60,
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
    const movies = await syncFrontSideVhsCovers({
      movieId: parsedQuery.data.movieId,
      listType: parsedQuery.data.listType,
      searchQuery: parsedQuery.data.query,
      titleQueries: parseTitleQueries(parsedQuery.data.titles),
      limit: parsedQuery.data.limit,
      force: parsedQuery.data.force,
      format: parsedQuery.data.format,
      renderer: parsedQuery.data.renderer,
      sourceImageType: parsedQuery.data.imageType,
      templateId: parsedQuery.data.templateId,
      smartObjectLayerName: parsedQuery.data.smartObjectLayerName,
      quality: 92,
    });

    return res.status(200).json({
      listType: parsedQuery.data.listType,
      renderer: parsedQuery.data.renderer,
      imageType: parsedQuery.data.imageType,
      format: parsedQuery.data.format,
      movieId: parsedQuery.data.movieId ?? null,
      query: parsedQuery.data.query ?? null,
      customTitles: parseTitleQueries(parsedQuery.data.titles),
      limit: parsedQuery.data.limit,
      count: movies.length,
      movies,
    });
  } catch {
    return res.status(500).json({ message: 'VHS covers are temporarily unavailable.' });
  }
}
