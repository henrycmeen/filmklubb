import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FILM_CLUB_TIME_ZONE,
  formatFilmDate,
} from "@/components/filmClubProgramData";
import {
  fetchFilmClubResults,
  type FilmClubResults as FilmClubResultsData,
  type FilmClubResultsHistoryEntry,
  type FilmClubResultsRankingEntry,
} from "@/lib/filmClubResultsClient";
import { resolveClubSlugParam } from "@/lib/clubSlug";
import { withBasePath } from "@/lib/basePath";
import styles from "@/styles/filmClubResults.module.css";
import { FilmTmdbScore } from "@/components/FilmTmdbScore";

interface FilmClubResultsProps {
  clubSlug: string;
}

type ResultsStatus = "loading" | "ready" | "error";

const POLL_INTERVAL_MS = 1_500;

const formatCount = (count: number, singular: string, plural: string): string =>
  `${count} ${count === 1 ? singular : plural}`;

const formatDateTime = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Tidspunkt kommer";
  }

  return new Intl.DateTimeFormat("nb-NO", {
    timeZone: FILM_CLUB_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const resolveCoverImage = (coverImage: string): string => {
  if (/^(?:https?:)?\/\//.test(coverImage)) {
    return coverImage;
  }

  return withBasePath(coverImage);
};

const ResultCover = ({
  coverImage,
  title,
}: {
  coverImage: string;
  title: string;
}) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img
    className={styles.coverImage}
    src={resolveCoverImage(coverImage)}
    alt={`Omslag for ${title}`}
    loading="lazy"
    decoding="async"
  />
);

const ResultStats = ({ results }: { results: FilmClubResultsData }) => (
  <dl className={styles.statsGrid} aria-label="Avstemningsstatistikk">
    <div className={styles.statItem}>
      <dt>Stemmer totalt</dt>
      <dd>{results.stats.totalVotes}</dd>
    </div>
    <div className={styles.statItem}>
      <dt>Enheter som har stemt</dt>
      <dd>{results.stats.participatingDevices}</dd>
    </div>
    <div className={styles.statItem}>
      <dt>Sist stemt</dt>
      <dd className={styles.statDate}>
        {results.stats.lastVoteAt
          ? formatDateTime(results.stats.lastVoteAt)
          : "Ingen stemmer ennå"}
      </dd>
    </div>
  </dl>
);

const RankingRow = ({
  entry,
  maximumVotes,
}: {
  entry: FilmClubResultsRankingEntry;
  maximumVotes: number;
}) => (
  <li className={styles.rankingRow}>
    <span className={styles.rank} aria-label={`Plass ${entry.rank}`}>
      {String(entry.rank).padStart(2, "0")}
    </span>
    <div className={styles.rankingFilm}>
      <ResultCover coverImage={entry.coverImage} title={entry.title} />
      <div className={styles.rankingFilmCopy}>
        <h3>{entry.title}</h3>
        <progress
          className={styles.voteProgress}
          max={Math.max(maximumVotes, 1)}
          value={entry.votes}
          aria-label={`${entry.title}: ${formatCount(entry.votes, "stemme", "stemmer")}`}
        />
      </div>
    </div>
    <div className={styles.rankingMeta}>
      <span className={styles.rankingVotes}>
        {formatCount(entry.votes, "stemme", "stemmer")}
      </span>
      <FilmTmdbScore score={entry.tmdbVoteAverage} />
    </div>
  </li>
);

const RankingSection = ({
  ranking,
}: {
  ranking: FilmClubResultsData["ranking"];
}) => {
  const maximumVotes = useMemo(
    () => ranking.reduce((maximum, entry) => Math.max(maximum, entry.votes), 0),
    [ranking],
  );

  return (
    <section className={styles.rankingSection} aria-label="Rangering">
      {ranking.length > 0 ? (
        <ol
          className={styles.rankingList}
          aria-label="Full rangering av filmer"
        >
          {ranking.map((entry) => (
            <RankingRow
              key={entry.filmId}
              entry={entry}
              maximumVotes={maximumVotes}
            />
          ))}
        </ol>
      ) : (
        <div className={styles.emptyState} role="status">
          <h3>Ingen filmer i avstemningen ennå</h3>
          <p>Rangeringen blir synlig når programmet er klart.</p>
        </div>
      )}
    </section>
  );
};

const HistoryEntry = ({ entry }: { entry: FilmClubResultsHistoryEntry }) => (
  <li className={styles.historyItem}>
    <ResultCover
      coverImage={entry.winner.coverImage}
      title={entry.winner.title}
    />
    <div className={styles.historyCopy}>
      <p className={styles.historyDate}>{formatFilmDate(entry.scheduledAt)}</p>
      <h3>{entry.winner.title}</h3>
      <p>
        {formatCount(entry.winner.votes, "stemme", "stemmer")} ·{" "}
        {formatCount(entry.participatingDevices, "enhet", "enheter")}
      </p>
    </div>
  </li>
);

const HistorySection = ({
  history,
}: {
  history: FilmClubResultsData["history"];
}) => (
  <section className={styles.historySection} aria-labelledby="history-heading">
    <div className={styles.sectionHeading}>
      <h2 id="history-heading">Tidligere vinnere</h2>
      <span className={styles.sectionCount}>{history.length}</span>
    </div>
    {history.length > 0 ? (
      <ol className={styles.historyList} aria-label="Tidligere vinnere">
        {history.map((entry) => (
          <HistoryEntry key={entry.screeningId} entry={entry} />
        ))}
      </ol>
    ) : (
      <div className={styles.emptyState} role="status">
        <h3>Ingen tidligere vinnere ennå</h3>
        <p>Vinnerhistorikken fylles ut etter hver gjennomførte visning.</p>
      </div>
    )}
  </section>
);

const LoadingState = () => (
  <main
    className={styles.resultsPage}
    aria-busy="true"
    aria-label="Laster resultater"
  >
    <div className={styles.resultsShell}>
      <div className={styles.loadingStats} />
      <div className={styles.loadingColumns}>
        <div className={styles.loadingPanel} />
        <div className={styles.loadingPanel} />
      </div>
    </div>
  </main>
);

const ErrorState = ({ onRetry }: { onRetry: () => void }) => (
  <main className={styles.resultsPage}>
    <div className={styles.resultsShell}>
      <section className={styles.errorState} role="alert">
        <p className={styles.eyebrow}>Resultater</p>
        <h1>Resultatene kunne ikke lastes</h1>
        <p>Prøv igjen om et øyeblikk.</p>
        <button className={styles.retryButton} type="button" onClick={onRetry}>
          Prøv igjen
        </button>
      </section>
    </div>
  </main>
);

export const FilmClubResults = ({ clubSlug }: FilmClubResultsProps) => {
  const normalizedClubSlug = resolveClubSlugParam(clubSlug);
  const [results, setResults] = useState<FilmClubResultsData | null>(null);
  const [status, setStatus] = useState<ResultsStatus>("loading");
  const [updateError, setUpdateError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  const retry = useCallback(() => {
    setRetryToken((current) => current + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: number | undefined;
    let pollInFlight = false;
    const controller = new AbortController();

    const refresh = async () => {
      if (cancelled || pollInFlight) {
        return;
      }

      pollInFlight = true;
      try {
        const nextResults = await fetchFilmClubResults(
          normalizedClubSlug,
          controller.signal,
        );
        if (!cancelled) {
          setResults(nextResults);
          setStatus("ready");
          setUpdateError(false);
        }
      } catch (error) {
        if (
          !cancelled &&
          !(error instanceof DOMException && error.name === "AbortError")
        ) {
          setUpdateError(true);
          setStatus((current) => (current === "ready" ? current : "error"));
        }
      } finally {
        pollInFlight = false;
      }
    };

    const poll = async () => {
      await refresh();
      if (!cancelled) {
        pollTimer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS);
      }
    };

    const refreshWhenActive = () => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };

    window.addEventListener("focus", refreshWhenActive);
    document.addEventListener("visibilitychange", refreshWhenActive);
    void poll();

    return () => {
      cancelled = true;
      controller.abort();
      window.removeEventListener("focus", refreshWhenActive);
      document.removeEventListener("visibilitychange", refreshWhenActive);
      if (pollTimer !== undefined) {
        window.clearTimeout(pollTimer);
      }
    };
  }, [normalizedClubSlug, retryToken]);

  if (status === "loading") {
    return <LoadingState />;
  }

  if (status === "error" || !results) {
    return <ErrorState onRetry={retry} />;
  }

  return (
    <main className={styles.resultsPage}>
      <div className={styles.resultsShell}>
        <h1 className={styles.srOnly}>Resultater</h1>
        {updateError ? (
          <p className={styles.srOnly} role="status">
            Oppdateringen feilet – viser sist bekreftede resultat.
          </p>
        ) : null}
        <a
          className={styles.backLink}
          href={withBasePath(`/${normalizedClubSlug}`)}
        >
          Tilbake til avstemningen
        </a>
        <ResultStats results={results} />

        <div className={styles.resultsColumns}>
          <RankingSection ranking={results.ranking} />
          <HistorySection history={results.history} />
        </div>
      </div>
    </main>
  );
};
