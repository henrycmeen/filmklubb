import assert from "node:assert/strict";
import { test } from "node:test";
import legacyCatalogue from "@/data/filmVoteCatalogue.json";
import {
  christmasFilmCatalogue,
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
    new Set(
      [
        ...legacyFilmCatalogue,
        ...halloweenFilmCatalogue,
        ...christmasFilmCatalogue,
      ].map((film) => film.id),
    ).size,
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
  for (const [id, year] of [
    [16372, 1961],
    [25623, 1977],
    [16307, 1973],
    [36095, 1997],
  ]) {
    const film = halloweenFilmCatalogue.find((entry) => entry.id === id);
    assert.equal(film?.year, year);
    assert.ok(film?.coverImage);
    assert.match(film?.trailerYoutubeId ?? "", /^[A-Za-z0-9_-]{11}$/);
  }
  assert.match(
    halloweenFilmCatalogue.find((film) => film.id === 58405)!.coverImage,
    /dont-look-up-english/,
  );
});

void test("Christmas shortlist contains the curated sixteen films and existing artwork stays canonical", () => {
  const ids = [
    10437, 9479, 70089, 492015, 13398, 530, 10386, 927, 68, 5961,
    17962, 144, 340357, 41213, 72214, 48395,
  ];
  assert.deepEqual(
    christmasFilmCatalogue.map((film) => film.id),
    ids,
  );
  assert.equal(
    christmasFilmCatalogue.find((film) => film.id === 530)!.year,
    1989,
  );
  for (const film of christmasFilmCatalogue) {
    assert.ok(film.coverImage);
    const expected =
      legacyFilmCatalogue.find((item) => item.id === film.id) ??
      halloweenFilmCatalogue.find((item) => item.id === film.id) ??
      film;
    assert.equal(
      combinedFilmCatalogue.find((item) => item.id === film.id),
      expected,
    );
  }
});
