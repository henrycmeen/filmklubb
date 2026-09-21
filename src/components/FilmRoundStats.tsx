import type { FilmRoundStats as RoundStats } from "@/lib/filmRoundClient";
import { formatLastFilmVote } from "@/lib/filmRoundStats";
import styles from "@/styles/filmRoundStats.module.css";

export function FilmRoundStats({ stats }: { stats: RoundStats }) {
  return (
    <dl className={styles.stats} aria-label="Avstemningsstatistikk">
      <div>
        <dt>Stemmer totalt</dt>
        <dd>{stats.totalVotes}</dd>
      </div>
      <div>
        <dt>Enheter som har stemt</dt>
        <dd>{stats.participatingDevices}</dd>
      </div>
      <div className={styles.lastVote}>
        <dt>Sist stemt</dt>
        <dd>{formatLastFilmVote(stats.lastVoteAt)}</dd>
      </div>
    </dl>
  );
}
