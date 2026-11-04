export type FilmResultVariant = "announcement" | "archive";

export function getFilmResultVariant(
  scheduledAt: string,
  now = Date.now(),
  keepAnnouncement = false,
): FilmResultVariant {
  // A configured round keeps its cassette visible after the screening starts.
  if (keepAnnouncement) return "announcement";
  const screeningTime = Date.parse(scheduledAt);
  return Number.isFinite(screeningTime) && now < screeningTime
    ? "announcement"
    : "archive";
}
