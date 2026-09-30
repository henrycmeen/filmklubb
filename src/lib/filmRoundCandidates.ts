import type { FilmRoundLockMetadata } from "./filmRound";

/** Keep the original order, scores and ticket artwork when pruning a round. */
export function selectRoundCandidates(
  metadata: FilmRoundLockMetadata,
  candidateIds: readonly number[],
): FilmRoundLockMetadata {
  const ids = new Set(candidateIds);
  return {
    ...metadata,
    catalogue: metadata.catalogue.filter((film) => ids.has(film.id)),
    ticketTemplates: Object.fromEntries(
      Object.entries(metadata.ticketTemplates).filter(([id]) =>
        ids.has(Number(id)),
      ),
    ),
  };
}
