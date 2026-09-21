import Head from "next/head";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatFilmDate } from "@/components/filmClubProgramData";
import { resolveClubSlugParam } from "@/lib/clubSlug";
import {
  fetchFilmClubHistory,
  type FilmClubHistoryEntry,
} from "@/lib/filmRoundClient";
import { withBasePath } from "@/lib/basePath";
import styles from "@/styles/filmClubHistory.module.css";

type HistoryStatus = "loading" | "ready" | "error";

const resolveCoverImage = (coverImage: string): string => {
  if (/^(?:https?:)?\/\//.test(coverImage)) {
    return coverImage;
  }

  return withBasePath(coverImage);
};

const getWinner = (entry: FilmClubHistoryEntry) =>
  entry.snapshot.ticket?.film ??
  (entry.snapshot.stats.totalVotes > 0
    ? (entry.snapshot.ranking[0]?.film ?? null)
    : null);

const getTicketHref = (clubSlug: string, screeningId: string): string => {
  const query = new URLSearchParams({ screening: screeningId, result: "1" });
  return withBasePath(`/${clubSlug}?${query.toString()}`);
};

const HistoryCard = ({
  clubSlug,
  entry,
}: {
  clubSlug: string;
  entry: FilmClubHistoryEntry;
}) => {
  const winner = getWinner(entry);
  const ticket = entry.snapshot.ticket;
  const ticketHref = getTicketHref(clubSlug, entry.snapshot.screeningId);

  return (
    <li className={styles.historyItem}>
      {winner ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={styles.cover}
          src={resolveCoverImage(winner.coverImage)}
          alt={`Omslag for ${winner.title}`}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div className={styles.coverFallback} aria-hidden="true" />
      )}
      <div className={styles.historyCopy}>
        <p className={styles.eyebrow}>GJENNOMFØRT VISNING</p>
        <h2>{winner?.title ?? "Ingen vinner registrert"}</h2>
        <dl className={styles.metadata}>
          <div>
            <dt>Dato</dt>
            <dd>{formatFilmDate(entry.snapshot.scheduledAt)}</dd>
          </div>
          <div>
            <dt>Kino</dt>
            <dd>{ticket?.venue ?? "Kino kommer"}</dd>
          </div>
        </dl>
        <a className={styles.ticketLink} href={ticketHref}>
          Vinner og billett
        </a>
      </div>
    </li>
  );
};

const LoadingState = () => (
  <main
    className={styles.historyPage}
    aria-busy="true"
    aria-label="Laster historikk"
  >
    <div className={styles.historyShell}>
      <div className={styles.loadingLine} />
      <div className={styles.loadingList}>
        <div className={styles.loadingItem} />
        <div className={styles.loadingItem} />
      </div>
    </div>
  </main>
);

const ErrorState = ({ onRetry }: { onRetry: () => void }) => (
  <main className={styles.historyPage}>
    <div className={styles.historyShell}>
      <section className={styles.errorState} role="alert">
        <p className={styles.eyebrow}>Historikk</p>
        <h1>Historikken kunne ikke lastes</h1>
        <p>Prøv igjen om et øyeblikk.</p>
        <button type="button" onClick={onRetry}>
          Prøv igjen
        </button>
      </section>
    </div>
  </main>
);

const EmptyState = () => (
  <section className={styles.emptyState} role="status">
    <p className={styles.eyebrow}>Historikk</p>
    <h1>Ingen tidligere visninger ennå</h1>
    <p>Vinnerhistorikken fylles ut etter hver gjennomførte visning.</p>
  </section>
);

export const FilmClubHistory = ({ clubSlug }: { clubSlug: string }) => {
  const normalizedClubSlug = useMemo(
    () => resolveClubSlugParam(clubSlug),
    [clubSlug],
  );
  const [history, setHistory] = useState<FilmClubHistoryEntry[]>([]);
  const [status, setStatus] = useState<HistoryStatus>("loading");
  const [retryToken, setRetryToken] = useState(0);

  const retry = useCallback(() => {
    setRetryToken((token) => token + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    setStatus("loading");
    void fetchFilmClubHistory(normalizedClubSlug, controller.signal)
      .then((nextHistory) => {
        if (cancelled) {
          return;
        }
        setHistory(nextHistory);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (
          cancelled ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        setStatus("error");
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [normalizedClubSlug, retryToken]);

  if (status === "loading") {
    return <LoadingState />;
  }

  if (status === "error") {
    return <ErrorState onRetry={retry} />;
  }

  const homeHref = withBasePath(`/${normalizedClubSlug}`);

  return (
    <>
      <Head>
        <title>Historikk · Filmklubben</title>
        <meta
          name="description"
          content="Tidligere visninger, vinnere og billetter i Filmklubben."
        />
      </Head>
      <main className={styles.historyPage}>
        <div className={styles.historyShell}>
          <header className={styles.historyHeader}>
            <a className={styles.backLink} href={homeHref}>
              Tilbake til avstemningen
            </a>
            <h1>Tidligere visninger</h1>
          </header>
          {history.length > 0 ? (
            <ol className={styles.historyList} aria-label="Tidligere visninger">
              {history.map((entry) => (
                <HistoryCard
                  key={entry.snapshot.snapshotId}
                  clubSlug={normalizedClubSlug}
                  entry={entry}
                />
              ))}
            </ol>
          ) : (
            <EmptyState />
          )}
        </div>
      </main>
    </>
  );
};
