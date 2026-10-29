import { useEffect, useState } from "react";
import { VhsCaseArtwork } from "@/components/VhsCaseArtwork";
import { combinedFilmCatalogue } from "@/lib/filmCatalogue";
import type { FilmVoteMovie } from "@/components/FilmVoteWall";
import styles from "@/styles/filmClubProgram.module.css";
export function UndatedFilmCandidates({
  candidateIds = [],
  onPreview,
}: {
  candidateIds?: number[];
  onPreview: (film: FilmVoteMovie | null) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const signature = candidateIds.join(",");
  useEffect(() => {
    setSelected(null);
    onPreview(null);
  }, [signature, onPreview]);
  const films = candidateIds.flatMap((id) => {
    const film = combinedFilmCatalogue.find((item) => item.id === id);
    return film ? [film] : [];
  });
  return (
    <section
      className={styles.planningShelf}
      aria-label="Filmer til neste filmklubb"
    >
      <div className={styles.sectionLabel}>
        <span>Filmer til neste kveld</span>
      </div>
      {films.length ? (
        <ul className={styles.voteGrid}>
          {films.map((film) => (
            <li key={film.id}>
              <button
                type="button"
                className={styles.voteFilm}
                data-case-open={false}
                data-cassette-position="inside"
                aria-label={`Se trailer for ${film.title}`}
                aria-pressed={selected === film.id}
                onClick={() => {
                  const next = selected === film.id ? null : film;
                  setSelected(next?.id ?? null);
                  onPreview(next);
                }}
              >
                <VhsCaseArtwork
                  coverImage={film.coverImage}
                  title={film.title}
                />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.planningEmpty}>Ingen filmer lagt til ennå.</p>
      )}
    </section>
  );
}
