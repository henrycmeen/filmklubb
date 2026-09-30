import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import type { NextApiRequest, NextApiResponse } from "next";
import programmeJson from "@/data/filmClubProgramme.json";
import filmCatalogue from "@/data/filmVoteCatalogue.json";

// This isolated test process changes only the shared imported object before
// programme/services load. The checked-in empty configuration is never written.
const fixture = programmeJson as unknown as {
  clubs: Record<
    string,
    {
      name: string;
      activeScreening: { id: string; scheduledAt: string } | null;
      history: unknown[];
    }
  >;
  aliases: Record<string, string>;
};
fixture.clubs.legacy = {
  name: "Fictional legacy club",
  activeScreening: {
    id: "fixture-screening",
    scheduledAt: "2030-01-15T16:00:00+01:00",
  },
  history: [],
};
fixture.aliases.existing = "legacy";
const directory = await fs.mkdtemp(path.join(tmpdir(), "film-legacy-compat-"));
process.env.CLUB_DB_PATH = path.join(directory, "votes.sqlite");
process.env.FILMKLUBB_ADMIN_AUTH_PATH = path.join(directory, "admin.json");
process.env.FILM_VOTE_SECRET_PATH = path.join(directory, "vote-secret");
const { resolveCanonicalClubId, getActiveVoteBoardId } = await import(
  "./filmClubProgramme"
);
const { getFilmVoteStore } = await import("./filmVotes");
const { buildFilmRoundLockMetadata } = await import("./filmRoundService");
const { getPublicFilmRound } = await import("./filmScheduleService");
const { default: votes } = await import("../pages/api/club/votes");
const store = getFilmVoteStore();
after(async () => {
  store.close();
  await fs.rm(directory, { recursive: true, force: true });
});

async function vote(boardId: string, filmId: number) {
  let status = 200;
  let body: unknown;
  const req = {
    method: "POST",
    query: { boardId },
    body: { filmId },
    cookies: {},
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as NextApiRequest;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
    setHeader() {
      return this;
    },
  } as unknown as NextApiResponse;
  await votes(req, res);
  return { status, body };
}

void test("explicit legacy programmes retain voting, aliases and immutable closed results", async () => {
  const boardId = "legacy-fixture-screening";
  // These assertions also prove runtime modules see the in-memory fixture.
  assert.equal(resolveCanonicalClubId("existing"), "legacy");
  assert.equal(getActiveVoteBoardId("existing"), boardId);
  assert.deepEqual(getPublicFilmRound("existing"), { status: "open", boardId });
  const film = filmCatalogue[0]!;
  const bare = await vote("legacy", film.id);
  assert.equal(bare.status, 200);
  assert.equal((bare.body as { revision: number }).revision, 1);
  const current = await vote(boardId, film.id);
  assert.equal(current.status, 200);
  assert.equal((current.body as { revision: number }).revision, 1);
  const locked = store.lockRound(
    boardId,
    buildFilmRoundLockMetadata("existing"),
    1,
  );
  assert.equal(locked.winner?.film.id, film.id);
  assert.equal(locked.stats.totalVotes, 1);
  assert.equal(locked.ticket?.date, "2030-01-15");
  const publicResult = getPublicFilmRound("existing");
  assert.deepEqual(publicResult, {
    status: "closed",
    boardId,
    snapshot: locked,
  });
  const rejected = await vote(boardId, film.id);
  assert.equal(rejected.status, 409);
  assert.deepEqual(rejected.body, {
    error: { code: "ROUND_CLOSED", message: "Avstemningen er låst." },
  });
  assert.deepEqual(store.getLockedRound(boardId), locked);
  assert.equal(getPublicFilmRound("unknown", "fixture-screening"), null);
  const unknown = await vote("unknown-fixture-screening", film.id);
  assert.equal(unknown.status, 400);
  assert.deepEqual(unknown.body, {
    error: { code: "INVALID_REQUEST", message: "Ugyldig stemme." },
  });
});
