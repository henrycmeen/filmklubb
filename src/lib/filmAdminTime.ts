/**
 * Date/time helpers for the private Filmklubben admin page.
 *
 * `datetime-local` deliberately has no timezone. The admin workflow always
 * interprets its value as a Europe/Oslo wall-clock time, independently of the
 * timezone configured on the device running the browser.
 */

export const FILM_ADMIN_TIME_ZONE = "Europe/Oslo";

export type OsloDateTimeErrorCode = "invalid" | "nonexistent" | "ambiguous";

export class OsloDateTimeError extends Error {
  readonly code: OsloDateTimeErrorCode;

  constructor(code: OsloDateTimeErrorCode, message: string) {
    super(message);
    this.name = "OsloDateTimeError";
    this.code = code;
  }
}

const dateTimeLocalPattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

const osloPartsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: FILM_ADMIN_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const osloDisplayFormatter = new Intl.DateTimeFormat("nb-NO", {
  timeZone: FILM_ADMIN_TIME_ZONE,
  dateStyle: "medium",
  timeStyle: "short",
});

interface LocalDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatParts = (date: Date): LocalDateTimeParts => {
  const values = osloPartsFormatter
    .formatToParts(date)
    .reduce<Record<string, string>>((parts, part) => {
      parts[part.type] = part.value;
      return parts;
    }, {});

  const numeric = (name: keyof LocalDateTimeParts): number =>
    Number(values[name]);

  return {
    year: numeric("year"),
    month: numeric("month"),
    day: numeric("day"),
    hour: numeric("hour"),
    minute: numeric("minute"),
    second: numeric("second"),
  };
};

const sameParts = (
  first: LocalDateTimeParts,
  second: LocalDateTimeParts,
): boolean =>
  first.year === second.year &&
  first.month === second.month &&
  first.day === second.day &&
  first.hour === second.hour &&
  first.minute === second.minute &&
  first.second === second.second;

const makeUtcLikeTimestamp = (parts: LocalDateTimeParts): number => {
  // Date.UTC treats years 0..99 as 1900..1999. Setting the full year after
  // constructing the date avoids that legacy behaviour and keeps validation
  // deterministic for all four-digit years accepted by the input.
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour, parts.minute, parts.second, 0);
  return date.getTime();
};

const isValidCalendarValue = (parts: LocalDateTimeParts): boolean => {
  if (
    parts.month < 1 ||
    parts.month > 12 ||
    parts.day < 1 ||
    parts.day > 31 ||
    parts.hour < 0 ||
    parts.hour > 23 ||
    parts.minute < 0 ||
    parts.minute > 59 ||
    parts.second < 0 ||
    parts.second > 59
  ) {
    return false;
  }

  const timestamp = makeUtcLikeTimestamp(parts);
  const date = new Date(timestamp);
  return (
    date.getUTCFullYear() === parts.year &&
    date.getUTCMonth() === parts.month - 1 &&
    date.getUTCDate() === parts.day &&
    date.getUTCHours() === parts.hour &&
    date.getUTCMinutes() === parts.minute &&
    date.getUTCSeconds() === parts.second
  );
};

const parseInputParts = (value: string): LocalDateTimeParts => {
  const match = dateTimeLocalPattern.exec(value.trim());
  if (!match) {
    throw new OsloDateTimeError(
      "invalid",
      "Skriv inn dato og klokkeslett i formatet ÅÅÅÅ-MM-DD TT:MM.",
    );
  }

  const parts: LocalDateTimeParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? "0"),
  };

  if (!isValidCalendarValue(parts)) {
    throw new OsloDateTimeError(
      "invalid",
      "Datoen eller klokkeslettet er ikke gyldig.",
    );
  }

  return parts;
};

/**
 * Find all UTC instants that render as the requested Oslo wall-clock value.
 * A one-minute scan over a generous offset window makes both DST gaps and
 * repeated hours explicit, without relying on the browser's local timezone.
 */
const findMatchingInstants = (parts: LocalDateTimeParts): number[] => {
  const wallClockTimestamp = makeUtcLikeTimestamp(parts);
  const oneMinute = 60_000;
  const searchWindow = 36 * 60 * oneMinute;
  const matches: number[] = [];

  for (
    let timestamp = wallClockTimestamp - searchWindow;
    timestamp <= wallClockTimestamp + searchWindow;
    timestamp += oneMinute
  ) {
    const candidate = new Date(timestamp);
    if (sameParts(formatParts(candidate), parts)) {
      matches.push(timestamp);
    }
  }

  return matches;
};

/**
 * Convert a datetime-local value interpreted in Europe/Oslo to an ISO UTC
 * instant. Nonexistent spring-forward times and ambiguous fall-back times are
 * rejected rather than silently choosing an offset.
 */
export const parseOsloDateTime = (value: string): string => {
  const parts = parseInputParts(value);
  const matches = findMatchingInstants(parts);

  if (matches.length === 0) {
    throw new OsloDateTimeError(
      "nonexistent",
      "Dette klokkeslettet finnes ikke i Europe/Oslo (sommertid starter her). Velg et annet tidspunkt.",
    );
  }

  if (matches.length > 1) {
    throw new OsloDateTimeError(
      "ambiguous",
      "Dette klokkeslettet forekommer to ganger i Europe/Oslo (vintertid starter her). Velg et entydig tidspunkt.",
    );
  }

  return new Date(matches[0]!).toISOString();
};

/** Convert an ISO instant to a datetime-local value in Europe/Oslo. */
export const formatOsloDateTimeInput = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = formatParts(date);
  return [
    `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`,
    `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`,
  ].join("T");
};

export const formatOsloDateTime = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Tidspunkt mangler";
  return osloDisplayFormatter.format(date);
};

export interface OsloScheduleValues {
  voteStartsAt: string;
  voteEndsAt: string;
  resultsAt: string;
  scheduledAt: string;
  displayUntil: string;
}

/** Return a concise Norwegian validation message for a schedule's ordering. */
export const validateOsloScheduleOrder = (
  values: OsloScheduleValues,
): string | null => {
  const fields: Array<keyof OsloScheduleValues> = [
    "voteStartsAt",
    "voteEndsAt",
    "resultsAt",
    "scheduledAt",
    "displayUntil",
  ];

  const timestamps = fields.map((field) => Date.parse(values[field]));
  if (timestamps.some((timestamp) => Number.isNaN(timestamp))) {
    return "Alle tidspunktene må være gyldige.";
  }

  for (let index = 1; index < timestamps.length; index += 1) {
    // Match the server: deadline <= results <= screening, but opening and
    // the end of the display period must be strictly separated.
    const permitsEqual = index === 2 || index === 3;
    if (permitsEqual
      ? timestamps[index - 1]! > timestamps[index]!
      : timestamps[index - 1]! >= timestamps[index]!) {
      const labels = [
        "Stemmestart",
        "Stemmefrist",
        "Resultatslipp",
        "Visning",
        "Visning synlig til",
      ];
      return `${labels[index - 1]} må være før ${labels[index]}.`;
    }
  }

  return null;
};
