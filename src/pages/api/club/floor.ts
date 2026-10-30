import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import {
  BoardConflictError,
  clearBoard,
  getBoardState,
  replaceBoardMovies,
  type BoardMovie,
  type BoardState,
} from '@/lib/floorBoard';

type ApiResponse =
  | BoardState
  | {
      message: string;
      issues?: unknown;
      expectedVersion?: number;
      currentVersion?: number;
    };

const boardPayloadSchema = z.object({
  boardId: z.string().trim().min(1).max(64).optional(),
  expectedVersion: z.number().int().nonnegative(),
  movies: z.array(
    z.object({
      id: z.number().int().positive(),
      title: z.string().trim().min(1),
      coverImage: z.string().trim().min(1),
      x: z.number(),
      y: z.number(),
      rotation: z.number(),
      score: z.number().min(0).max(100).optional(),
    })
  ).max(200).default([]),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  if (req.method !== 'GET' && req.method !== 'PUT' && req.method !== 'DELETE') {
    res.setHeader('Allow', 'GET, PUT, DELETE');
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const parsedBoardId = z.string().trim().min(1).max(64).default('default').safeParse(req.query.boardId);
  if (!parsedBoardId.success) return res.status(400).json({ message: 'Invalid board id.' });
  const boardId = parsedBoardId.data;

  try {
    if (req.method === 'GET') {
      const board = await getBoardState(boardId);
      return res.status(200).json(board);
    }

    if (req.method === 'DELETE') {
      const expectedVersionRaw = req.query.expectedVersion;
      if (
        expectedVersionRaw === undefined ||
        expectedVersionRaw === ''
      ) {
        return res.status(428).json({ message: 'Expected board version is required.' });
      }

      const expectedVersionResult = z.string().regex(/^[0-9]+$/)
        .transform(Number).pipe(z.number().int().safe().nonnegative())
        .safeParse(expectedVersionRaw);
      if (!expectedVersionResult.success) {
        return res.status(400).json({
          message: 'Invalid expected board version.',
          issues: expectedVersionResult.error.issues,
        });
      }

      const board = await clearBoard(boardId, expectedVersionResult.data);
      return res.status(200).json(board);
    }

    if (
      !req.body ||
      typeof req.body !== 'object' ||
      !Object.prototype.hasOwnProperty.call(req.body, 'expectedVersion')
    ) {
      return res.status(428).json({ message: 'Expected board version is required.' });
    }

    const payloadResult = boardPayloadSchema.safeParse(req.body ?? {});
    if (!payloadResult.success) {
      return res.status(400).json({
        message: 'Invalid request body.',
        issues: payloadResult.error.issues,
      });
    }

    const { boardId: requestedBoardId, expectedVersion, movies } =
      payloadResult.data;
    const normalizedBoardId = requestedBoardId?.trim() ?? boardId;

    const parsedMovies = movies as BoardMovie[];
    const nextBoard = await replaceBoardMovies({
      boardId: normalizedBoardId,
      expectedVersion,
      movies: parsedMovies,
    });

    return res.status(200).json(nextBoard);
  } catch (error) {
    if (error instanceof BoardConflictError) {
      return res.status(409).json({
        message: error.message,
        expectedVersion: error.expectedVersion,
        currentVersion: error.currentVersion,
      });
    }

    return res.status(500).json({ message: 'Floor board is temporarily unavailable.' });
  }
}
