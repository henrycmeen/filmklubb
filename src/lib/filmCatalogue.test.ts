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

void test("merges the expanded Halloween catalogue by identity without duplicates", () => {
  assert.equal(halloweenFilmCatalogue.length, 28);
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

void test("includes the requested original horror films with covers and trailers", () => {
  for (const [id, year] of [[16372, 1961], [25623, 1977], [16307, 1973], [36095, 1997]]) {
    const film = halloweenFilmCatalogue.find((entry) => entry.id === id);
    assert.equal(film?.year, year);
    assert.ok(film?.coverImage);
    assert.match(film?.trailerYoutubeId ?? "", /^[A-Za-z0-9_-]{11}$/);
  }
  assert.match(halloweenFilmCatalogue.find((film) => film.id === 58405)!.coverImage, /dont-look-up-english/);
});
