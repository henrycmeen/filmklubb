import { FilmResultSpine } from "@/components/FilmResultSpine";
import { FilmTmdbScore } from "@/components/FilmTmdbScore";
import type { DemoFinalist } from "@/lib/filmTicket";
import styles from "@/styles/ticketFinale.module.css";
import archive from "@/styles/filmArchive.module.css";
import type { CSSProperties, ReactNode } from "react";

export function FilmRoundRanking({
  ranking,
  intro = false,
  renderFilm,
}: {
  ranking: DemoFinalist[];
  intro?: boolean;
  renderFilm?: (entry: DemoFinalist) => ReactNode;
}) {
  return (
    <ol
      className={`${styles.ranking} ${intro ? archive.rankingIntro : ""}`}
      aria-label="Resultater for alle filmene"
    >
      {ranking.map((entry, index) => (
        <li
          key={entry.film.id}
          data-visible="true"
          data-winner={index === 0 && entry.votes > 0}
          style={
            intro && index < 10
              ? ({ "--row-delay": `${index * 140}ms` } as CSSProperties)
              : undefined
          }
        >
          <span className={styles.place}>
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className={styles.filmTitle}>
            {renderFilm?.(entry) ?? (
              <FilmResultSpine film={entry.film} eager={intro && index < 10} />
            )}
          </span>
          <span className={styles.votes}>
            <strong>{entry.votes}</strong>{" "}
            {entry.votes === 1 ? "stemme" : "stemmer"}
            <FilmTmdbScore score={entry.tmdbVoteAverage} />
          </span>
        </li>
      ))}
    </ol>
  );
}
