import { tmdbScoreLabel } from "@/lib/filmTmdbScore";
import styles from "@/styles/filmTieScore.module.css";

export function FilmTmdbScore({ score }: { score?: number }) {
  const label = tmdbScoreLabel(score);
  return label ? <span className={styles.score}>{label}</span> : null;
}
