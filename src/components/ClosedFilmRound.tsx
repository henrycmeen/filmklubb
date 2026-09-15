import { FilmResultSpine } from "@/components/FilmResultSpine";
import Head from "next/head";
import { useEffect, useMemo, useRef, useState } from "react";
import { FilmTicket } from "@/components/FilmTicket";
import { TicketFinale } from "@/components/TicketFinale";
import type { DemoFinalist } from "@/lib/filmTicket";
import type { FilmRoundSnapshot } from "@/lib/filmRoundClient";
import styles from "@/styles/closedFilmRound.module.css";

interface ClosedFilmRoundProps {
  snapshot: FilmRoundSnapshot;
}

const formatLockedAt = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Tidspunkt ikke tilgjengelig";
  }

  return new Intl.DateTimeFormat("nb-NO", {
    timeZone: "Europe/Oslo",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

export const ClosedFilmRound = ({ snapshot }: ClosedFilmRoundProps) => {
  const [revealed, setRevealed] = useState(false);
  const [finaleOpen, setFinaleOpen] = useState(false);
  const resultsHeading = useRef<HTMLHeadingElement>(null);
  const ranking = snapshot.ranking;
  const winnerEntry = ranking[0];
  const winnerTicket = snapshot.ticket;
  const hasWinner = winnerEntry !== undefined && winnerTicket !== null;
  const finalists = useMemo<DemoFinalist[]>(
    () => ranking.map(({ film, votes }) => ({ film, votes })),
    [ranking],
  );

  useEffect(() => {
    if (!revealed || finaleOpen) return;
    const frame = window.requestAnimationFrame(() => {
      resultsHeading.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [revealed, finaleOpen]);

  const revealResults = () => {
    setRevealed(true);
    setFinaleOpen(hasWinner);
  };

  const closeFinale = () => {
    setFinaleOpen(false);
  };

  return (
    <div className={styles.page}>
      <Head>
        <title>Filmklubben · Resultater</title>
        <meta
          name="description"
          content="Resultatet fra Filmklubbens avsluttede avstemning."
        />
      </Head>

      {!revealed ? (
        <main className={styles.intro} aria-labelledby="closed-round-title">
          <div className={styles.closedScreen}>
            <p className={styles.closedStatus}>
              <span aria-hidden="true" /> FILMKLUBBEN
            </p>
            <div className={styles.closedMessage}>
              <p className={styles.kicker}>STEMMENE ER I BOKS</p>
              <h1 id="closed-round-title">
                Stemmingen
                <br />
                er avsluttet.
              </h1>
              <p className={styles.introMeta}>
                Takk for at du var med og valgte.
              </p>
              <button
                type="button"
                className={styles.revealButton}
                onClick={revealResults}
              >
                Se resultatene <span aria-hidden="true">↗</span>
              </button>
            </div>
            <p className={styles.closedFooter}>NESTE STOPP: FILMKVELD</p>
          </div>
        </main>
      ) : null}

      {revealed ? (
        <main className={styles.settled}>
          <header className={styles.header}>
            <p className={styles.kicker}>FILMKLUBBEN / RESULTAT</p>
            <h1 ref={resultsHeading} tabIndex={-1}>
              Avstemningen er avsluttet
            </h1>
            <p className={styles.headerMeta}>
              {formatLockedAt(snapshot.lockedAt)}
            </p>
          </header>

          {hasWinner && winnerEntry && winnerTicket ? (
            <section
              className={styles.winner}
              aria-label={`Vinner: ${winnerEntry.film.title}`}
            >
              <p className={styles.kicker}>VINNEREN ER</p>
              <h2>{winnerEntry.film.title}</h2>
              <p className={styles.winnerMeta}>
                {winnerEntry.votes}{" "}
                {winnerEntry.votes === 1 ? "stemme" : "stemmer"} ·{" "}
                {winnerEntry.film.year}
              </p>
              {!finaleOpen ? (
                <div className={styles.winnerTicket}>
                  <FilmTicket ticket={winnerTicket} />
                </div>
              ) : null}
            </section>
          ) : (
            <section className={styles.noWinner} aria-label="Ingen vinner">
              <p className={styles.kicker}>INGEN VINNER</p>
              <h2>Ingen film ble kåret.</h2>
              <p>Resultatene fra runden er bevart nedenfor.</p>
            </section>
          )}

          <section className={styles.results} aria-label="Hele avstemningen">
            <header className={styles.resultsHeader}>
              <h2>Hele avstemningen</h2>
              <span>
                {snapshot.stats.totalVotes}{" "}
                {snapshot.stats.totalVotes === 1 ? "stemme" : "stemmer"}
              </span>
            </header>
            <ol>
              {ranking.map(({ film, votes }, index) => (
                <li key={film.id} data-winner={hasWinner && index === 0}>
                  <span className={styles.place}>
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className={styles.filmTitle}>
                    <FilmResultSpine film={film} />
                  </span>
                  <span className={styles.votes}>
                    <strong>{votes}</strong>
                    {votes === 1 ? "stemme" : "stemmer"}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </main>
      ) : null}

      {finaleOpen && winnerEntry && winnerTicket ? (
        <TicketFinale
          finalists={finalists}
          demo={false}
          frozenTicket={winnerTicket}
          onClose={closeFinale}
        />
      ) : null}
    </div>
  );
};
