import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import type { NextApiRequest, NextApiResponse } from "next";
import catalogue from "@/data/filmVoteCatalogue.json";
import programmeConfig from "@/data/filmClubProgramme.json";

// A process-local configuration fixture exercises the longest valid club ID.
// No installation configuration, credentials or database files are modified.
const clubId = "c".repeat(64);
(programmeConfig.clubs as Record<string, unknown>)[clubId] = {
  name: "Long identifier fixture",
  activeScreening: null,
  history: [],
};
const directory = mkdtempSync(path.join(tmpdir(), "film-board-id-api-"));
process.env.CLUB_DB_PATH = path.join(directory, "votes.sqlite");
process.env.FILM_VOTE_SECRET_PATH = path.join(directory, "vote-secret");
process.env.FILMKLUBB_ADMIN_AUTH_PATH = path.join(directory, "admin.json");
process.env.FILMKLUBB_LOCAL_ADMIN = "1";
const [
  { getFilmVoteStore },
  { setInitialAdminPassword, createAdminSession, ADMIN_COOKIE },
  { default: admin },
  { default: votes },
] = await Promise.all([
  import("./filmVotes"),
  import("./filmAdminSession"),
  import("../pages/api/club/admin"),
  import("../pages/api/club/votes"),
]);
const store = getFilmVoteStore();
setInitialAdminPassword("temporary-fixture-password");
const cookie = createAdminSession(clubId);
after(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});
async function call(
  handler: (req: NextApiRequest, res: NextApiResponse) => unknown,
  query: Record<string, string>,
  body?: unknown,
) {
  let status = 200;
  let response: unknown;
  const req = {
    method: body ? "POST" : "GET",
    body,
    query,
    cookies: { [ADMIN_COOKIE]: cookie },
    headers: {
      host: "127.0.0.1:3058",
      origin: "http://127.0.0.1:3058",
      "content-type": "application/json",
    },
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as NextApiRequest;
  const res = {
    setHeader() {
      return this;
    },
    status(code: number) {
      status = code;
      return this;
    },
    json(value: unknown) {
      response = value;
      return this;
    },
  } as unknown as NextApiResponse;
  await handler(req, res);
  return { status, body: response };
}
const date = (offset: number) => new Date(Date.now() + offset).toISOString();
const fields = (screeningId: string) => ({
  screeningId,
  scheduledAt: date(86_400_000),
  published: true,
  venue: "Testsal",
  candidateIds: [catalogue[0]!.id],
  voteStartsAt: date(-3_600_000),
  voteEndsAt: date(3_600_000),
  resultsAt: date(7_200_000),
  displayUntil: date(90_000_000),
});

void test("128-character scheduled board can receive a vote and close through admin", async () => {
  const screeningId = "s".repeat(63);
  const boardId = `${clubId}-${screeningId}`;
  assert.equal(boardId.length, 128);
  const saved = await call(
    admin,
    { clubSlug: clubId },
    {
      action: "save",
      expectedRevision: null,
      round: fields(screeningId),
    },
  );
  assert.equal(saved.status, 200);
  const voted = await call(
    votes,
    { boardId },
    { filmId: catalogue[0]!.id, hasVoted: true },
  );
  assert.equal(voted.status, 200);
  assert.equal(store.getResults(boardId, [catalogue[0]!.id]).totalVotes, 1);
  const closed = await call(
    admin,
    { clubSlug: clubId },
    {
      action: "close",
      boardId,
      expectedRevision: 0,
    },
  );
  assert.equal(closed.status, 200);
  assert.equal(store.getLockedRound(boardId)!.stats.totalVotes, 1);
  // Completion rejects on the domain's screening-time rule, not ID parsing.
  const complete = await call(
    admin,
    { clubSlug: clubId },
    {
      action: "complete",
      boardId,
      expectedRevision: 1,
    },
  );
  assert.equal(complete.status, 409);
});

void test("129-character combined board is refused before schedule persistence", async () => {
  const screeningId = "s".repeat(64);
  const boardId = `${clubId}-${screeningId}`;
  assert.equal(boardId.length, 129);
  const before = store.listScheduledRounds(clubId).length;
  const rejected = await call(
    admin,
    { clubSlug: clubId },
    {
      action: "save",
      expectedRevision: null,
      round: fields(screeningId),
    },
  );
  assert.equal(rejected.status, 400);
  assert.match(
    (rejected.body as { error: { message: string } }).error.message,
    /128/,
  );
  assert.equal(store.getScheduledRound(boardId), null);
  assert.equal(store.listScheduledRounds(clubId).length, before);
  assert.equal((await call(votes, { boardId })).status, 400);
});
