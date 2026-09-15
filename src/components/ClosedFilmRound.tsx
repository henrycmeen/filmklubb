import Head from "next/head";
import { useMemo, useRef, useState } from "react";
import { NextFilmTv } from "@/components/NextFilmTv";
import { TicketFinale } from "@/components/TicketFinale";
import { VhsCaseArtwork } from "@/components/VhsCaseArtwork";
import { formatFilmDate } from "@/components/filmClubProgramData";
import catalogue from "@/data/filmVoteCatalogue.json";
import type { DemoFinalist } from "@/lib/filmTicket";
import type { FilmRoundSnapshot } from "@/lib/filmRoundClient";
import program from "@/styles/filmClubProgram.module.css";
import demo from "@/styles/filmClubDemo.module.css";
import styles from "@/styles/closedFilmRound.module.css";

export const ClosedFilmRound = ({
  snapshot,
}: {
  snapshot: FilmRoundSnapshot;
}) => {
  const [finaleOpen, setFinaleOpen] = useState(false);
  const [attention, setAttention] = useState(0);
  const [emptyResult, setEmptyResult] = useState(false);
  const revealButton = useRef<HTMLButtonElement>(null);
  const winner = snapshot.ticket ? snapshot.ranking[0] : undefined;
  const movie = winner
    ? (catalogue.find((film) => film.id === winner.film.id) ?? winner.film)
    : null;
  const finalists = useMemo<DemoFinalist[]>(
    () => snapshot.ranking.map(({ film, votes }) => ({ film, votes })),
    [snapshot.ranking],
  );

  // Closed films never mount the voting client or send a vote request.
  const nudgeResultButton = () => {
    setAttention((value) => value + 1);
    const button = revealButton.current;
    if (!button) return;
    const { top, bottom } = button.getBoundingClientRect();
    if (top < 0 || bottom > window.innerHeight) {
      button.scrollIntoView({
        block: "center",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
    }
  };

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
              <NextFilmTv movie={movie} />
            </div>
          </div>
        </section>
        <div className={styles.resultControl}>
          <button
            ref={revealButton}
            type="button"
            className={`${demo.announce} ${styles.announce}`}
            aria-label="Se resultatene"
            onClick={() => {
              if (winner && snapshot.ticket) setFinaleOpen(true);
              else setEmptyResult(true);
            }}
          >
            <span
              key={attention}
              className={`${demo.powerSwitch} ${styles.powerSwitch}`}
              data-attention={attention > 0}
              aria-hidden="true"
            >
              <svg viewBox="0 0 32 32" fill="none">
                <path d="M16 4v12M9.3 8.3a11 11 0 1 0 13.4 0" />
              </svg>
            </span>
            <span>Se resultatene</span>
          </button>
          <span
            className={styles.srOnly}
            role="status"
            key={`hint-${attention}`}
          >
            {attention > 0
              ? "Stemmingen er avsluttet. Trykk Se resultatene på strømknappen."
              : ""}
          </span>
          {emptyResult ? (
            <p role="status">Ingen stemmer ble avgitt i denne runden.</p>
          ) : null}
        </div>
        <section
          className={program.voteWallSection}
          aria-label="Filmer i avsluttet avstemning"
        >
          <ol className={program.voteGrid}>
            {snapshot.ranking.map(({ film }, index) => (
              <li key={film.id}>
                <button
                  type="button"
                  className={program.voteFilm}
                  aria-label={`${film.title}. Stemmingen er avsluttet.`}
                  aria-disabled="true"
                  data-case-open="false"
                  data-suppress-preview="true"
                  onClick={nudgeResultButton}
                >
                  <VhsCaseArtwork
                    coverImage={film.coverImage}
                    title={film.title}
                    eager={index < 30}
                  />
                </button>
              </li>
            ))}
          </ol>
        </section>
      </main>
      {finaleOpen && winner && snapshot.ticket ? (
        <TicketFinale
          finalists={finalists}
          demo={false}
          frozenTicket={snapshot.ticket}
          onClose={() => setFinaleOpen(false)}
        />
      ) : null}
    </>
  );
};
