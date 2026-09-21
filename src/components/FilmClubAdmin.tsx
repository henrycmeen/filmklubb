import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { ScheduledFilmRound } from "@/lib/filmSchedule";
import { withBasePath } from "@/lib/basePath";
import { formatOsloDateTime } from "@/lib/filmAdminTime";
import {
  FilmClubRoundForm,
  type FilmAdminCatalogueEntry,
  type FilmAdminRoundDraft,
} from "@/components/FilmClubRoundForm";
import styles from "@/styles/filmClubAdmin.module.css";

interface FilmClubAdminProps {
  clubSlug: string;
}

interface FilmClubAdminCurrentPointer {
  boardId: string;
  screeningId: string;
  scheduledAt: string;
}

interface FilmClubAdminResponse {
  rounds: ScheduledFilmRound[];
  catalogue: FilmAdminCatalogueEntry[];
  current: FilmClubAdminCurrentPointer | null;
}

interface FilmClubAdminSession {
  authenticated: boolean;
  needsSetup: boolean;
  canSetup: boolean;
}

type AdminStatus = "loading" | "ready" | "error";
type SessionStatus = "loading" | "login" | "ready" | "error";

type AdminAction =
  | {
      action: "save";
      expectedRevision: number | null;
      round: FilmAdminRoundDraft;
    }
  | { action: "close" | "complete"; boardId: string; expectedRevision: number };

class FilmClubAdminRequestError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "FilmClubAdminRequestError";
    this.status = status;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getErrorMessage = (value: unknown): string | null => {
  if (!isRecord(value)) return null;
  const error = value.error;
  if (typeof error === "string" && error.trim()) return error.trim();
  if (
    isRecord(error) &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message.trim();
  }
  if (typeof value.message === "string" && value.message.trim()) {
    return value.message.trim();
  }
  return null;
};

const parseAdminResponse = (value: unknown): FilmClubAdminResponse => {
  if (
    !isRecord(value) ||
    !Array.isArray(value.rounds) ||
    !Array.isArray(value.catalogue)
  ) {
    throw new FilmClubAdminRequestError(
      "Administrasjonen svarte med et ugyldig format.",
    );
  }

  const catalogue = value.catalogue.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    if (
      typeof entry.id !== "number" ||
      !Number.isInteger(entry.id) ||
      typeof entry.title !== "string" ||
      typeof entry.year !== "number"
    ) {
      return [];
    }
    return [{ id: entry.id, title: entry.title, year: entry.year }];
  });

  const currentValue = value.current;
  const current =
    isRecord(currentValue) &&
    typeof currentValue.boardId === "string" &&
    typeof currentValue.screeningId === "string" &&
    typeof currentValue.scheduledAt === "string"
      ? {
          boardId: currentValue.boardId,
          screeningId: currentValue.screeningId,
          scheduledAt: currentValue.scheduledAt,
        }
      : null;

  return {
    rounds: value.rounds as ScheduledFilmRound[],
    catalogue,
    current,
  };
};

const parseSession = (value: unknown): FilmClubAdminSession => {
  if (!isRecord(value) || typeof value.authenticated !== "boolean") {
    throw new FilmClubAdminRequestError(
      "Påloggingsstatus hadde et ugyldig format.",
    );
  }
  return {
    authenticated: value.authenticated,
    needsSetup: value.needsSetup === true,
    canSetup: value.canSetup === true,
  };
};

const fetchJson = async (
  url: string,
  options: RequestInit,
): Promise<unknown> => {
  const response = await fetch(url, {
    ...options,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    let message = "Forespørselen kunne ikke gjennomføres.";
    try {
      message = getErrorMessage(await response.json()) ?? message;
    } catch {
      // Keep the concise fallback when the server did not return JSON.
    }
    throw new FilmClubAdminRequestError(message, response.status);
  }
  return response.json();
};

const sessionUrl = (clubSlug: string): string =>
  withBasePath(
    `/api/club/admin-session?${new URLSearchParams({ clubSlug }).toString()}`,
  );

const adminUrl = (clubSlug: string): string =>
  withBasePath(
    `/api/club/admin?${new URLSearchParams({ clubSlug }).toString()}`,
  );

const fetchSession = async (
  clubSlug: string,
  signal?: AbortSignal,
): Promise<FilmClubAdminSession> =>
  parseSession(
    await fetchJson(sessionUrl(clubSlug), { method: "GET", signal }),
  );

const fetchProgramme = async (
  clubSlug: string,
  signal?: AbortSignal,
): Promise<FilmClubAdminResponse> =>
  parseAdminResponse(
    await fetchJson(adminUrl(clubSlug), { method: "GET", signal }),
  );

const postSessionAction = async (
  clubSlug: string,
  body: Record<string, unknown>,
): Promise<FilmClubAdminSession> =>
  parseSession(
    await fetchJson(sessionUrl(clubSlug), {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );

const postAdminAction = async (
  clubSlug: string,
  body: AdminAction,
): Promise<void> => {
  await fetchJson(adminUrl(clubSlug), {
    method: "POST",
    body: JSON.stringify(body),
  });
};

const getRoundMetadata = (
  round: ScheduledFilmRound,
): Record<string, unknown> | null => {
  const metadata = (round as unknown as { metadata?: unknown }).metadata;
  return isRecord(metadata) ? metadata : null;
};

const getRoundCandidateIds = (round: ScheduledFilmRound): number[] => {
  const metadata = getRoundMetadata(round);
  const explicit = metadata?.candidateIds;
  if (
    Array.isArray(explicit) &&
    explicit.every(
      (value) => typeof value === "number" && Number.isInteger(value),
    )
  ) {
    const ids = explicit.filter(
      (value): value is number =>
        typeof value === "number" && Number.isInteger(value),
    );
    return Array.from(new Set(ids));
  }
  const roundCatalogue = metadata?.catalogue;
  if (!Array.isArray(roundCatalogue)) return [];
  return Array.from(
    new Set(
      roundCatalogue.flatMap((entry) =>
        isRecord(entry) &&
        typeof entry.id === "number" &&
        Number.isInteger(entry.id)
          ? [entry.id]
          : [],
      ),
    ),
  );
};

const completedAt = (round: ScheduledFilmRound): string | null => {
  const value = (round as unknown as { completedAt?: unknown }).completedAt;
  return typeof value === "string" && value ? value : null;
};

const roundMatchesPointer = (
  round: ScheduledFilmRound,
  pointer: FilmClubAdminCurrentPointer | null,
): boolean => {
  if (!pointer) return false;
  return (
    round.boardId === pointer.boardId ||
    (round.screeningId === pointer.screeningId &&
      round.scheduledAt === pointer.scheduledAt)
  );
};

const roundTimestamp = (round: ScheduledFilmRound): number => {
  const timestamp = Date.parse(round.scheduledAt);
  return Number.isNaN(timestamp) ? Number.MAX_SAFE_INTEGER : timestamp;
};

interface GroupedRounds {
  current: ScheduledFilmRound | null;
  next: ScheduledFilmRound | null;
  history: ScheduledFilmRound[];
}

const groupRounds = (
  data: FilmClubAdminResponse,
  now: number,
): GroupedRounds => {
  const sorted = [...data.rounds].sort((first, second) => {
    const timestampDifference = roundTimestamp(first) - roundTimestamp(second);
    return (
      timestampDifference || first.screeningId.localeCompare(second.screeningId)
    );
  });
  const isPublishedInWindow = (round: ScheduledFilmRound): boolean => {
    const voteStartsAt = Date.parse(round.voteStartsAt);
    const displayUntil = Date.parse(round.displayUntil);
    return (
      round.published &&
      Number.isFinite(voteStartsAt) &&
      now >= voteStartsAt &&
      Number.isFinite(displayUntil) &&
      now < displayUntil
    );
  };
  let current =
    sorted.find(
      (round) =>
        !completedAt(round) &&
        isPublishedInWindow(round) &&
        roundMatchesPointer(round, data.current),
    ) ?? null;

  if (!current) {
    current =
      sorted.find((round) => {
        return !completedAt(round) && isPublishedInWindow(round);
      }) ?? null;
  }

  const next =
    sorted.find((round) => {
      if (round === current || completedAt(round)) return false;
      if (!round.published) return true;
      const displayUntil = Date.parse(round.displayUntil);
      return Number.isFinite(displayUntil) && now < displayUntil;
    }) ?? null;
  const history = sorted.filter((round) => round !== current && round !== next);
  return { current, next, history };
};

const roundStatus = (round: ScheduledFilmRound, now: number): string => {
  if (!round.published) return "Utkast";
  if (completedAt(round)) return "Fullført";
  if (round.published && now >= roundTimestamp(round)) return "Publisert";
  const starts = Date.parse(round.voteStartsAt);
  const ends = Date.parse(round.voteEndsAt);
  const results = Date.parse(round.resultsAt);
  if (Number.isFinite(starts) && now < starts) return "Planlagt";
  if (Number.isFinite(ends) && now < ends) return "Pågår";
  if (Number.isFinite(results) && now < results) return "Stengt for stemmer";
  return "Resultat klart";
};

const isVotingClosed = (round: ScheduledFilmRound, now: number): boolean => {
  const starts = Date.parse(round.voteStartsAt);
  return (
    Boolean(completedAt(round)) || (Number.isFinite(starts) && now >= starts)
  );
};

const isRoundClosed = (round: ScheduledFilmRound, now: number): boolean => {
  const ends = Date.parse(round.voteEndsAt);
  return Boolean(completedAt(round)) || (Number.isFinite(ends) && now >= ends);
};

const formatRoundDate = (value: string): string => formatOsloDateTime(value);

const RoundTimeline = ({ round }: { round: ScheduledFilmRound }) => (
  <dl className={styles.timeline}>
    <div className={styles.timelineItem}>
      <dt>Stemmestart</dt>
      <dd>{formatRoundDate(round.voteStartsAt)}</dd>
    </div>
    <div className={styles.timelineItem}>
      <dt>Stemmefrist</dt>
      <dd>{formatRoundDate(round.voteEndsAt)}</dd>
    </div>
    <div className={styles.timelineItem}>
      <dt>Resultatslipp</dt>
      <dd>{formatRoundDate(round.resultsAt)}</dd>
    </div>
    <div className={styles.timelineItem}>
      <dt>Visning</dt>
      <dd>{formatRoundDate(round.scheduledAt)}</dd>
    </div>
    <div className={styles.timelineItem}>
      <dt>Sted</dt>
      <dd>{round.venue}</dd>
    </div>
  </dl>
);

interface RoundSummaryProps {
  eyebrow: string;
  round: ScheduledFilmRound;
  now: number;
  busy: boolean;
  catalogue: readonly FilmAdminCatalogueEntry[];
  onClose: (round: ScheduledFilmRound) => void;
  onComplete: (round: ScheduledFilmRound) => void;
}

const RoundSummary = ({
  eyebrow,
  round,
  now,
  busy,
  catalogue,
  onClose,
  onComplete,
}: RoundSummaryProps) => {
  const catalogueById = new Map(catalogue.map((film) => [film.id, film]));
  const candidateNames = getRoundCandidateIds(round).map(
    (id) => catalogueById.get(id)?.title ?? `Film ${id}`,
  );
  const status = roundStatus(round, now);
  const canClose =
    round.published &&
    !completedAt(round) &&
    now >= Date.parse(round.voteStartsAt) &&
    now < Date.parse(round.voteEndsAt) &&
    now < roundTimestamp(round);
  const canComplete =
    round.published && now >= roundTimestamp(round) && !completedAt(round);

  return (
    <section
      className={styles.roundSection}
      aria-labelledby={`${round.boardId}-heading`}
    >
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h2 id={`${round.boardId}-heading`}>{round.screeningId}</h2>
        </div>
        <span className={styles.roundStatus} data-status={status}>
          {status}
        </span>
      </div>
      <p className={styles.roundMeta}>
        {round.boardId} · rev. {round.revision}
      </p>
      <RoundTimeline round={round} />
      <div className={styles.roundFacts}>
        <span>{candidateNames.length} filmer valgt</span>
        <span>{round.published ? "Publisert" : "Ikke publisert"}</span>
      </div>
      {candidateNames.length ? (
        <details className={styles.candidateNames}>
          <summary>Vis filmutvalget</summary>
          <p>{candidateNames.join(" · ")}</p>
        </details>
      ) : (
        <p className={styles.emptyState}>Ingen filmutvalg er registrert.</p>
      )}
      <div className={styles.roundActions}>
        {canClose ? (
          <button
            className={styles.dangerButton}
            type="button"
            disabled={busy}
            onClick={() => onClose(round)}
          >
            Avslutt nå
          </button>
        ) : null}
        {canComplete ? (
          <button
            className={styles.button}
            type="button"
            disabled={busy}
            onClick={() => onComplete(round)}
          >
            Marker visningen som fullført
          </button>
        ) : null}
      </div>
      {completedAt(round) ? (
        <p className={styles.completedNotice}>
          Fullført {formatRoundDate(completedAt(round) ?? "")}.
        </p>
      ) : null}
      {status === "Stengt for stemmer" ? (
        <p className={styles.lockedNotice}>
          Resultatet er låst. Filmutvalget og stemmene er bevart og kan ikke
          endres.
        </p>
      ) : null}
    </section>
  );
};

const HistoryList = ({
  rounds,
  catalogue,
  now,
}: {
  rounds: readonly ScheduledFilmRound[];
  catalogue: readonly FilmAdminCatalogueEntry[];
  now: number;
}) => {
  if (!rounds.length) {
    return (
      <section
        className={styles.historySection}
        aria-labelledby="history-heading"
      >
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Historikk</p>
            <h2 id="history-heading">Ingen tidligere runder</h2>
          </div>
        </div>
        <p className={styles.emptyState}>
          Historikken fylles ut når en runde er fullført.
        </p>
      </section>
    );
  }

  const catalogueById = new Map(catalogue.map((film) => [film.id, film]));
  return (
    <section
      className={styles.historySection}
      aria-labelledby="history-heading"
    >
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.eyebrow}>Historikk</p>
          <h2 id="history-heading">Tidligere runder</h2>
        </div>
        <span className={styles.revision}>{rounds.length}</span>
      </div>
      <ol className={styles.historyList}>
        {rounds.map((round) => {
          const ids = getRoundCandidateIds(round);
          const firstFilm = ids.length
            ? catalogueById.get(ids[0]!)?.title
            : null;
          return (
            <li
              className={styles.historyRow}
              key={`${round.boardId}-${round.revision}`}
            >
              <span>
                <strong>{round.screeningId}</strong>
                <time dateTime={round.scheduledAt}>
                  {formatRoundDate(round.scheduledAt)} · {round.venue}
                </time>
              </span>
              <span>
                {roundStatus(round, now)}
                <small>{firstFilm ?? `${ids.length} filmer`}</small>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
};

const LoginPanel = ({
  clubSlug,
  session,
  onAuthenticated,
}: {
  clubSlug: string;
  session: FilmClubAdminSession;
  onAuthenticated: (session: FilmClubAdminSession) => void;
}) => {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setup = session.needsSetup && session.canSetup;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (setup && password !== confirmation) {
      setError("Passordene er ikke like.");
      return;
    }
    if (!password) {
      setError("Skriv inn passordet.");
      return;
    }
    setBusy(true);
    try {
      const next = await postSessionAction(clubSlug, {
        action: setup ? "setup" : "login",
        password,
      });
      setPassword("");
      setConfirmation("");
      onAuthenticated(next);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Påloggingen kunne ikke gjennomføres.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={styles.page}>
      <div className={styles.shellNarrow}>
        <header className={styles.masthead}>
          <div>
            <p className={styles.eyebrow}>Filmklubben / administrasjon</p>
            <h1>{setup ? "Sett opp tilgang." : "Logg inn."}</h1>
            <p className={styles.clubLine}>
              Lokal administrasjon for {clubSlug}.
            </p>
          </div>
          <span className={styles.localMark}>LOKAL</span>
        </header>
        {session.needsSetup && !session.canSetup ? (
          <p className={styles.lockedNotice} role="alert">
            Lokal oppsettstilgang er ikke tilgjengelig fra denne forbindelsen.
          </p>
        ) : (
          <form
            className={styles.loginForm}
            onSubmit={submit}
            aria-describedby={error ? "film-admin-login-error" : undefined}
          >
            <p className={styles.formIntro}>
              {setup
                ? "Velg et lokalt administratorpassord. Det lagres bare som en sikret serverside-hash."
                : "Bruk administratorpassordet for denne lokale Filmklubb-instansen."}
            </p>
            <div className={styles.field}>
              <label htmlFor="film-admin-password">Passord</label>
              <input
                id="film-admin-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={setup ? "new-password" : "current-password"}
                required
              />
            </div>
            {setup ? (
              <div className={styles.field}>
                <label htmlFor="film-admin-confirmation">Gjenta passord</label>
                <input
                  id="film-admin-confirmation"
                  type="password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  autoComplete="new-password"
                  required
                />
              </div>
            ) : null}
            {error ? (
              <p
                className={styles.errorMessage}
                id="film-admin-login-error"
                role="alert"
              >
                {error}
              </p>
            ) : null}
            <div className={styles.formActions}>
              <button className={styles.button} type="submit" disabled={busy}>
                {busy
                  ? "Arbeider …"
                  : setup
                    ? "Lagre lokalt passord"
                    : "Logg inn"}
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
};

export function FilmClubAdmin({ clubSlug }: FilmClubAdminProps) {
  const [session, setSession] = useState<FilmClubAdminSession | null>(null);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("loading");
  const [programme, setProgramme] = useState<FilmClubAdminResponse | null>(
    null,
  );
  const [programmeStatus, setProgrammeStatus] =
    useState<AdminStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("Sjekker lokal tilgang …");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(() => setReloadToken((value) => value + 1), []);

  const loadProgramme = useCallback(
    async (signal?: AbortSignal): Promise<FilmClubAdminResponse> => {
      const next = await fetchProgramme(clubSlug, signal);
      setProgramme(next);
      setProgrammeStatus("ready");
      setNow(Date.now());
      return next;
    },
    [clubSlug],
  );

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const load = async () => {
      setSessionStatus("loading");
      setProgrammeStatus("loading");
      setError(null);
      try {
        const nextSession = await fetchSession(clubSlug, controller.signal);
        if (cancelled) return;
        setSession(nextSession);
        if (!nextSession.authenticated) {
          setSessionStatus("login");
          setProgramme(null);
          setNotice("Pålogging kreves.");
          return;
        }
        setSessionStatus("ready");
        await loadProgramme(controller.signal);
        if (!cancelled) setNotice("Administrasjonen er klar.");
      } catch (caught) {
        if (
          cancelled ||
          (caught instanceof Error && caught.name === "AbortError")
        )
          return;
        if (
          caught instanceof FilmClubAdminRequestError &&
          caught.status === 401
        ) {
          setSession((current) =>
            current ? { ...current, authenticated: false } : current,
          );
          setSessionStatus("login");
          setProgramme(null);
          setProgrammeStatus("loading");
          setNotice("Påloggingen er utløpt.");
          return;
        }
        setSessionStatus("error");
        setProgrammeStatus("error");
        setError(
          caught instanceof Error
            ? caught.message
            : "Administrasjonen kunne ikke lastes.",
        );
      }
    };
    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [clubSlug, loadProgramme, reloadToken]);

  const performAction = useCallback(
    async (action: AdminAction, successNotice: string) => {
      setBusyAction(action.action);
      setError(null);
      try {
        await postAdminAction(clubSlug, action);
        await loadProgramme();
        setNotice(successNotice);
      } catch (caught) {
        const requestError =
          caught instanceof FilmClubAdminRequestError
            ? caught
            : new FilmClubAdminRequestError(
                caught instanceof Error
                  ? caught.message
                  : "Handlingen kunne ikke gjennomføres.",
              );
        if (requestError.status === 401) {
          setSession((current) =>
            current ? { ...current, authenticated: false } : current,
          );
          setSessionStatus("login");
          setProgramme(null);
          setProgrammeStatus("loading");
        }
        if (requestError.status === 409) {
          setError(
            "Dataene ble endret et annet sted. Last inn på nytt før du lagrer, slik at stemmer og endringer ikke overskrives.",
          );
        } else {
          setError(requestError.message);
        }
        throw requestError;
      } finally {
        setBusyAction(null);
      }
    },
    [clubSlug, loadProgramme],
  );

  const logout = useCallback(async () => {
    setBusyAction("logout");
    setError(null);
    try {
      const next = await postSessionAction(clubSlug, { action: "logout" });
      setSession(next);
      setSessionStatus("login");
      setProgramme(null);
      setProgrammeStatus("loading");
      setNotice("Du er logget ut.");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Kunne ikke logge ut.",
      );
    } finally {
      setBusyAction(null);
    }
  }, [clubSlug]);

  const grouped = useMemo(
    () => (programme ? groupRounds(programme, now) : null),
    [now, programme],
  );
  const defaultScreeningId = programme?.current?.screeningId ?? "oktober-2026";
  const nextDefaultScreeningId =
    grouped?.next?.screeningId ??
    `${grouped?.current?.screeningId ?? defaultScreeningId}-next`;

  const requestClose = useCallback(
    (round: ScheduledFilmRound) => {
      const resultsAt = formatRoundDate(round.resultsAt);
      if (
        !window.confirm(
          `Avslutt avstemningen for ${round.screeningId} nå? Dette avslutter og offentliggjør resultatet nå. Stemmer og filmutvalg beholdes. Planlagt resultatslipp var ${resultsAt}.`,
        )
      ) {
        return;
      }
      void performAction(
        {
          action: "close",
          boardId: round.boardId,
          expectedRevision: round.revision,
        },
        "Avstemningen er avsluttet og resultatet er publisert.",
      ).catch(() => undefined);
    },
    [performAction],
  );

  const requestComplete = useCallback(
    (round: ScheduledFilmRound) => {
      void performAction(
        {
          action: "complete",
          boardId: round.boardId,
          expectedRevision: round.revision,
        },
        "Visningen er markert som fullført.",
      ).catch(() => undefined);
    },
    [performAction],
  );

  if (sessionStatus === "loading") {
    return (
      <main className={styles.page} aria-busy="true">
        <div className={styles.shellNarrow}>
          <p className={styles.loadingState}>Sjekker lokal tilgang …</p>
        </div>
      </main>
    );
  }

  if (sessionStatus === "login" && session) {
    return (
      <LoginPanel
        clubSlug={clubSlug}
        session={session}
        onAuthenticated={(next) => {
          setSession(next);
          setSessionStatus("ready");
          refresh();
        }}
      />
    );
  }

  if (sessionStatus === "error" || !session?.authenticated) {
    return (
      <main className={styles.page}>
        <div className={styles.shellNarrow}>
          <p className={styles.errorMessage} role="alert">
            {error ?? "Administrasjonen kunne ikke lastes."}
          </p>
          <button className={styles.button} type="button" onClick={refresh}>
            Prøv igjen
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.masthead}>
          <div>
            <p className={styles.eyebrow}>Filmklubben / administrasjon</p>
            <h1>Planlegg runder.</h1>
            <p className={styles.clubLine}>
              Klubb: <strong>{clubSlug}</strong>
            </p>
          </div>
          <div className={styles.headerActions}>
            <span className={styles.localMark}>LOKAL</span>
            <button
              className={styles.quietButton}
              type="button"
              onClick={() => void logout()}
              disabled={busyAction !== null}
            >
              Logg ut
            </button>
          </div>
        </header>
        <div className={styles.statusLine}>
          <p className={styles.statusMessage} role="status" aria-live="polite">
            {notice}
          </p>
          <button
            className={styles.quietButton}
            type="button"
            onClick={refresh}
            disabled={busyAction !== null}
          >
            Last inn på nytt
          </button>
        </div>
        {error ? (
          <p className={styles.errorMessage} role="alert">
            {error}
          </p>
        ) : null}
        {programmeStatus === "loading" && !programme ? (
          <p className={styles.loadingState} aria-busy="true">
            Laster rundene …
          </p>
        ) : null}
        {programmeStatus === "error" && !programme ? (
          <p className={styles.errorMessage} role="alert">
            Administrasjonen kunne ikke lastes. Bruk «Last inn på nytt».
          </p>
        ) : null}
        {programme && grouped ? (
          <>
            {grouped.current ? (
              <RoundSummary
                eyebrow="Nåværende"
                round={grouped.current}
                now={now}
                busy={busyAction !== null}
                catalogue={programme.catalogue}
                onClose={requestClose}
                onComplete={requestComplete}
              />
            ) : (
              <section
                className={styles.roundSection}
                aria-labelledby="current-heading"
              >
                <div className={styles.sectionHeading}>
                  <div>
                    <p className={styles.eyebrow}>Nåværende</p>
                    <h2 id="current-heading">Ingen aktiv runde</h2>
                  </div>
                </div>
                <p className={styles.emptyState}>
                  Opprett den første runden under.
                </p>
              </section>
            )}

            {grouped.current ? (
              <section
                className={styles.editorSection}
                aria-label="Nåværende plan"
              >
                <FilmClubRoundForm
                  heading="Nåværende plan"
                  intro="Oppdater tidslinje og sted uten å endre rundens identitet."
                  round={grouped.current}
                  catalogue={programme.catalogue}
                  defaultScreeningId={grouped.current.screeningId}
                  screeningIdReadOnly
                  readOnly={isRoundClosed(grouped.current, now)}
                  freezeCandidates={isVotingClosed(grouped.current, now)}
                  onSave={async (round) => {
                    await performAction(
                      {
                        action: "save",
                        expectedRevision: grouped.current?.revision ?? null,
                        round,
                      },
                      "Nåværende plan er lagret.",
                    );
                  }}
                />
              </section>
            ) : null}

            <section className={styles.editorSection} aria-label="Neste runde">
              <FilmClubRoundForm
                heading={grouped.next ? "Neste runde" : "Klargjør neste runde"}
                intro={
                  grouped.next
                    ? "Rediger planen før stemmingen starter."
                    : "Lag en ny runde med en stabil screening-ID."
                }
                round={grouped.next}
                catalogue={programme.catalogue}
                defaultScreeningId={nextDefaultScreeningId}
                screeningIdReadOnly={Boolean(grouped.next)}
                readOnly={
                  grouped.next ? isRoundClosed(grouped.next, now) : false
                }
                freezeCandidates={
                  grouped.next ? isVotingClosed(grouped.next, now) : false
                }
                onSave={async (round) => {
                  await performAction(
                    {
                      action: "save",
                      expectedRevision: grouped.next?.revision ?? null,
                      round,
                    },
                    "Neste runde er lagret.",
                  );
                }}
              />
            </section>

            <HistoryList
              rounds={grouped.history}
              catalogue={programme.catalogue}
              now={now}
            />
          </>
        ) : null}
      </div>
    </main>
  );
}
