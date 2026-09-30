import assert from "node:assert/strict";
import { test } from "node:test";
import { tmdbScoreLabel } from "./filmTmdbScore";

void test("formats every known TMDB score independently of votes or ties", () => {
  assert.equal(tmdbScoreLabel(8.123), "TMDB 8,123");
  assert.equal(tmdbScoreLabel(8), "TMDB 8,0");
  assert.equal(tmdbScoreLabel(0), "TMDB 0,0");
});

void test("omits missing or non-finite scores", () => {
  assert.equal(tmdbScoreLabel(undefined), null);
  assert.equal(tmdbScoreLabel(NaN), null);
  assert.equal(tmdbScoreLabel(Infinity), null);
});
