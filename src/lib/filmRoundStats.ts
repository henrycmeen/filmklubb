const dateFormatter = new Intl.DateTimeFormat("nb-NO", {
  timeZone: "Europe/Oslo",
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatLastFilmVote(value: string | null): string {
  if (!value) return "Ingen stemmer ennå";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Tidspunkt ukjent"
    : dateFormatter.format(date);
}
