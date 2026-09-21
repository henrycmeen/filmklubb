import assert from "node:assert/strict";
import { test } from "node:test";
import { tiedVoteCounts, tieScoreLabel } from "./filmTieScore";

void test("finds positive vote ties but excludes films with zero votes", () => {
  assert.deepEqual(
    [...tiedVoteCounts([8, 7, 7, 7, 5, 0, 0].map((votes) => ({ votes })))],
    [7],
  );
  const zeroTies = tiedVoteCounts([{ votes: 0 }, { votes: 0 }]);
  assert.equal(tieScoreLabel(zeroTies.has(0), 8.123), null);
  assert.equal(tiedVoteCounts([]).size, 0);
  assert.equal(tiedVoteCounts([{ votes: 8 }]).size, 0);
});

void test("shows a precise Norwegian TMDB score only for a tied film with a known score", () => {
  assert.equal(tieScoreLabel(true, 8.123), "TMDB 8,123");
  assert.equal(tieScoreLabel(true, 8), "TMDB 8,0");
  assert.equal(tieScoreLabel(false, 8.123), null);
  assert.equal(tieScoreLabel(true, undefined), null);
  assert.equal(tieScoreLabel(true, NaN), null);
});
