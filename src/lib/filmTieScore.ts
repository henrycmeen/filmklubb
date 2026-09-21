export function tiedVoteCounts(
  ranking: readonly { votes: number }[],
): Set<number> {
  const seen = new Set<number>();
  const tied = new Set<number>();
  for (const { votes } of ranking) {
    if (seen.has(votes)) tied.add(votes);
    seen.add(votes);
  }
  return tied;
}

const formatter = new Intl.NumberFormat("nb-NO", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 3,
});

export function tieScoreLabel(tied: boolean, score?: number): string | null {
  return tied && score !== undefined && Number.isFinite(score)
    ? `TMDB ${formatter.format(score)}`
    : null;
}
