import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { formatLastFilmVote } from "./filmRoundStats";

void test("last vote uses Oslo time, including the winter offset", () => {
  assert.match(formatLastFilmVote("2026-09-21T10:28:00Z"), /12:28/);
  assert.match(formatLastFilmVote("2026-10-28T15:00:00Z"), /16:00/);
  assert.equal(formatLastFilmVote(null), "Ingen stemmer ennå");
  assert.equal(formatLastFilmVote("invalid"), "Tidspunkt ukjent");
});

void test("both new result views use locked snapshot stats without extra requests", async () => {
  const closed = await readFile(
    new URL("../components/ClosedFilmRound.tsx", import.meta.url),
    "utf8",
  );
  const finale = await readFile(
    new URL("../components/TicketFinale.tsx", import.meta.url),
    "utf8",
  );
  const stats = await readFile(
    new URL("../components/FilmRoundStats.tsx", import.meta.url),
    "utf8",
  );
  assert.match(closed, /<FilmRoundStats stats=\{snapshot.stats\}/);
  assert.match(closed, /<TicketFinale[\s\S]*?stats=\{snapshot.stats\}/);
  assert.match(finale, /finished &&[\s\S]*?<FilmRoundStats stats=\{stats\}/);
  for (const field of ["totalVotes", "participatingDevices", "lastVoteAt"]) {
    assert.ok(stats.includes(`stats.${field}`));
  }
  assert.doesNotMatch(stats, /fetch\(/);
});
