import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { ScheduledFilmRound } from "@/lib/filmSchedule";
import {
  formatOsloDateTimeInput,
  OsloDateTimeError,
  parseOsloDateTime,
  validateOsloScheduleOrder,
} from "@/lib/filmAdminTime";
import styles from "@/styles/filmClubAdmin.module.css";

export interface FilmAdminCatalogueEntry {
  id: number;
  title: string;
  year: number;
}

export interface FilmAdminRoundDraft {
  screeningId: string;
  voteStartsAt: string;
  voteEndsAt: string;
  resultsAt: string;
  scheduledAt: string;
  displayUntil: string;
  venue: string;
  published: boolean;
  candidateIds: number[];
}

interface FilmClubRoundFormProps {
  heading: string;
  intro: string;
  round: ScheduledFilmRound | null;
  catalogue: readonly FilmAdminCatalogueEntry[];
  defaultScreeningId: string;
  screeningIdReadOnly?: boolean;
  readOnly?: boolean;
  freezeCandidates?: boolean;
  onSave: (round: FilmAdminRoundDraft) => Promise<void>;
}

interface FormDraft {
  screeningId: string;
  voteStartsAt: string;
  voteEndsAt: string;
  resultsAt: string;
  scheduledAt: string;
  displayUntil: string;
  venue: string;
  published: boolean;
  candidateIds: number[];
}

const MAX_CANDIDATES = 200;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getRoundMetadata = (
  round: ScheduledFilmRound,
): Record<string, unknown> | null => {
  const metadata = (round as unknown as { metadata?: unknown }).metadata;
  return isRecord(metadata) ? metadata : null;
};

const getRoundCandidateIds = (round: ScheduledFilmRound): number[] => {
  const metadata = getRoundMetadata(round);
  const explicitIds = metadata?.candidateIds;
  if (
    Array.isArray(explicitIds) &&
    explicitIds.every(
      (value) => typeof value === "number" && Number.isInteger(value),
    )
  ) {
    const ids = explicitIds.filter(
      (value): value is number =>
        typeof value === "number" && Number.isInteger(value),
    );
    return Array.from(new Set(ids));
  }

  const metadataCatalogue = metadata?.catalogue;
  if (!Array.isArray(metadataCatalogue)) return [];
  return Array.from(
    new Set(
      metadataCatalogue.flatMap((entry) =>
        isRecord(entry) &&
        typeof entry.id === "number" &&
        Number.isInteger(entry.id)
          ? [entry.id]
          : [],
      ),
    ),
  );
};

const makeNewDraft = (screeningId: string): FormDraft => {
  return {
    screeningId,
    voteStartsAt: "",
    voteEndsAt: "",
    resultsAt: "",
    scheduledAt: "",
    displayUntil: "",
    venue: "Wergelandshallen",
    published: false,
    candidateIds: [],
  };
};

const toFormDraft = (
  round: ScheduledFilmRound | null,
  defaultScreeningId: string,
): FormDraft => {
  if (!round) return makeNewDraft(defaultScreeningId);

  return {
    screeningId: round.screeningId,
    voteStartsAt: formatOsloDateTimeInput(round.voteStartsAt),
    voteEndsAt: formatOsloDateTimeInput(round.voteEndsAt),
    resultsAt: formatOsloDateTimeInput(round.resultsAt),
    scheduledAt: formatOsloDateTimeInput(round.scheduledAt),
    displayUntil: formatOsloDateTimeInput(round.displayUntil),
    venue: round.venue,
    published: round.published,
    candidateIds: getRoundCandidateIds(round),
  };
};

const roundSourceKey = (
  round: ScheduledFilmRound | null,
  defaultScreeningId: string,
): string =>
  round
    ? `${round.boardId}:${round.screeningId}:${round.revision}`
    : `new:${defaultScreeningId}`;

const normalizeCatalogue = (
  catalogue: readonly FilmAdminCatalogueEntry[],
): FilmAdminCatalogueEntry[] => {
  const seen = new Set<number>();
  return catalogue.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
};

const dateFields = [
  ["voteStartsAt", "Stemmestart"],
  ["voteEndsAt", "Stemmefrist"],
  ["resultsAt", "Resultatslipp"],
  ["scheduledAt", "Visning"],
  ["displayUntil", "Visning synlig til"],
] as const;

const parseDateField = (value: string, label: string): string => {
  try {
    return parseOsloDateTime(value);
  } catch (error) {
    if (error instanceof OsloDateTimeError) {
      throw new Error(`${label}: ${error.message}`);
    }
    throw new Error(`${label}: Tidspunktet kunne ikke leses.`);
  }
};

export function FilmClubRoundForm({
  heading,
  intro,
  round,
  catalogue,
  defaultScreeningId,
  screeningIdReadOnly = Boolean(round),
  readOnly = false,
  freezeCandidates = false,
  onSave,
}: FilmClubRoundFormProps) {
  const fieldPrefix = useId();
  const sourceKey = roundSourceKey(round, defaultScreeningId);
  const sourceKeyRef = useRef(sourceKey);
  const [draft, setDraft] = useState<FormDraft>(() =>
    toFormDraft(round, defaultScreeningId),
  );
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (sourceKeyRef.current === sourceKey) return;
    sourceKeyRef.current = sourceKey;
    setDraft(toFormDraft(round, defaultScreeningId));
    setDirty(false);
    setError(null);
    setQuery("");
  }, [defaultScreeningId, round, sourceKey]);

  const normalizedCatalogue = useMemo(
    () => normalizeCatalogue(catalogue),
    [catalogue],
  );
  const selectedIds = useMemo(
    () => new Set(draft.candidateIds),
    [draft.candidateIds],
  );
  const selectedFilms = useMemo(
    () =>
      draft.candidateIds.map(
        (id) =>
          normalizedCatalogue.find((entry) => entry.id === id) ?? {
            id,
            title: `Film ${id}`,
            year: 0,
          },
      ),
    [draft.candidateIds, normalizedCatalogue],
  );
  const availableFilms = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("nb-NO");
    return normalizedCatalogue.filter((film) => {
      if (!needle) return true;
      return `${film.title} ${film.year}`
        .toLocaleLowerCase("nb-NO")
        .includes(needle);
    });
  }, [normalizedCatalogue, query]);

  const update = <Key extends keyof FormDraft>(
    key: Key,
    value: FormDraft[Key],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setError(null);
  };

  const toggleFilm = (id: number) => {
    if (freezeCandidates || readOnly || saving) return;
    if (!selectedIds.has(id) && draft.candidateIds.length >= MAX_CANDIDATES) {
      setError(`Du kan velge maksimalt ${MAX_CANDIDATES} filmer.`);
      return;
    }
    setDraft((current) => {
      const selected = new Set(current.candidateIds);
      if (selected.has(id)) {
        selected.delete(id);
      } else {
        selected.add(id);
      }
      return { ...current, candidateIds: Array.from(selected) };
    });
    setDirty(true);
    setError(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (readOnly || saving || !dirty) return;
    setError(null);

    try {
      if (!draft.screeningId.trim()) {
        throw new Error("Screening-ID må være utfylt.");
      }
      if (!draft.venue.trim()) {
        throw new Error("Sted må være utfylt.");
      }
      if (draft.candidateIds.length === 0) {
        throw new Error("Velg minst én film til avstemningen.");
      }

      const parsedDates = Object.fromEntries(
        dateFields.map(([key, label]) => [
          key,
          parseDateField(draft[key], label),
        ]),
      ) as Record<(typeof dateFields)[number][0], string>;
      const scheduleError = validateOsloScheduleOrder({
        voteStartsAt: parsedDates.voteStartsAt,
        voteEndsAt: parsedDates.voteEndsAt,
        resultsAt: parsedDates.resultsAt,
        scheduledAt: parsedDates.scheduledAt,
        displayUntil: parsedDates.displayUntil,
      });
      if (scheduleError) throw new Error(scheduleError);

      setSaving(true);
      await onSave({
        screeningId: draft.screeningId.trim(),
        voteStartsAt: parsedDates.voteStartsAt,
        voteEndsAt: parsedDates.voteEndsAt,
        resultsAt: parsedDates.resultsAt,
        scheduledAt: parsedDates.scheduledAt,
        displayUntil: parsedDates.displayUntil,
        venue: draft.venue.trim(),
        published: draft.published,
        candidateIds: draft.candidateIds,
      });
      setDirty(false);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Runden kunne ikke lagres.",
      );
    } finally {
      setSaving(false);
    }
  };

  const disabled = readOnly || saving;
  const formDescriptionId = `${fieldPrefix}-description`;
  const formErrorId = `${fieldPrefix}-error`;

  return (
    <section
      className={styles.formSection}
      aria-labelledby={`${fieldPrefix}-heading`}
    >
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.eyebrow}>Rundeoppsett</p>
          <h2 id={`${fieldPrefix}-heading`}>{heading}</h2>
        </div>
        {round ? (
          <span className={styles.revision}>rev. {round.revision}</span>
        ) : null}
      </div>
      <p className={styles.formIntro} id={formDescriptionId}>
        {intro} Tidspunkter tolkes alltid som Europe/Oslo.
      </p>
      {freezeCandidates ? (
        <p className={styles.formLockNotice}>
          Filmutvalget er låst etter stemmestart. Stemmer kan ikke slettes eller
          nullstilles.
        </p>
      ) : null}
      <form
        className={styles.form}
        onSubmit={submit}
        aria-describedby={
          error ? `${formDescriptionId} ${formErrorId}` : formDescriptionId
        }
      >
        <fieldset disabled={disabled}>
          <legend>Identitet og visning</legend>
          <div className={styles.field}>
            <label htmlFor={`${fieldPrefix}-screening-id`}>Screening-ID</label>
            <input
              id={`${fieldPrefix}-screening-id`}
              value={draft.screeningId}
              readOnly={screeningIdReadOnly}
              required
              spellCheck={false}
              aria-readonly={screeningIdReadOnly ? "true" : undefined}
              onChange={(event) => update("screeningId", event.target.value)}
            />
            <span className={styles.fieldHint}>
              {screeningIdReadOnly
                ? "ID-en endres ikke når en runde først er opprettet."
                : "Velg en stabil ID. Den skal ikke baseres på datoen."}
            </span>
          </div>
          <div className={styles.field}>
            <label htmlFor={`${fieldPrefix}-venue`}>Sted</label>
            <input
              id={`${fieldPrefix}-venue`}
              value={draft.venue}
              onChange={(event) => update("venue", event.target.value)}
              placeholder="Kino eller lokale"
              required
            />
          </div>
        </fieldset>

        <fieldset disabled={disabled}>
          <legend>Tidslinje</legend>
          <div className={styles.scheduleFields}>
            {dateFields.map(([key, label]) => (
              <div className={styles.field} key={key}>
                <label htmlFor={`${fieldPrefix}-${key}`}>{label}</label>
                <input
                  id={`${fieldPrefix}-${key}`}
                  type="datetime-local"
                  value={draft[key]}
                  onChange={(event) => update(key, event.target.value)}
                  required
                />
                <span className={styles.fieldHint}>Europe/Oslo</span>
              </div>
            ))}
          </div>
        </fieldset>

        <fieldset disabled={disabled || freezeCandidates}>
          <legend>Filmer i avstemningen</legend>
          <div className={styles.catalogueSummary}>
            <span>{draft.candidateIds.length} valgt</span>
            <span>Maks {MAX_CANDIDATES}</span>
          </div>
          <div className={styles.field}>
            <label htmlFor={`${fieldPrefix}-catalogue-search`}>
              Søk i katalogen
            </label>
            <input
              id={`${fieldPrefix}-catalogue-search`}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tittel eller år"
              autoComplete="off"
            />
          </div>
          {selectedFilms.length ? (
            <p className={styles.selectedSummary}>
              Valgt: {selectedFilms.map((film) => film.title).join(", ")}
            </p>
          ) : null}
          <div
            className={styles.catalogueList}
            role="group"
            aria-label="Filmkatalog"
          >
            {availableFilms.length ? (
              availableFilms.map((film) => (
                <label className={styles.catalogueOption} key={film.id}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(film.id)}
                    onChange={() => toggleFilm(film.id)}
                  />
                  <span className={styles.catalogueTitle}>{film.title}</span>
                  <span className={styles.catalogueYear}>{film.year}</span>
                </label>
              ))
            ) : (
              <p className={styles.emptyState}>Ingen filmer matcher søket.</p>
            )}
          </div>
        </fieldset>

        <fieldset disabled={disabled}>
          <legend>Publisering</legend>
          <label className={styles.checkboxOption}>
            <input
              type="checkbox"
              checked={draft.published}
              onChange={(event) => update("published", event.target.checked)}
            />
            <span>Publiser resultatet når serveren åpner det</span>
          </label>
        </fieldset>

        {error ? (
          <p className={styles.errorMessage} id={formErrorId} role="alert">
            {error}
          </p>
        ) : null}
        {!readOnly ? (
          <div className={styles.formActions}>
            <button
              className={styles.button}
              type="submit"
              disabled={!dirty || saving}
            >
              {saving ? "Lagrer …" : "Lagre runde"}
            </button>
            {dirty ? (
              <span className={styles.unsavedNotice}>Ulagrede endringer</span>
            ) : null}
          </div>
        ) : null}
      </form>
    </section>
  );
}
