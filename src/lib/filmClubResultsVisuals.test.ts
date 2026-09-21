import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const resultsSource = await readFile(
  new URL("../components/FilmClubResults.tsx", import.meta.url),
  "utf8",
);
const stylesheet = await readFile(
  new URL("../styles/filmClubResults.module.css", import.meta.url),
  "utf8",
);

void test("starts with the useful voting stats instead of a decorative results hero", () => {
  assert.doesNotMatch(resultsSource, /<LeaderPanel\s+results=/);
  assert.doesNotMatch(resultsSource, /className=\{styles\.resultsHeader\}/);
  assert.doesNotMatch(resultsSource, /className=\{styles\.generatedAt\}/);
  assert.match(resultsSource, /<ResultStats\s+results=\{results\}\s*\/>/);
});

void test("lets the ordered list explain the ranking without a visible heading", () => {
  assert.doesNotMatch(resultsSource, />Alle filmer</);
  assert.doesNotMatch(
    resultsSource,
    /<h2 id="ranking-heading">Rangering<\/h2>/,
  );
  assert.match(resultsSource, /aria-label="Full rangering av filmer"/);
});

void test("keeps a quiet route back to the voting page", () => {
  assert.match(resultsSource, /className=\{styles\.backLink\}/);
  assert.match(resultsSource, />\s*Tilbake til avstemningen\s*<\/a>/);
});

void test("keeps the winner history without the redundant archive label", () => {
  assert.doesNotMatch(resultsSource, />Arkiv<\/p>/);
  assert.match(resultsSource, />Tidligere vinnere<\/h2>/);
});

void test("uses the restrained red cyan and cream results palette", () => {
  assert.match(stylesheet, /--results-red\s*:/);
  assert.match(stylesheet, /--results-cyan\s*:/);
  assert.match(stylesheet, /--results-cream\s*:/);
  assert.match(stylesheet, /--results-accent\s*:\s*var\(--results-red\)/);
});

void test("shows the stored TMDB score for every ranked film", () => {
  assert.match(
    resultsSource,
    /<FilmTmdbScore score=\{entry\.tmdbVoteAverage\}/,
  );
  assert.doesNotMatch(resultsSource, /tiedVoteCounts|tied=/);
});
