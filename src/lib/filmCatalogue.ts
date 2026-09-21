import legacyCatalogueData from "@/data/filmVoteCatalogue.json";
import halloweenCatalogueData from "@/data/halloweenCatalogue.json";

/**
 * The September vote wall is deliberately kept as its own catalogue.  The
 * old catalogue is the compatibility boundary for the unmanaged/legacy
 * round; seasonal films are only made available to a scheduled round that
 * stores their metadata.
 */
export const legacyFilmCatalogue = legacyCatalogueData;
export const halloweenFilmCatalogue = halloweenCatalogueData;

export type FilmCatalogueEntry =
  | (typeof legacyFilmCatalogue)[number]
  | (typeof halloweenFilmCatalogue)[number];

/**
 * Merge catalogues without changing the legacy ordering or objects.  Legacy
 * IDs win on collision so adding a seasonal metadata file cannot silently
 * change September's identity, tie-break score, or artwork.
 */
const mergeById = (
  ...catalogues: ReadonlyArray<ReadonlyArray<FilmCatalogueEntry>>
): FilmCatalogueEntry[] => {
  const byId = new Map<number, FilmCatalogueEntry>();

  for (const catalogue of catalogues) {
    for (const film of catalogue) {
      if (!byId.has(film.id)) {
        byId.set(film.id, film);
      }
    }
  }

  return Array.from(byId.values());
};

export const combinedFilmCatalogue = mergeById(
  legacyFilmCatalogue,
  halloweenFilmCatalogue,
);

export const legacyFilmIds = new Set(
  legacyFilmCatalogue.map((film) => film.id),
);
export const combinedFilmIds = new Set(
  combinedFilmCatalogue.map((film) => film.id),
);
