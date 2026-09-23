import type {
  FilmClubHistoryEntry,
  FilmRoundRankingEntry,
} from "./filmRoundClient";

export function archiveWinner(ranking: FilmRoundRankingEntry[]) {
  return ranking[0] && ranking[0].votes > 0 ? ranking[0].film : null;
}

export function otherScreenings(
  entries: FilmClubHistoryEntry[],
  excludeSnapshotId?: string,
) {
  return entries.filter(
    ({ snapshot }) => snapshot.snapshotId !== excludeSnapshotId,
  );
}
