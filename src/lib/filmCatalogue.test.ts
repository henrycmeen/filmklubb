import assert from "node:assert/strict";
import { test } from "node:test";
import legacyCatalogue from "@/data/filmVoteCatalogue.json";
import {
  combinedFilmCatalogue,
  halloweenFilmCatalogue,
  legacyFilmCatalogue,
} from "@/lib/filmCatalogue";

void test("keeps the September catalogue as the unchanged 107-film prefix", () => {
  assert.equal(legacyCatalogue.length, 107);
  assert.deepEqual(legacyFilmCatalogue, legacyCatalogue);
  assert.deepEqual(
    combinedFilmCatalogue.slice(0, legacyCatalogue.length),
    legacyCatalogue,
  );
});

void test("merges the 26-film Halloween subset by identity without duplicates", () => {
  assert.equal(halloweenFilmCatalogue.length, 26);
  assert.equal(
    new Set(halloweenFilmCatalogue.map((film) => film.id)).size,
    halloweenFilmCatalogue.length,
  );
  assert.equal(
    new Set(combinedFilmCatalogue.map((film) => film.id)).size,
    combinedFilmCatalogue.length,
  );
  assert.equal(
    combinedFilmCatalogue.length,
    legacyFilmCatalogue.length +
      halloweenFilmCatalogue.filter(
        (film) =>
          !legacyFilmCatalogue.some((candidate) => candidate.id === film.id),
      ).length,
  );

  for (const film of halloweenFilmCatalogue) {
    const expected =
      legacyFilmCatalogue.find((candidate) => candidate.id === film.id) ?? film;
    assert.equal(
      combinedFilmCatalogue.find((candidate) => candidate.id === film.id),
      expected,
      `${film.title} should retain its canonical metadata object in the combined lookup`,
    );
  }
});
