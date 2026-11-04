import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getBoardState } from '@/lib/floorBoard';
import { hasTmdbApiKey } from '@/lib/tmdb';
import {
  TMDB_CACHE_ROOT,
  VHS_RENDER_CACHE_DIRECTORY,
  CLUB_SQLITE_PATH,
} from '@/lib/storagePaths';

type HealthStatus = 'ok' | 'degraded' | 'error';

interface HealthResponse {
  status: HealthStatus;
  generatedAt: string;
  checks: {
    sqlite: boolean;
    cacheDirectories: boolean;
    tmdbConfigured: boolean;
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<HealthResponse | { message: string }>
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  let sqliteOk = false;
  let cacheDirectoriesOk = false;
  const tmdbConfigured = hasTmdbApiKey();

  try {
    await getBoardState('default');
    sqliteOk = true;
  } catch {
    sqliteOk = false;
  }

  try {
    for (const directory of [path.dirname(CLUB_SQLITE_PATH), TMDB_CACHE_ROOT, VHS_RENDER_CACHE_DIRECTORY]) {
      await fs.mkdir(directory, { recursive: true });
      await fs.access(directory, constants.W_OK);
    }
    cacheDirectoriesOk = true;
  } catch {
    cacheDirectoriesOk = false;
  }

  const status: HealthStatus =
    sqliteOk && cacheDirectoriesOk
      ? tmdbConfigured
        ? 'ok'
        : 'degraded'
      : 'error';

  const response: HealthResponse = {
    status,
    generatedAt: new Date().toISOString(),
    checks: {
      sqlite: sqliteOk,
      cacheDirectories: cacheDirectoriesOk,
      tmdbConfigured,
    },
  };

  const httpCode = status === 'error' ? 500 : 200;
  res.status(httpCode).json(response);
}
