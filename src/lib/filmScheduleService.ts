import { resolveCanonicalClubId } from "@/lib/filmClubProgramme";
import {
  getCurrentFilmRound,
  getFilmRoundBoardId,
} from "@/lib/filmRoundService";
import { getFilmVoteStore, type FilmVoteStore } from "@/lib/filmVotes";
import type { FilmRoundSnapshot } from "@/lib/filmRound";
import type { ScheduledFilmRound } from "@/lib/filmSchedule";

export type PublicFilmRound =
  | {
      status: "open";
      boardId: string;
      scheduledAt?: string;
      venue?: string;
      candidateIds?: number[];
    }
  | { status: "closed"; boardId: string; snapshot: FilmRoundSnapshot }
  | {
      status: "scheduled";
      boardId: string;
      opensAt: string;
      scheduledAt: string;
    }
  | {
      status: "awaiting";
      boardId: string;
      resultsAt: string;
      scheduledAt: string;
    }
  | { status: "idle" };

function scheduledStatus(
  round: ScheduledFilmRound,
  store: FilmVoteStore,
  now: Date,
): PublicFilmRound {
  const time = now.getTime();
  if (time < Date.parse(round.voteStartsAt))
    return {
      status: "scheduled",
      boardId: round.boardId,
      opensAt: round.voteStartsAt,
      scheduledAt: round.scheduledAt,
    };
  const snapshot = store.getLockedRound(round.boardId);
  if (!snapshot && time < Date.parse(round.voteEndsAt))
    return {
      status: "open",
      boardId: round.boardId,
      scheduledAt: round.scheduledAt,
      venue: round.venue,
      candidateIds: round.metadata.catalogue.map((film) => film.id),
    };
  if (time < Date.parse(round.resultsAt))
    return {
      status: "awaiting",
      boardId: round.boardId,
      resultsAt: round.resultsAt,
      scheduledAt: round.scheduledAt,
    };
  if (!snapshot) throw new Error("A closed round has not been finalized.");
  return { status: "closed", boardId: round.boardId, snapshot };
}

/** All public readers share publication rules; draft rounds never leak results. */
export function getPublicFilmRound(
  clubSlug: string,
  screeningId?: string,
  store = getFilmVoteStore(),
  now = new Date(),
): PublicFilmRound | null {
  const clubId = resolveCanonicalClubId(clubSlug);
  store.finalizeDueRounds(clubId, now);
  const rounds = store.listScheduledRounds(clubId);
  const legacy = getCurrentFilmRound(clubId);
  if (screeningId) {
    const boardId = getFilmRoundBoardId(clubId, screeningId);
    const round = store.getScheduledRound(boardId);
    if (round)
      return round.published ? scheduledStatus(round, store, now) : null;
    const snapshot = store.getLockedRound(boardId);
    if (snapshot) return { status: "closed", boardId, snapshot };
    return screeningId === legacy.screeningId
      ? { status: "open", boardId }
      : null;
  }
  const published = rounds
    .filter((round) => round.published)
    .sort((a, b) => Date.parse(a.voteStartsAt) - Date.parse(b.voteStartsAt));
  const active = published.find(
    (round) =>
      Date.parse(round.voteStartsAt) <= now.getTime() &&
      now.getTime() < Date.parse(round.displayUntil),
  );
  if (active) return scheduledStatus(active, store, now);
  // Preparing a new draft must not switch off an existing unmanaged round.
  if (!rounds.some((round) => round.boardId === legacy.boardId)) {
    const snapshot = store.getLockedRound(legacy.boardId);
    return snapshot
      ? { status: "closed", boardId: legacy.boardId, snapshot }
      : { status: "open", boardId: legacy.boardId };
  }
  const upcoming = published.find(
    (round) => now.getTime() < Date.parse(round.voteStartsAt),
  );
  return upcoming ? scheduledStatus(upcoming, store, now) : { status: "idle" };
}

export function getPublicFilmHistory(
  clubSlug: string,
  store = getFilmVoteStore(),
  now = new Date(),
) {
  const clubId = resolveCanonicalClubId(clubSlug);
  store.finalizeDueRounds(clubId, now);
  return store
    .listScheduledRounds(clubId)
    .filter(
      (round) =>
        round.published &&
        round.completedAt &&
        Date.parse(round.resultsAt) <= now.getTime(),
    )
    .sort((a, b) => Date.parse(b.scheduledAt) - Date.parse(a.scheduledAt))
    .flatMap((round) => {
      const snapshot = store.getLockedRound(round.boardId);
      return snapshot ? [{ snapshot, completedAt: round.completedAt! }] : [];
    });
}
