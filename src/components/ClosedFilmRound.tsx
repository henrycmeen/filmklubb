import Head from "next/head";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FilmResultSpine } from "@/components/FilmResultSpine";
import { FilmTmdbScore } from "@/components/FilmTmdbScore";
import { FilmTicket } from "@/components/FilmTicket";
import { StaticFilmTv } from "@/components/NextFilmTv";
import { TicketFinale } from "@/components/TicketFinale";
import { formatFilmDate } from "@/components/filmClubProgramData";
import { withBasePath } from "@/lib/basePath";
import type { DemoFinalist } from "@/lib/filmTicket";
import type { FilmRoundSnapshot } from "@/lib/filmRoundClient";
import program from "@/styles/filmClubProgram.module.css";
import demo from "@/styles/filmClubDemo.module.css";
import ticketDemo from "@/styles/ticketDemo.module.css";
import styles from "@/styles/closedFilmRound.module.css";

const DirectWinnerView = ({
  clubSlug,
  snapshot,
  onClose,
}: {
  clubSlug: string;
  snapshot: FilmRoundSnapshot;
  onClose: () => void;
}) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const ticket = snapshot.ticket;

  useEffect(() => {
    const node = dialog.current;
    if (!node) {
      return;
    }

    previousFocus.current = document.activeElement as HTMLElement | null;
    if (!node.open) {
      node.showModal();
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      if (node.open) {
        node.close();
      }
      document.body.style.overflow = previousOverflow;
      previousFocus.current?.focus({ preventScroll: true });
    };
  }, []);

  if (!ticket || typeof document === "undefined") {
    return null;
  }

  const historyHref = withBasePath(`/${clubSlug}/historikk`);

  return createPortal(
    <dialog
      ref={dialog}
      className={`${styles.directDialog} ${ticketDemo.page}`}
      aria-label="Vinner og billett"
      onCancel={onClose}
    >
      <div className={styles.directTopbar}>
        <span>FILMKLUBBEN / VINNER OG BILLETT</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Lukk vinner og billett"
        >
          Lukk ×
        </button>
      </div>
      <div className={styles.directContent}>
        <section
          className={styles.directTicketPanel}
          aria-labelledby="winner-heading"
        >
          <div className={styles.directKicker}>VINNEREN ER</div>
          <h1 id="winner-heading">{ticket.film.title}</h1>
          <p className={styles.directMeta}>
            {snapshot.ranking[0]?.votes ?? 0}{" "}
            {snapshot.ranking[0]?.votes === 1 ? "stemme" : "stemmer"} ·{" "}
            {ticket.film.year}
            <FilmTmdbScore score={snapshot.ranking[0]?.tmdbVoteAverage} />
          </p>
          <div
            className={`${ticketDemo.ticketMount} ${styles.directTicketMount}`}
          >
            <FilmTicket ticket={ticket} />
          </div>
          <div className={styles.directActions}>
            <button type="button" onClick={() => window.print()}>
              Skriv ut billett
            </button>
            <a href={historyHref}>Historikk</a>
          </div>
        </section>
        <section
          className={styles.directRankingSection}
          aria-labelledby="full-ranking-heading"
        >
          <div className={styles.directSectionHeading}>
            <p className={styles.directKicker}>HELE AVSTEMNINGEN</p>
            <h2 id="full-ranking-heading">Alle filmene</h2>
          </div>
          <ol
            className={styles.directRanking}
            aria-label="Full rangering av alle filmene"
          >
            {snapshot.ranking.map((entry, index) => (
              <li key={entry.film.id} data-winner={index === 0}>
                <span className={styles.directPlace}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className={styles.directFilmTitle}>
                  <FilmResultSpine film={entry.film} />
                </span>
                <span className={styles.directVotes}>
                  <strong>{entry.votes}</strong>{" "}
                  {entry.votes === 1 ? "stemme" : "stemmer"}
                  <FilmTmdbScore score={entry.tmdbVoteAverage} />
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </dialog>,
    document.body,
  );
};

export const ClosedFilmRound = ({
  snapshot,
  clubSlug = "default",
  openDirectResult = false,
}: {
  snapshot: FilmRoundSnapshot;
  clubSlug?: string;
  openDirectResult?: boolean;
}) => {
  const [finaleOpen, setFinaleOpen] = useState(false);
  const [directOpen, setDirectOpen] = useState(
    () => openDirectResult && Boolean(snapshot.ticket),
  );
  const [emptyResult, setEmptyResult] = useState(false);
  const hasTicket = Boolean(snapshot.ticket);
  const winner = snapshot.ticket ? snapshot.ranking[0] : undefined;
  const finalists = useMemo<DemoFinalist[]>(
    () =>
      snapshot.ranking.map(({ film, votes, tmdbVoteAverage }) => ({
        film,
        votes,
        tmdbVoteAverage,
      })),
    [snapshot.ranking],
  );

  useEffect(() => {
    if (openDirectResult && hasTicket) {
      setDirectOpen(true);
    }
  }, [openDirectResult, hasTicket, snapshot.snapshotId]);

  return (
    <>
      <Head>
        <title>Filmklubben · Avstemningen er avsluttet</title>
      </Head>
      <main className={program.programPage}>
        <section className={program.nextSection}>
          <div className={program.sectionLabel}>
            <span>Stemmingen er avsluttet</span>
            <span>{formatFilmDate(snapshot.scheduledAt)}</span>
          </div>
          <div className={program.nextLayout}>
            <div className={program.nextCase}>
              <StaticFilmTv />
            </div>
          </div>
        </section>
        <div className={styles.resultControl}>
          <button
            type="button"
            className={`${demo.announce} ${styles.announce}`}
            aria-label="Se resultatene"
            onClick={() => {
              if (winner && snapshot.ticket) setFinaleOpen(true);
              else setEmptyResult(true);
            }}
          >
            <span
              className={`${demo.powerSwitch} ${styles.powerSwitch}`}
              aria-hidden="true"
            >
              <svg viewBox="0 0 32 32" fill="none">
                <path d="M16 4v12M9.3 8.3a11 11 0 1 0 13.4 0" />
              </svg>
            </span>
            <span>Se resultatene</span>
          </button>
          {emptyResult ? (
            <p role="status">Ingen stemmer ble avgitt i denne runden.</p>
          ) : null}
        </div>
      </main>
      {finaleOpen && winner && snapshot.ticket ? (
        <TicketFinale
          finalists={finalists}
          demo={false}
          frozenTicket={snapshot.ticket}
          onClose={() => setFinaleOpen(false)}
        />
      ) : null}
      {directOpen && snapshot.ticket ? (
        <DirectWinnerView
          clubSlug={clubSlug}
          snapshot={snapshot}
          onClose={() => setDirectOpen(false)}
        />
      ) : null}
    </>
  );
};
