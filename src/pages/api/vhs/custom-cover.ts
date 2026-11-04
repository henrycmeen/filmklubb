import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { applyRateLimit } from '@/lib/rateLimit';
import { scheduleCachePrune } from '@/lib/cacheMaintenance';
import { withBasePath } from '@/lib/basePath';
import { VHS_RENDER_CACHE_DIRECTORY } from '@/lib/storagePaths';
import { getVhsTemplateById } from '@/lib/vhs/templates';
import {
  assertAllowedRemoteImageUrl,
  getRemoteImageHttpStatus,
  RemoteImageError,
} from '@/lib/vhs/remoteImage';
import { renderVhsPoster } from '@/lib/vhs/render';

const DEFAULT_RENDER_MAX_SIDE = 1800;
const MIN_RENDER_MAX_SIDE = 720;
const MAX_RENDER_MAX_SIDE = 4000;
const DEFAULT_VHS_CACHE_MAX_MB = 2048;
const DEFAULT_VHS_CACHE_MAX_AGE_DAYS = 45;
const VHS_CACHE_PRUNE_THROTTLE_MS = 5 * 60 * 1000;
const CUSTOM_RENDER_VERSION = 'c1';

const requestSchema = z.object({
  movieId: z.number().int().positive(),
  sourceUrl: z.string().url(),
  templateId: z.string().min(1),
  sourceKind: z.enum(['poster', 'backdrop']).default('poster'),
  fit: z.enum(['cover', 'contain']).default('cover'),
  format: z.enum(['webp', 'png']).default('webp'),
  quality: z.number().int().min(1).max(100).default(92),
  background: z.string().min(1).default('transparent'),
  posterOffsetX: z.number().int().min(-1200).max(1200).default(0),
  posterOffsetY: z.number().int().min(-1200).max(1200).default(0),
  posterScale: z.number().min(0.45).max(2.6).default(1),
});

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const parsePositiveIntEnv = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return Math.floor(parsed);
};

const getRenderMaxSide = (): number => {
  const raw = process.env.VHS_SHARP_RENDER_SIZE?.trim();
  if (!raw) {
    return DEFAULT_RENDER_MAX_SIDE;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_RENDER_MAX_SIDE;
  }

  return clamp(Math.round(parsed), MIN_RENDER_MAX_SIDE, MAX_RENDER_MAX_SIDE);
};

const getRenderDimensions = (
  templateId: string,
  maxSide: number
): { width: number; height: number } => {
  const template = getVhsTemplateById(templateId);
  const templateWidth = Math.max(1, template.output.width);
  const templateHeight = Math.max(1, template.output.height);

  if (templateWidth === templateHeight) {
    return { width: maxSide, height: maxSide };
  }

  if (templateWidth > templateHeight) {
    return {
      width: maxSide,
      height: Math.max(1, Math.round((maxSide * templateHeight) / templateWidth)),
    };
  }

  return {
    width: Math.max(1, Math.round((maxSide * templateWidth) / templateHeight)),
    height: maxSide,
  };
};

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);

const getVhsCacheMaxBytes = (): number =>
  (parsePositiveIntEnv(process.env.VHS_RENDER_CACHE_MAX_MB) ??
    DEFAULT_VHS_CACHE_MAX_MB) *
  1024 *
  1024;

const getVhsCacheMaxAgeMs = (): number =>
  (parsePositiveIntEnv(process.env.VHS_RENDER_CACHE_MAX_AGE_DAYS) ??
    DEFAULT_VHS_CACHE_MAX_AGE_DAYS) *
  24 *
  60 *
  60 *
  1000;

const fileExists = async (absolutePath: string): Promise<boolean> => {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ message: 'Method not allowed' });
  }

  if (
    !applyRateLimit(req, res, {
      key: 'vhs-custom-cover',
      maxRequests: 80,
      windowMs: 60_000,
    })
  ) {
    return;
  }

  const parsedBody = requestSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      message: 'Invalid custom cover payload.',
      issues: parsedBody.error.issues,
    });
  }

  try {
    await fs.mkdir(VHS_RENDER_CACHE_DIRECTORY, { recursive: true });

    const payload = parsedBody.data;
    assertAllowedRemoteImageUrl(payload.sourceUrl);
    const templateSlug = slugify(payload.templateId) || 'template';
    const payloadHash = createHash('sha1')
      .update(
        JSON.stringify({
          sourceUrl: payload.sourceUrl,
          templateId: payload.templateId,
          sourceKind: payload.sourceKind,
          fit: payload.fit,
          format: payload.format,
          quality: payload.quality,
          background: payload.background,
          posterOffsetX: payload.posterOffsetX,
          posterOffsetY: payload.posterOffsetY,
          posterScale: payload.posterScale,
          version: CUSTOM_RENDER_VERSION,
        })
      )
      .digest('hex')
      .slice(0, 18);

    const fileName = `custom-${payload.movieId}-${payload.sourceKind}-${templateSlug}-${CUSTOM_RENDER_VERSION}-${payloadHash}.${payload.format}`;
    const absoluteFilePath = path.join(VHS_RENDER_CACHE_DIRECTORY, fileName);

    if (!(await fileExists(absoluteFilePath))) {
      const renderSide = getRenderMaxSide();
      const dimensions = getRenderDimensions(payload.templateId, renderSide);

      const rendered = await renderVhsPoster({
        sourceUrl: payload.sourceUrl,
        templateId: payload.templateId,
        fit: payload.fit,
        width: dimensions.width,
        height: dimensions.height,
        format: payload.format,
        quality: payload.quality,
        background: payload.background,
        posterOffsetX: payload.posterOffsetX,
        posterOffsetY: payload.posterOffsetY,
        posterScale: payload.posterScale,
      });

      await fs.writeFile(absoluteFilePath, rendered.buffer);
      scheduleCachePrune(VHS_RENDER_CACHE_DIRECTORY, {
        maxBytes: getVhsCacheMaxBytes(),
        maxAgeMs: getVhsCacheMaxAgeMs(),
        throttleMs: VHS_CACHE_PRUNE_THROTTLE_MS,
      });
    }

    return res.status(200).json({
      movieId: payload.movieId,
      templateId: payload.templateId,
      coverImage: withBasePath(
        `/api/vhs/generated/${encodeURIComponent(fileName)}`
      ),
    });
  } catch (error) {
    if (error instanceof RemoteImageError) {
      return res
        .status(getRemoteImageHttpStatus(error))
        .json({ message: error.message });
    }

    return res.status(500).json({ message: 'Unable to create VHS cover.' });
  }
}
