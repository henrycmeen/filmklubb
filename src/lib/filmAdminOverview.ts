import type { ScheduledFilmRound } from "./filmSchedule";

type RoundTiming = Pick<
  ScheduledFilmRound,
  | "published"
  | "completedAt"
  | "voteStartsAt"
  | "voteEndsAt"
  | "resultsAt"
  | "scheduledAt"
  | "displayUntil"
>;

export function groupAdminEvents<T extends RoundTiming>(
  rounds: readonly T[],
  now: number,
) {
  const active: T[] = [];
  const planned: T[] = [];
  const historical: T[] = [];
  for (const round of rounds) {
    if (
      round.completedAt ||
      (round.published && now >= Date.parse(round.displayUntil))
    ) {
      historical.push(round);
    } else if (!round.published || now < Date.parse(round.voteStartsAt)) {
      planned.push(round);
    } else {
      active.push(round);
    }
  }
  const chronological = (a: T, b: T) =>
    Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt);
  return {
    active: active.sort(chronological),
    planned: planned.sort(chronological),
    historical: historical.sort((a, b) => chronological(b, a)),
  };
}

export function adminEventStatus(round: RoundTiming, now: number): string {
  if (
    round.completedAt ||
    (round.published && now >= Date.parse(round.displayUntil))
  )
    return "Gjennomført";
  if (!round.published) return "Utkast";
  if (now < Date.parse(round.voteStartsAt)) return "Planlagt";
  if (now < Date.parse(round.voteEndsAt)) return "Avstemning åpen";
  if (now < Date.parse(round.resultsAt)) return "Venter på resultat";
  return "Resultat publisert";
}

export function adminEventTitle(
  round: Pick<RoundTiming, "scheduledAt">,
): string {
  return new Intl.DateTimeFormat("nb-NO", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Oslo",
  }).format(new Date(round.scheduledAt));
}
