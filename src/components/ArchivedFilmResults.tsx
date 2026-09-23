import { useEffect, useRef } from "react";
import { GeistSans } from "geist/font/sans";
import { FilmRoundStats } from "@/components/FilmRoundStats";
import { FilmRoundRanking } from "@/components/FilmRoundRanking";
import type { DemoFinalist } from "@/lib/filmTicket";
import type { FilmRoundStats as RoundStats } from "@/lib/filmRoundClient";
import styles from "@/styles/ticketFinale.module.css";
import archive from "@/styles/filmArchive.module.css";
import { archiveWinner } from "@/lib/filmArchive";

export function ArchivedFilmResults({
  ranking,
  stats,
  scrollToResults = true,
}: {
  ranking: DemoFinalist[];
  stats?: RoundStats;
  scrollToResults?: boolean;
}) {
  const results = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!scrollToResults) return;
    results.current?.focus({ preventScroll: true });
    results.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [scrollToResults]);

  return (
    <section
      ref={results}
      tabIndex={-1}
      data-inline={!scrollToResults}
      className={`${styles.content} ${archive.results} ${GeistSans.className}`}
      aria-label={`Resultater fra tidligere visning: ${archiveWinner(ranking)?.title ?? "Ingen vinner"}`}
    >
      {stats && <FilmRoundStats stats={stats} />}
      <FilmRoundRanking ranking={ranking} intro />
    </section>
  );
}
