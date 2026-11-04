import { useState } from "react";
import type { FilmPlanning } from "@/lib/filmSchedule";
import type { FilmAdminCatalogueEntry } from "@/components/FilmClubRoundForm";
import styles from "@/styles/filmClubAdmin.module.css";
export function FilmPlanningForm({
  planning,
  catalogue,
  disabled,
  onSave,
  onDirtyChange,
}: {
  planning: FilmPlanning;
  catalogue: FilmAdminCatalogueEntry[];
  disabled: boolean;
  onSave: (ids: number[]) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [ids, setIds] = useState(planning.candidateIds);
  const [query, setQuery] = useState("");
  const dirty = ids.join(",") !== planning.candidateIds.join(",");
  return (
    <section
      className={styles.editorSection}
      aria-labelledby="planning-heading"
    >
      <h2 id="planning-heading">Neste filmklubb</h2>
      <p>
        Dato ikke annonsert. Legg til filmer nå, og bestem dato og avstemning
        senere. Utvalget vises når ingen runde er aktiv.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void onSave(ids)
            .then(() => onDirtyChange(false))
            .catch(() => undefined);
        }}
      >
        <fieldset disabled={disabled}>
          <legend>Filmer til neste kveld · {ids.length} valgt</legend>
          <div className={styles.field}>
            <label htmlFor="planning-search">Søk i filmkatalogen</label>
            <input
              id="planning-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div
            className={styles.catalogueList}
            role="group"
            aria-label="Kandidater uten dato"
          >
            {catalogue
              .filter(
                (film) =>
                  !query ||
                  `${film.title} ${film.year}`
                    .toLowerCase()
                    .includes(query.toLowerCase()),
              )
              .map((film) => (
                <label className={styles.catalogueOption} key={film.id}>
                  <input
                    type="checkbox"
                    checked={ids.includes(film.id)}
                    onChange={() => {
                      const next = ids.includes(film.id)
                        ? ids.filter((id) => id !== film.id)
                        : [...ids, film.id];
                      setIds(next);
                      onDirtyChange(
                        next.join(",") !== planning.candidateIds.join(","),
                      );
                    }}
                  />
                  <span className={styles.catalogueTitle}>{film.title}</span>
                  <span className={styles.catalogueYear}>{film.year}</span>
                </label>
              ))}
          </div>
          <button type="submit" className={styles.button} disabled={!dirty}>
            Lagre filmutvalg
          </button>
        </fieldset>
      </form>
    </section>
  );
}
