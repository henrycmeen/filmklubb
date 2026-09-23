export type FilmResultVariant = "announcement" | "archive";

export function getFilmResultVariant(
  scheduledAt: string,
  now = Date.now(),
): FilmResultVariant {
  const screeningTime = Date.parse(scheduledAt);
  return Number.isFinite(screeningTime) && now < screeningTime
    ? "announcement"
    : "archive";
}
