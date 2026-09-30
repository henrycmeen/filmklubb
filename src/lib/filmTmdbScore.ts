const formatter = new Intl.NumberFormat("nb-NO", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 3,
});

export function tmdbScoreLabel(score?: number): string | null {
  return score !== undefined && Number.isFinite(score)
    ? `TMDB ${formatter.format(score)}`
    : null;
}
