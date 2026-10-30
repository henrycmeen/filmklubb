import { z } from "zod";

const snapshotSchema = z.object({
  boardId: z.string().trim().min(1).max(128),
  ranking: z
    .array(
      z.object({
        filmId: z.number().int().positive(),
        votes: z.number().int().nonnegative(),
      }),
    )
    .max(200),
  revision: z.number().int().nonnegative(),
  votedFilmIds: z.array(z.number().int().positive()).max(200),
});

export type FilmVoteClientSnapshot = z.infer<typeof snapshotSchema>;

export interface SlotPosition {
  left: number;
  top: number;
}

export interface FlipMotion {
  delayMs: number;
  durationMs: number;
  from: { x: number; y: number };
}

export interface VoteCaseState {
  cassettePosition: "seated";
  isOpen: boolean;
  showsCassette: boolean;
}

export interface VoteToggleInteraction {
  nextHasVoted: boolean;
  suppressPreview: boolean;
}

export const getVoteCaseState = ({
  hasVoted,
}: {
  hasVoted: boolean;
  isLeader: boolean;
}): VoteCaseState => ({
  cassettePosition: "seated",
  isOpen: hasVoted,
  showsCassette: true,
});

export const getVoteToggleInteraction = (
  hasVoted: boolean,
): VoteToggleInteraction => ({
  nextHasVoted: !hasVoted,
  suppressPreview: hasVoted,
});

export const parseFilmVoteSnapshot = (
  rawValue: unknown,
  expectedBoardId: string,
  allowedFilmIds: ReadonlySet<number>,
): FilmVoteClientSnapshot | null => {
  const parsed = snapshotSchema.safeParse(rawValue);
  if (!parsed.success || parsed.data.boardId !== expectedBoardId) {
    return null;
  }

  const rankedFilmIds = parsed.data.ranking.map(({ filmId }) => filmId);
  const uniqueRankedFilmIds = new Set(rankedFilmIds);
  if (
    rankedFilmIds.length !== allowedFilmIds.size ||
    uniqueRankedFilmIds.size !== rankedFilmIds.length ||
    rankedFilmIds.some((filmId) => !allowedFilmIds.has(filmId))
  ) {
    return null;
  }

  const uniqueVotedFilmIds = new Set(parsed.data.votedFilmIds);
  if (
    uniqueVotedFilmIds.size !== parsed.data.votedFilmIds.length ||
    parsed.data.votedFilmIds.some((filmId) => !allowedFilmIds.has(filmId))
  ) {
    return null;
  }

  return parsed.data;
};

export const areVoteSnapshotsEqual = (
  first: FilmVoteClientSnapshot,
  second: FilmVoteClientSnapshot,
): boolean =>
  first.boardId === second.boardId &&
  first.revision === second.revision &&
  first.ranking.length === second.ranking.length &&
  first.ranking.every(
    (entry, index) =>
      entry.filmId === second.ranking[index]?.filmId &&
      entry.votes === second.ranking[index]?.votes,
  ) &&
  first.votedFilmIds.length === second.votedFilmIds.length &&
  first.votedFilmIds.every(
    (filmId, index) => filmId === second.votedFilmIds[index],
  );

const haveSameVoteCounts = (
  first: FilmVoteClientSnapshot,
  second: FilmVoteClientSnapshot,
): boolean => {
  if (first.ranking.length !== second.ranking.length) {
    return false;
  }

  const secondVotesByFilm = new Map(
    second.ranking.map(({ filmId, votes }) => [filmId, votes]),
  );
  return first.ranking.every(
    ({ filmId, votes }) => secondVotesByFilm.get(filmId) === votes,
  );
};

const haveSameVotedFilmIds = (
  first: FilmVoteClientSnapshot,
  second: FilmVoteClientSnapshot,
): boolean =>
  first.votedFilmIds.length === second.votedFilmIds.length &&
  first.votedFilmIds.every(
    (filmId, index) => filmId === second.votedFilmIds[index],
  );

export const shouldApplyVoteSnapshot = (
  activeBoardId: string,
  current: FilmVoteClientSnapshot,
  candidate: FilmVoteClientSnapshot,
): boolean => {
  if (
    current.boardId !== activeBoardId ||
    candidate.boardId !== activeBoardId ||
    candidate.revision < current.revision
  ) {
    return false;
  }

  return (
    candidate.revision > current.revision ||
    areVoteSnapshotsEqual(current, candidate) ||
    (haveSameVoteCounts(current, candidate) &&
      haveSameVotedFilmIds(current, candidate))
  );
};

export const getUniquePositiveLeaderId = (
  ranking: ReadonlyArray<{ filmId: number; votes: number }>,
): number | null => {
  const leader = ranking[0];
  const runnerUp = ranking[1];
  return leader && leader.votes > 0 && leader.votes > (runnerUp?.votes ?? 0)
    ? leader.filmId
    : null;
};

export const getPublishedVoteLeaderId = (
  snapshot: FilmVoteClientSnapshot,
  isAuthoritative: boolean,
): number | null =>
  isAuthoritative ? getUniquePositiveLeaderId(snapshot.ranking) : null;

export const getPublishedVoteTrailerFilmId = (
  snapshot: FilmVoteClientSnapshot,
  isAuthoritative: boolean,
  tmdbScores: ReadonlyMap<number, number>,
): number | null => {
  const topVotes = snapshot.ranking[0]?.votes ?? 0;
  if (!isAuthoritative || topVotes === 0) {
    return null;
  }

  const tiedLeaders = snapshot.ranking.filter(
    ({ votes }) => votes === topVotes,
  );
  return tiedLeaders.reduce((best, candidate) =>
    (tmdbScores.get(candidate.filmId) ?? Number.NEGATIVE_INFINITY) >
    (tmdbScores.get(best.filmId) ?? Number.NEGATIVE_INFINITY)
      ? candidate
      : best,
  ).filmId;
};

export const isPublishedVoteLeader = (
  snapshot: FilmVoteClientSnapshot,
  isAuthoritative: boolean,
  filmId: number,
): boolean => getPublishedVoteLeaderId(snapshot, isAuthoritative) === filmId;

export const getFlipMotion = (
  previous: SlotPosition,
  current: SlotPosition,
  rankDelta: number,
): FlipMotion | null => {
  const x = previous.left - current.left;
  const y = previous.top - current.top;
  if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) {
    return null;
  }

  const distance = Math.hypot(x, y);
  return {
    delayMs: Math.min(100, Math.abs(rankDelta) * 7),
    durationMs: Math.round(Math.min(1_050, 560 + distance * 0.32)),
    from: { x, y },
  };
};
