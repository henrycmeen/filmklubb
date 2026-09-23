import type { FilmRoundStats as RoundStats } from "@/lib/filmRoundClient";
import { formatLastFilmVote } from "@/lib/filmRoundStats";
import styles from "@/styles/filmRoundStats.module.css";

export function FilmRoundStats({
  stats,
  compact = false,
}: {
  stats: RoundStats;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <p className={styles.compact} aria-label="Avstemningsstatistikk">
        <span>
          Totalt {stats.totalVotes}{" "}
          {stats.totalVotes === 1 ? "stemme" : "stemmer"}
        </span>
        <span aria-hidden="true">·</span>
        <span>
          {stats.participatingDevices}{" "}
          {stats.participatingDevices === 1 ? "stemmegiver" : "stemmegivere"}
        </span>
      </p>
    );
  }
  return (
    <dl className={styles.stats} aria-label="Avstemningsstatistikk">
      <div>
        <dt>Stemmer totalt</dt>
        <dd>{stats.totalVotes}</dd>
      </div>
      <div>
        <dt>Stemmegivere</dt>
        <dd>{stats.participatingDevices}</dd>
      </div>
      <div className={styles.lastVote}>
        <dt>Sist stemt</dt>
        <dd>{formatLastFilmVote(stats.lastVoteAt)}</dd>
      </div>
    </dl>
  );
}
