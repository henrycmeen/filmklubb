import { useEffect, useId, useState } from "react";
import { FilmResultSpine } from "@/components/FilmResultSpine";
import { FilmRoundRanking } from "@/components/FilmRoundRanking";
import { FilmRoundStats } from "@/components/FilmRoundStats";
import {
  fetchFilmClubHistory,
  isFilmRoundAbortError,
  type FilmClubHistoryEntry,
} from "@/lib/filmRoundClient";
import { withBasePath } from "@/lib/basePath";
import { archiveWinner, otherScreenings } from "@/lib/filmArchive";
import program from "@/styles/filmClubProgram.module.css";
import styles from "@/styles/filmArchive.module.css";

const dateFormatter = new Intl.DateTimeFormat("nb-NO", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Europe/Oslo",
});

export function FilmArchiveShelf({
  clubSlug,
  excludeSnapshotId,
}: {
  clubSlug: string;
  excludeSnapshotId?: string;
}) {
  const [history, setHistory] = useState<FilmClubHistoryEntry[]>([]);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<FilmClubHistoryEntry | null>(null);
  const [pressing, setPressing] = useState<FilmClubHistoryEntry | null>(null);
  const [returning, setReturning] = useState<string | null>(null);
  const resultsId = useId();

  useEffect(() => {
    const controller = new AbortController();
    setHistory([]);
    setFailed(false);
    setSelected(null);
    setPressing(null);
    setReturning(null);
    void fetchFilmClubHistory(clubSlug, controller.signal)
      .then((entries) => {
        if (!controller.signal.aborted)
          setHistory(otherScreenings(entries, excludeSnapshotId));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && !isFilmRoundAbortError(error))
          setFailed(true);
      });
    return () => controller.abort();
  }, [clubSlug, retry, excludeSnapshotId]);

  useEffect(() => {
    if (!pressing) return;
    const timer = window.setTimeout(() => {
      setSelected((current) =>
        current?.snapshot.snapshotId === pressing.snapshot.snapshotId
          ? null
          : pressing,
      );
      setPressing(null);
      setReturning(pressing.snapshot.snapshotId);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [pressing]);

  useEffect(() => {
    if (!returning) return;
    const timer = window.setTimeout(() => setReturning(null), 650);
    return () => window.clearTimeout(timer);
  }, [returning]);

  if (failed)
    return (
      <section className={styles.archive}>
        <button type="button" onClick={() => setRetry((value) => value + 1)}>
          Last tidligere visninger på nytt
        </button>
      </section>
    );
  if (!history.length) return null;

  return (
    <>
      <section
        className={styles.archive}
        id="tidligere"
        aria-label="Tidligere visninger"
        data-expanded={Boolean(selected)}
      >
        <div className={`${program.sectionLabel} ${styles.archiveLabel}`}>
          <span>Tidligere visninger</span>
          <div
            key={selected?.snapshot.snapshotId ?? "closed"}
            className={styles.headerStats}
            data-visible={Boolean(selected)}
            aria-hidden={!selected}
          >
            <FilmRoundStats
              stats={(selected ?? history[0]!).snapshot.stats}
              compact
            />
          </div>
        </div>
        <ul className={styles.shelf}>
          {history.map((entry) => {
            const snapshot = entry.snapshot;
            // Keep the same keyed first row mounted: the dated cassette itself
            // becomes first place instead of adding a second winning cassette.
            const winner = archiveWinner(snapshot.ranking);
            const date = dateFormatter.format(new Date(snapshot.scheduledAt));
            const isSelected =
              selected?.snapshot.snapshotId === snapshot.snapshotId;
            return (
              <li
                key={snapshot.snapshotId}
                className={styles.archiveEntry}
                data-expanded={isSelected}
              >
                <div id={`${resultsId}-${snapshot.snapshotId}`}>
                  {!winner && (
                    <button
                      type="button"
                      aria-expanded={isSelected}
                      aria-controls={`${resultsId}-${snapshot.snapshotId}`}
                      onClick={() => setSelected(isSelected ? null : entry)}
                    >
                      Ingen stemmer · {date} — Se resultatene
                    </button>
                  )}
                  <FilmRoundRanking
                    ranking={
                      isSelected
                        ? snapshot.ranking
                        : winner
                          ? snapshot.ranking.slice(0, 1)
                          : []
                    }
                    intro={isSelected}
                    renderFilm={(result) =>
                      result.film.id === winner?.id ? (
                        <button
                          type="button"
                          className={styles.archiveFilm}
                          data-pressing={
                            pressing?.snapshot.snapshotId ===
                              snapshot.snapshotId || undefined
                          }
                          data-returning={
                            returning === snapshot.snapshotId || undefined
                          }
                          aria-busy={
                            pressing?.snapshot.snapshotId ===
                            snapshot.snapshotId
                          }
                          aria-expanded={isSelected}
                          aria-controls={`${resultsId}-${snapshot.snapshotId}`}
                          aria-label={`${winner?.title ?? "Visning uten vinner"}, vist ${date}. Se resultatene.`}
                          onClick={() => {
                            if (pressing || returning) return;
                            if (
                              window.matchMedia(
                                "(prefers-reduced-motion: reduce)",
                              ).matches
                            ) {
                              setSelected(isSelected ? null : entry);
                            } else setPressing(entry);
                          }}
                        >
                          <span className={styles.cassette}>
                            {winner ? (
                              <FilmResultSpine film={winner} />
                            ) : (
                              <span>Ingen stemmer · {date}</span>
                            )}
                            {date === "22.09.2026" ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                className={styles.tape}
                                src={withBasePath(
                                  "/VHS/program/archive-tape-2026-09-22.png",
                                )}
                                alt=""
                                aria-hidden="true"
                                draggable={false}
                              />
                            ) : (
                              <span
                                className={styles.dateTape}
                                aria-hidden="true"
                              >
                                {date}
                              </span>
                            )}
                          </span>
                        </button>
                      ) : undefined
                    }
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
