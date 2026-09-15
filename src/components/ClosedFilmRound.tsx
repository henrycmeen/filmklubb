import Head from "next/head";
import { useMemo, useState } from "react";
import { StaticFilmTv } from "@/components/NextFilmTv";
import { TicketFinale } from "@/components/TicketFinale";
import { formatFilmDate } from "@/components/filmClubProgramData";
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
  const [emptyResult, setEmptyResult] = useState(false);
  const winner = snapshot.ticket ? snapshot.ranking[0] : undefined;
  const finalists = useMemo<DemoFinalist[]>(
    () => snapshot.ranking.map(({ film, votes }) => ({ film, votes })),
    [snapshot.ranking],
  );

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
    </>
  );
};
