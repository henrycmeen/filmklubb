export type FilmResultVariant = "announcement" | "archive";

export function getFilmResultVariant(
  scheduledAt: string,
  now = Date.now(),
  boardId?: string,
): FilmResultVariant {
  // Keep the Halloween cassette and blood visible after the screening starts.
  if (boardId === "na-halloween-2026") return "announcement";
  const screeningTime = Date.parse(scheduledAt);
  return Number.isFinite(screeningTime) && now < screeningTime
    ? "announcement"
    : "archive";
}
