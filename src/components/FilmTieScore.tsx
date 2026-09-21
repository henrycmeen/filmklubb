import { tieScoreLabel } from "@/lib/filmTieScore";
import styles from "@/styles/filmTieScore.module.css";

export function FilmTieScore({
  tied,
  score,
}: {
  tied: boolean;
  score?: number;
}) {
  const label = tieScoreLabel(tied, score);
  return label ? <span className={styles.score}>{label}</span> : null;
}
