import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { getBoardState } from '@/lib/floorBoard';
import { getTmdbMovieById, hasTmdbApiKey } from '@/lib/tmdb';

interface ProgramMovie {
  id: number;
  title: string;
  rank: number;
  score: number;
  coverImage: string;
  scheduledAt: string;
  backdropUrl: string | null;
  posterUrl: string | null;
  releaseDate: string | null;
  year: number | null;
}

interface ProgramResponse {
  boardId: string;
  updatedAt: string;
  generatedAt: string;
  now: ProgramMovie | null;
  queue: ProgramMovie[];
}

const querySchema = z.object({
  boardId: z.string().trim().min(1).max(64).default('default'),
});
const FALLBACK_MOVIE_ID = 78;

const withHours = (base: Date, addHours: number): string =>
  new Date(base.getTime() + addHours * 60 * 60 * 1000).toISOString();

const toProgramMovie = async (
  movie: {
    id: number;
    title: string;
    coverImage: string;
    rank: number;
    score?: number;
  },
  baseTime: Date,
  slotHoursFromNow: number
): Promise<ProgramMovie> => {
  const tmdbMovie = hasTmdbApiKey()
    ? await getTmdbMovieById(movie.id).catch(() => null)
    : null;

  return {
    id: movie.id,
    title: movie.title,
    rank: movie.rank,
    score: movie.score ?? 0,
    coverImage: movie.coverImage,
    scheduledAt: withHours(baseTime, slotHoursFromNow),
    backdropUrl: tmdbMovie?.backdropUrl ?? null,
    posterUrl: tmdbMovie?.posterUrl ?? null,
    releaseDate: tmdbMovie?.releaseDate ?? null,
    year: tmdbMovie?.year ?? null,
  };
};

const buildFallbackProgram = async (boardId: string): Promise<ProgramResponse> => {
  const generatedAt = new Date().toISOString();
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const firstSlot = new Date(now.getTime() + 60 * 60 * 1000);

  if (!hasTmdbApiKey()) {
    return {
      boardId,
      updatedAt: generatedAt,
      generatedAt,
      now: null,
      queue: [],
    };
  }

  const movie = await getTmdbMovieById(FALLBACK_MOVIE_ID).catch(() => null);
  if (!movie) {
    return {
      boardId,
      updatedAt: generatedAt,
      generatedAt,
      now: null,
      queue: [],
    };
  }

  const nowItem: ProgramMovie = {
    id: movie.id,
    title: movie.title,
    rank: 1,
    score: 100,
    coverImage: movie.posterUrl ?? '',
    scheduledAt: withHours(firstSlot, 0),
    backdropUrl: movie.backdropUrl,
    posterUrl: movie.posterUrl,
    releaseDate: movie.releaseDate ?? null,
    year: movie.year ?? null,
  };

  return {
    boardId,
    updatedAt: generatedAt,
    generatedAt,
    now: nowItem,
    queue: [],
  };
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ProgramResponse | { message: string; issues?: unknown }>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const parsedQuery = querySchema.safeParse(req.query);

  if (!parsedQuery.success) {
    return res.status(400).json({
      message: 'Invalid query params.',
      issues: parsedQuery.error.issues,
    });
  }

  const boardId = parsedQuery.data.boardId;

  try {
    const board = await getBoardState(boardId);
    const ranked = [...board.movies]
      .sort((a, b) => b.score - a.score || a.y - b.y || a.rank - b.rank || a.x - b.x)
      .slice(0, 4);

    if (ranked.length === 0) {
      const fallback = await buildFallbackProgram(boardId);
      return res.status(200).json(fallback);
    }

    const start = new Date();
    start.setMinutes(0, 0, 0);
    const firstSlot = new Date(start.getTime() + 60 * 60 * 1000);

    const enriched = await Promise.all(
      ranked.map((movie, index) => toProgramMovie(movie, firstSlot, index * 2))
    );

    return res.status(200).json({
      boardId: board.boardId,
      updatedAt: board.updatedAt,
      generatedAt: new Date().toISOString(),
      now: enriched[0] ?? null,
      queue: enriched.slice(1),
    });
  } catch {
    return res.status(500).json({ message: 'Next programme is temporarily unavailable.' });
  }
}
