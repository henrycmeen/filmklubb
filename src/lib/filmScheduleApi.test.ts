import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import type { NextApiRequest, NextApiResponse } from "next";
import catalogue from "@/data/filmVoteCatalogue.json";

const directory = mkdtempSync(path.join(tmpdir(), "film-schedule-api-"));
process.env.CLUB_DB_PATH = path.join(directory, "votes.sqlite");
process.env.FILMKLUBB_ADMIN_AUTH_PATH = path.join(directory, "admin.json");
process.env.FILMKLUBB_LOCAL_ADMIN = "1";
const [
  { getFilmVoteStore },
  { buildScheduledFilmRoundMetadata, getCurrentFilmRound },
  { setInitialAdminPassword, createAdminSession, ADMIN_COOKIE },
  { default: round },
  { default: results },
  { default: votes },
  { default: admin },
] = await Promise.all([
  import("./filmVotes"),
  import("./filmRoundService"),
  import("./filmAdminSession"),
  import("../pages/api/club/round"),
  import("../pages/api/club/results"),
  import("../pages/api/club/votes"),
  import("../pages/api/club/admin"),
]);
const store = getFilmVoteStore();
after(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});
const date = (offset: number) => new Date(Date.now() + offset).toISOString();
const film = catalogue[0]!;
async function call(
  handler: (req: NextApiRequest, res: NextApiResponse) => unknown,
  query: Record<string, string>,
  body?: unknown,
  cookie?: string,
) {
  let status = 200;
  let response: unknown;
  const req = {
    method: body ? "POST" : "GET",
    body,
    query,
    cookies: cookie ? { [ADMIN_COOKIE]: cookie } : {},
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

void test("all public APIs keep unpublished and awaiting-release results private", async () => {
  const scheduledAt = date(86_400_000);
  for (const published of [false, true]) {
    const screeningId = published ? "pending-release" : "draft-only";
    const boardId = `na-${screeningId}`;
    store.setVote(boardId, film.id, "fixture-voter", true);
    store.saveScheduledRound(
      {
        boardId,
        clubId: "na",
        screeningId,
        scheduledAt,
        published,
        venue: "Testsal",
        voteStartsAt: date(-3_600_000),
        voteEndsAt: date(-60_000),
        resultsAt: date(3_600_000),
        displayUntil: date(90_000_000),
        metadata: buildScheduledFilmRoundMetadata(
          "na",
          screeningId,
          scheduledAt,
          "Testsal",
          [film.id],
        ),
      },
      null,
    );
    const state = await call(round, { clubSlug: "na", screeningId });
    assert.equal(state.status, published ? 200 : 404);
    if (published)
      assert.equal((state.body as { status: string }).status, "awaiting");
    assert.equal(JSON.stringify(state.body).includes("ranking"), false);
    const result = await call(results, { clubSlug: "na", screeningId });
    assert.equal(result.status, published ? 409 : 404);
    const ballot = await call(votes, { boardId });
    assert.equal(ballot.status, 409);
    assert.equal(JSON.stringify(ballot.body).includes("ranking"), false);
    assert.equal(store.getResults(boardId, [film.id]).totalVotes, 1);
  }
});

void test("authenticated admin creates and closes a round without changing votes", async () => {
  setInitialAdminPassword("temporary-test-password");
  const cookie = createAdminSession("default");
  const screeningId = "managed-test";
  const boardId = `default-${screeningId}`;
  const fields = {
    screeningId,
    scheduledAt: date(86_400_000),
    published: true,
    venue: "Testsal",
    candidateIds: [film.id],
    voteStartsAt: date(-3_600_000),
    voteEndsAt: date(3_600_000),
    resultsAt: date(7_200_000),
    displayUntil: date(90_000_000),
  };
  const legacy = getCurrentFilmRound("default");
  store.setVote(legacy.boardId, film.id, "legacy-voter", true);
  const rejectedDraft = await call(
    admin,
    { clubSlug: "default" },
    {
      action: "save",
      expectedRevision: null,
      round: { ...fields, screeningId: legacy.screeningId, published: false },
    },
    cookie,
  );
  assert.equal(rejectedDraft.status, 409);
  assert.equal(store.getScheduledRound(legacy.boardId), null);
  const legacyState = await call(round, { clubSlug: "default" });
  assert.equal((legacyState.body as { status: string }).status, "open");
  store.setVote(legacy.boardId, film.id, "second-legacy-voter", true);
  assert.equal(store.getResults(legacy.boardId, [film.id]).totalVotes, 2);
  const saved = await call(
    admin,
    { clubSlug: "default" },
    { action: "save", expectedRevision: null, round: fields },
    cookie,
  );
  assert.equal(saved.status, 200);
  store.setVote(boardId, film.id, "retained-voter", true);
  assert.equal(
    (
      await call(
        admin,
        { clubSlug: "default" },
        { action: "close", boardId, expectedRevision: 99 },
        cookie,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await call(
        admin,
        { clubSlug: "default" },
        { action: "close", boardId, expectedRevision: 0 },
        cookie,
      )
    ).status,
    200,
  );
  const published = await call(round, { clubSlug: "default", screeningId });
  assert.equal(published.status, 200);
  const snapshot = published.body as {
    status: string;
    snapshot: { stats: { totalVotes: number }; snapshotHash: string };
  };
  assert.equal(snapshot.status, "closed");
  assert.equal(snapshot.snapshot.stats.totalVotes, 1);
  const again = await call(
    admin,
    { clubSlug: "default" },
    { action: "close", boardId, expectedRevision: 0 },
    cookie,
  );
  assert.equal(again.status, 200);
  assert.equal(
    store.getLockedRound(boardId)!.snapshotHash,
    snapshot.snapshot.snapshotHash,
  );
});
