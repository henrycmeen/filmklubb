import { FilmResultSpine } from "@/components/FilmResultSpine";
import { FilmTmdbScore } from "@/components/FilmTmdbScore";
import { FilmRoundStats } from "@/components/FilmRoundStats";
import type { FilmRoundStats as RoundStats } from "@/lib/filmRoundClient";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { FilmTicket, type TicketData } from "@/components/FilmTicket";
import { TicketPrinter } from "@/components/TicketPrinter";
import { makeFilmTicket, type DemoFinalist } from "@/lib/filmTicket";
import { GeistSans } from "geist/font/sans";
import styles from "@/styles/ticketFinale.module.css";

export function TicketFinale({
  finalists,
  onClose,
  demo = true,
  frozenTicket,
  stats,
}: {
  finalists: DemoFinalist[];
  onClose: () => void;
  demo?: boolean;
  frozenTicket?: TicketData;
  stats?: RoundStats;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [currentIndex, setCurrentIndex] = useState(finalists.length - 1);
  const [printing, setPrinting] = useState(false);
  const [finished, setFinished] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const winner = finalists[0]!;
  const winnerRevealed = currentIndex === 0;
  const [ticket] = useState(
    () => frozenTicket ?? makeFilmTicket(winner.film, "001"),
  );

  useEffect(() => {
    const node = dialog.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    node.showModal();
    document.body.style.overflow = "hidden";
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (reduced) {
      setReducedMotion(true);
      setCurrentIndex(0);
      setPrinting(true);
    } else {
      const stepDuration = Math.min(
        550,
        5500 / Math.max(1, finalists.length - 1),
      );
      for (let step = 1; step < finalists.length; step++) {
        timers.push(
          setTimeout(() => {
            setCurrentIndex(finalists.length - 1 - step);
          }, step * stepDuration),
        );
      }
      // Let the winner land before feeding the paper out of the slot.
      timers.push(
        setTimeout(
          () => setPrinting(true),
          (finalists.length - 1) * stepDuration + 700,
        ),
      );
    }
    return () => {
      timers.forEach(clearTimeout);
      node.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus({ preventScroll: true });
    };
  }, [finalists.length]);

  return createPortal(
    <dialog
      ref={dialog}
      className={`${styles.dialog} ${GeistSans.className}`}
      aria-label="Kveldens film"
      onCancel={onClose}
    >
      <div className={styles.topbar}>
        <span>
          {demo ? "FILMKLUBBEN / DEMORUNDE" : "AVSTEMNINGEN ER AVSLUTTET"}
        </span>
        <button type="button" onClick={onClose} aria-label="Lukk annonseringen">
          Lukk ×
        </button>
      </div>
      <div className={styles.content}>
        <section
          className={styles.winner}
          aria-label={
            winnerRevealed
              ? `Vinner: ${winner.film.title}`
              : "Resultatannonsering"
          }
        >
          <div className={styles.revealStage} data-winner={winnerRevealed}>
            <div className={styles.countdown} aria-hidden={winnerRevealed}>
              <p className={styles.kicker}>STEMMENE TELLES</p>
              <ol
                className={styles.fallingList}
                aria-label="Foreløpige resultater"
              >
                {finalists
                  .slice(Math.max(1, currentIndex))
                  .map((entry, offset) => {
                    const place = Math.max(1, currentIndex) + offset + 1;
                    return (
                      <li
                        key={entry.film.id}
                        className={styles.fallingRow}
                        style={{ "--row": offset } as CSSProperties}
                        data-current={offset === 0}
                      >
                        <div className={styles.fallingRowContent}>
                          <span className={styles.place}>
                            {String(place).padStart(2, "0")}
                          </span>
                          <span className={styles.filmTitle}>
                            <FilmResultSpine film={entry.film} compact />
                          </span>
                          <span className={styles.votes}>
                            <strong>{entry.votes}</strong>
                            {entry.votes === 1 ? "stemme" : "stemmer"}
                            <FilmTmdbScore score={entry.tmdbVoteAverage} />
                          </span>
                        </div>
                      </li>
                    );
                  })}
              </ol>
            </div>
            <div className={styles.winnerHeading} aria-hidden={!winnerRevealed}>
              <p className={styles.kicker}>VINNEREN ER</p>
              <h1>{winner.film.title}</h1>
              <p>
                {winner.votes} {winner.votes === 1 ? "stemme" : "stemmer"} ·{" "}
                {winner.film.year}
                <FilmTmdbScore score={winner.tmdbVoteAverage} />
              </p>
            </div>
          </div>
          <div className={styles.printerReveal} data-visible={winnerRevealed}>
            <TicketPrinter
              ticket={ticket}
              waiting={!printing}
              skipAnimation={reducedMotion}
              onComplete={() => setFinished(true)}
            />
          </div>
          <div className={styles.actions} data-ready={finished}>
            <button className={styles.again} type="button" onClick={onClose}>
              {demo ? "Tilbake til filmene" : "Se resultatene"}
            </button>
          </div>
        </section>
        {finished && (
          <section
            className={styles.allResults}
            aria-label="Resultater for alle filmene"
          >
            {stats && <FilmRoundStats stats={stats} />}
            <header className={styles.resultsHeader}>
              <h2>Hele avstemningen</h2>
            </header>
            <ol className={styles.ranking}>
              {finalists.map((entry, index) => (
                <li
                  key={entry.film.id}
                  data-visible="true"
                  data-winner={index === 0}
                >
                  <span className={styles.place}>
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className={styles.filmTitle}>
                    <FilmResultSpine film={entry.film} />
                  </span>
                  <span className={styles.votes}>
                    <strong>{entry.votes}</strong>{" "}
                    {entry.votes === 1 ? "stemme" : "stemmer"}
                    <FilmTmdbScore score={entry.tmdbVoteAverage} />
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
      <div className={styles.printOnly} aria-hidden="true">
        <FilmTicket ticket={ticket} />
      </div>
    </dialog>,
    document.body,
  );
}
