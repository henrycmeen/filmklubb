import Head from "next/head";
import { useId, useState, type ReactNode } from "react";
import { NextFilmTv } from "@/components/NextFilmTv";
import { BloodDrips } from "@/components/BloodDrips";
import { FilmResultSpine } from "@/components/FilmResultSpine";
import { FilmRoundRanking } from "@/components/FilmRoundRanking";
import { FilmRoundStats } from "@/components/FilmRoundStats";
import { withBasePath } from "@/lib/basePath";
import type { FilmRoundSnapshot } from "@/lib/filmRoundClient";
import catalogue from "@/data/halloweenCatalogue.json";
import program from "@/styles/filmClubProgram.module.css";
import archive from "@/styles/filmArchive.module.css";
import styles from "@/styles/nextScreeningPreview.module.css";

const date = new Intl.DateTimeFormat("nb-NO", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Europe/Oslo",
});
const screeningTime = new Intl.DateTimeFormat("nb-NO", {
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Oslo",
});

type Snapshot = FilmRoundSnapshot;
function ScreeningCassette({
  snapshot,
  upcoming = false,
  initialExpanded = false,
}: {
  snapshot: Snapshot;
  upcoming?: boolean;
  initialExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const resultsId = useId();
  const film = snapshot.ranking[0]?.film;
  if (!film) return null;
  const screeningDate = date.format(new Date(snapshot.scheduledAt));
  const cassette = (
    <button
      type="button"
      className={`${archive.archiveFilm} ${styles.cassetteButton}`}
      aria-label={`${film.title}, ${upcoming ? "neste visning" : "vist"} ${screeningDate}. ${expanded ? "Skjul" : "Se"} resultatene.`}
      aria-expanded={expanded}
      aria-controls={resultsId}
      onClick={() => setExpanded(!expanded)}
    >
      <span className={archive.cassette}>
        {upcoming && snapshot.boardId === "na-halloween-2026" && <BloodDrips />}
        <FilmResultSpine film={film} eager />
        {screeningDate === "22.09.2026" ||
        (upcoming && snapshot.boardId === "na-halloween-2026") ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className={archive.tape}
            src={withBasePath(
              upcoming
                ? "/VHS/program/next-screening-tape-2026-10-29.png"
                : "/VHS/program/archive-tape-2026-09-22.png",
            )}
            alt=""
            aria-hidden="true"
            draggable={false}
          />
        ) : (
          <span className={archive.dateTape} aria-hidden="true">
            {screeningDate}
          </span>
        )}
      </span>
    </button>
  );
  return (
    <div
      className={styles.screening}
      data-expanded={expanded}
      data-upcoming={upcoming}
    >
      <div hidden={!expanded}>
        <FilmRoundStats stats={snapshot.stats} compact />
      </div>
      <div id={resultsId} className={styles.results}>
        <FilmRoundRanking
          ranking={expanded ? snapshot.ranking : snapshot.ranking.slice(0, 1)}
          intro={expanded}
          renderFilm={(entry) =>
            entry.film.id === film.id ? cassette : undefined
          }
        />
      </div>
    </div>
  );
}

export function NextScreeningClosed({
  snapshot: current,
  archive: history,
  openResults = false,
}: {
  snapshot: FilmRoundSnapshot;
  archive?: ReactNode;
  openResults?: boolean;
}) {
  const winner = current.ranking[0]?.film;
  if (!winner) return null;
  const trailer = catalogue.find((film) => film.id === winner.id);
  return (
    <>
      <Head>
        <title>Filmklubben · Neste visning</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <main className={`${program.programPage} ${styles.page}`}>
        <h1 className={styles.srOnly}>
          Filmklubben — neste visning: {winner.title}
        </h1>
        <section
          className={styles.currentScreening}
          aria-labelledby="next-screening-heading"
        >
          <h2 id="next-screening-heading" className={styles.srOnly}>
            Neste visning
          </h2>
          <div
            className={`${styles.shelf} ${program.sectionLabel} ${styles.statusRow}`}
          >
            <span>Stemmingen er avsluttet</span>
            <span>
              <time dateTime={current.scheduledAt}>
                {screeningTime.format(new Date(current.scheduledAt))}
              </time>
            </span>
          </div>
          <div
            className={styles.television}
            aria-label={`Trailer for ${winner.title}`}
          >
            <NextFilmTv
              movie={{
                ...winner,
                trailerYoutubeId: trailer?.trailerYoutubeId ?? null,
              }}
            />
          </div>
          <div className={`${styles.shelf} ${styles.upcomingShelf}`}>
            <ScreeningCassette
              snapshot={current}
              upcoming
              initialExpanded={openResults}
            />
          </div>
        </section>
        {history}
      </main>
    </>
  );
}
