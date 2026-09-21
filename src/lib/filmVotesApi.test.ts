import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import type { NextApiRequest, NextApiResponse } from "next";
import filmVoteCatalogue from "@/data/filmVoteCatalogue.json";
import { normalizeClubSlug } from "@/lib/clubSlug";

const secondFilmId = filmVoteCatalogue[1]!.id;
const thirdFilmId = filmVoteCatalogue[2]!.id;
const fourthFilmId = filmVoteCatalogue[3]!.id;
const firstFilmId = filmVoteCatalogue[0]!.id;
const newestFilmId = filmVoteCatalogue.at(-1)!.id;
const master = filmVoteCatalogue.find(({ title }) => title === "The Master")!;
const yiYi = filmVoteCatalogue.find(({ title }) => title === "Yi Yi")!;

const testDirectory = await fs.mkdtemp(
  path.join(tmpdir(), "filmklubb-votes-api-"),
);
process.env.CLUB_DB_PATH = path.join(testDirectory, "votes.sqlite");
process.env.FILM_VOTE_SECRET_PATH = path.join(testDirectory, "vote-secret");

const testIdentitySecret = Buffer.alloc(32, 7);
await fs.writeFile(process.env.FILM_VOTE_SECRET_PATH, testIdentitySecret);
const { createDeviceIdentity, DEVICE_COOKIE_NAME } = await import(
  "./voterIdentity"
);
const deviceCookie = (seed: number): Record<string, string> => ({
  [DEVICE_COOKIE_NAME]: createDeviceIdentity(
    testIdentitySecret,
    Buffer.alloc(32, seed),
  ).cookieValue,
});

const { default: handler } = await import("../pages/api/club/votes");
const { getFilmVoteStore } = await import("./filmVotes");
const { buildFilmRoundLockMetadata, buildScheduledFilmRoundMetadata } =
  await import("./filmRoundService");
const store = getFilmVoteStore();

const legacyBoardIds = new Set([
  "na",
  "default",
  "na-2026-09-22",
  "default-2026-09-22",
]);
const fixtureScheduleTimes = {
  voteStartsAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  voteEndsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  resultsAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  scheduledAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
  displayUntil: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
};

const ensureScheduledFixture = (boardId: string): void => {
  if (legacyBoardIds.has(boardId) || store.getScheduledRound(boardId)) {
    return;
  }

  const separator = boardId.lastIndexOf("-");
  assert.ok(separator > 0 && separator < boardId.length - 1);
  const clubId = boardId.slice(0, separator);
  const screeningId = boardId.slice(separator + 1);
  store.saveScheduledRound(
    {
      boardId,
      clubId,
      screeningId,
      ...fixtureScheduleTimes,
      venue: "Test fixture",
      published: true,
      metadata: buildScheduledFilmRoundMetadata(
        clubId,
        screeningId,
        fixtureScheduleTimes.scheduledAt,
        "Test fixture",
        filmVoteCatalogue.map((film) => film.id),
      ),
    },
    null,
  );
};

interface RecordedResponse {
  body: unknown;
  headers: Record<string, string>;
  statusCode: number;
}

const invoke = async ({
  body,
  clientIp = "203.0.113.8",
  cookies = deviceCookie(1),
  method,
  query = { boardId: "na" },
  remoteAddress = "127.0.0.1",
  seedFixture = true,
}: {
  body?: unknown;
  clientIp?: string;
  cookies?: Record<string, string>;
  method: string;
  query?: Record<string, string | string[]>;
  remoteAddress?: string;
  seedFixture?: boolean;
}): Promise<RecordedResponse> => {
  const requestedBoardId = Array.isArray(query.boardId)
    ? query.boardId[0]
    : query.boardId;
  const boardId = requestedBoardId ? normalizeClubSlug(requestedBoardId) : null;
  if (seedFixture && boardId) {
    ensureScheduledFixture(boardId);
  }

  let responseBody: unknown;
  let statusCode = 200;
  const headers: Record<string, string> = {};

  const request = {
    body,
    cookies,
    headers: clientIp ? { "x-client-ip": clientIp } : {},
    method,
    query,
    socket: { remoteAddress },
  } as unknown as NextApiRequest;
  const response = {
    json(payload: unknown) {
      responseBody = payload;
      return this;
    },
    setHeader(name: string, value: string | number | readonly string[]) {
      headers[name.toLowerCase()] = Array.isArray(value)
        ? value.join(", ")
        : String(value);
      return this;
    },
    status(nextStatusCode: number) {
      statusCode = nextStatusCode;
      return this;
    },
  } as unknown as NextApiResponse;

  await handler(request, response);
  return { body: responseBody, headers, statusCode };
};

after(async () => {
  await fs.rm(testDirectory, { force: true, recursive: true });
});

void test("GET returns the shared ranking and this device's voted films", async () => {
  const response = await invoke({ method: "GET", query: { boardId: "NA" } });

  assert.equal(response.statusCode, 200);
  const body = response.body as {
    boardId: string;
    ranking: Array<{ filmId: number; votes: number }>;
    revision: number;
    votedFilmIds: number[];
  };
  assert.equal(body.boardId, "na");
  assert.equal(body.ranking.length, filmVoteCatalogue.length);
  assert.equal(body.ranking[0]?.filmId, firstFilmId);
  assert.equal(body.revision, 0);
  assert.deepEqual(body.votedFilmIds, []);
  assert.equal(JSON.stringify(body).includes("203.0.113.8"), false);
});

void test("GET keeps catalogue order when vote totals are equal", async () => {
  const response = await invoke({
    method: "GET",
    query: { boardId: "tmdb-tie-break" },
  });

  assert.equal(response.statusCode, 200);
  const body = response.body as {
    ranking: Array<{ filmId: number; votes: number }>;
  };
  assert.deepEqual(body.ranking[0], {
    filmId: firstFilmId,
    votes: 0,
  });
});

void test("GET ranks a positive vote tie by TMDB score", async () => {
  assert.ok(yiYi.tmdbVoteAverage > master.tmdbVoteAverage);
  const boardId = "tmdb-positive-tie-break";

  await invoke({
    body: { filmId: master.id },
    cookies: deviceCookie(41),
    method: "POST",
    query: { boardId },
  });
  const response = await invoke({
    body: { filmId: yiYi.id },
    cookies: deviceCookie(42),
    method: "POST",
    query: { boardId },
  });

  const body = response.body as {
    ranking: Array<{ filmId: number; votes: number }>;
  };
  assert.deepEqual(body.ranking.slice(0, 2), [
    { filmId: yiYi.id, votes: 1 },
    { filmId: master.id, votes: 1 },
  ]);
});

void test("POST is idempotent per device and film", async () => {
  const boardId = "one-vote";
  const first = await invoke({
    body: { filmId: secondFilmId },
    method: "POST",
    query: { boardId },
  });
  const duplicate = await invoke({
    body: { filmId: secondFilmId },
    method: "POST",
    query: { boardId },
  });

  assert.equal(first.statusCode, 200);
  assert.equal(duplicate.statusCode, 200);
  const body = duplicate.body as {
    ranking: Array<{ filmId: number; votes: number }>;
    revision: number;
    votedFilmIds: number[];
  };
  assert.equal(body.revision, 1);
  assert.deepEqual(body.ranking[0], { filmId: secondFilmId, votes: 1 });
  assert.deepEqual(body.votedFilmIds, [secondFilmId]);
});

void test("POST accepts a film appended to the curated catalogue", async () => {
  const response = await invoke({
    body: { filmId: newestFilmId },
    cookies: deviceCookie(31),
    method: "POST",
    query: { boardId: "watchlist-addition" },
  });

  assert.equal(response.statusCode, 200);
  const body = response.body as {
    ranking: Array<{ filmId: number; votes: number }>;
    votedFilmIds: number[];
  };
  assert.deepEqual(body.ranking[0], { filmId: newestFilmId, votes: 1 });
  assert.deepEqual(body.votedFilmIds, [newestFilmId]);
});

void test("POST removes one device's vote without removing another device's vote", async () => {
  const boardId = "remove-vote";
  await invoke({
    body: { filmId: secondFilmId, hasVoted: true },
    cookies: deviceCookie(1),
    method: "POST",
    query: { boardId },
  });
  await invoke({
    body: { filmId: secondFilmId, hasVoted: true },
    cookies: deviceCookie(2),
    method: "POST",
    query: { boardId },
  });
  const response = await invoke({
    body: { filmId: secondFilmId, hasVoted: false },
    cookies: deviceCookie(1),
    method: "POST",
    query: { boardId },
  });

  assert.equal(response.statusCode, 200);
  const body = response.body as {
    ranking: Array<{ filmId: number; votes: number }>;
    revision: number;
    votedFilmIds: number[];
  };
  assert.equal(body.revision, 3);
  assert.deepEqual(body.ranking[0], { filmId: secondFilmId, votes: 1 });
  assert.deepEqual(body.votedFilmIds, []);
});

void test("POST treats repeated removal as an idempotent no-op", async () => {
  const boardId = "repeat-removal";
  await invoke({
    body: { filmId: thirdFilmId, hasVoted: true },
    method: "POST",
    query: { boardId },
  });
  await invoke({
    body: { filmId: thirdFilmId, hasVoted: false },
    method: "POST",
    query: { boardId },
  });
  const response = await invoke({
    body: { filmId: thirdFilmId, hasVoted: false },
    method: "POST",
    query: { boardId },
  });

  assert.equal(response.statusCode, 200);
  const body = response.body as { revision: number; votedFilmIds: number[] };
  assert.equal(body.revision, 2);
  assert.deepEqual(body.votedFilmIds, []);
});

void test("one device can vote for several different films", async () => {
  const boardId = "several-films";
  await invoke({
    body: { filmId: secondFilmId },
    method: "POST",
    query: { boardId },
  });
  const response = await invoke({
    body: { filmId: thirdFilmId },
    method: "POST",
    query: { boardId },
  });

  const body = response.body as { revision: number; votedFilmIds: number[] };
  assert.equal(body.revision, 2);
  assert.deepEqual(body.votedFilmIds, [secondFilmId, thirdFilmId]);
});

void test("different devices on the same IP contribute separate votes", async () => {
  const boardId = "different-devices";
  await invoke({
    body: { filmId: fourthFilmId },
    clientIp: "203.0.113.8",
    cookies: deviceCookie(1),
    method: "POST",
    query: { boardId },
  });
  const response = await invoke({
    body: { filmId: fourthFilmId },
    clientIp: "203.0.113.8",
    cookies: deviceCookie(2),
    method: "POST",
    query: { boardId },
  });

  const body = response.body as {
    ranking: Array<{ filmId: number; votes: number }>;
  };
  assert.deepEqual(body.ranking[0], { filmId: fourthFilmId, votes: 2 });
});

void test("the shared leader changes when independent devices move another film ahead", async () => {
  const boardId = "leader-change";
  for (const seed of [1, 2]) {
    await invoke({
      body: { filmId: fourthFilmId },
      clientIp: "203.0.113.8",
      cookies: deviceCookie(seed),
      method: "POST",
      query: { boardId },
    });
  }

  let response: RecordedResponse | null = null;
  for (const seed of [3, 4, 5]) {
    response = await invoke({
      body: { filmId: thirdFilmId },
      clientIp: "203.0.113.8",
      cookies: deviceCookie(seed),
      method: "POST",
      query: { boardId },
    });
  }

  const body = response?.body as {
    ranking: Array<{ filmId: number; votes: number }>;
  };
  assert.deepEqual(body.ranking[0], { filmId: thirdFilmId, votes: 3 });
  assert.deepEqual(body.ranking[1], { filmId: fourthFilmId, votes: 2 });
});

void test("the same device keeps its votes after changing IP", async () => {
  const boardId = "moving-device";
  await invoke({
    body: { filmId: secondFilmId },
    clientIp: "203.0.113.8",
    cookies: deviceCookie(6),
    method: "POST",
    query: { boardId },
  });
  const response = await invoke({
    clientIp: "198.51.100.9",
    cookies: deviceCookie(6),
    method: "GET",
    query: { boardId },
  });

  const body = response.body as { votedFilmIds: number[] };
  assert.deepEqual(body.votedFilmIds, [secondFilmId]);
});

void test("a first visit works without an IP and issues a secure device cookie", async () => {
  const response = await invoke({
    clientIp: "",
    cookies: {},
    method: "GET",
    query: { boardId: "fresh-device" },
    remoteAddress: "",
  });

  assert.equal(response.statusCode, 200);
  assert.match(
    response.headers["set-cookie"] ?? "",
    new RegExp(`^${DEVICE_COOKIE_NAME}=v1\\.`),
  );
  assert.match(response.headers["set-cookie"] ?? "", /HttpOnly/);
  assert.match(response.headers["set-cookie"] ?? "", /SameSite=Lax/);
});

void test("rejects a request without an explicit screening board", async () => {
  const response = await invoke({ method: "GET", query: {} });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, {
    error: { code: "INVALID_REQUEST", message: "Ugyldig stemme." },
  });
});

void test("rejects an unknown unscheduled board for both reads and writes", async () => {
  const query = { boardId: "unknown-unscheduled-board" };
  const expected = {
    error: { code: "INVALID_REQUEST", message: "Ugyldig stemme." },
  };

  const read = await invoke({
    method: "GET",
    query,
    seedFixture: false,
  });
  assert.equal(read.statusCode, 400);
  assert.deepEqual(read.body, expected);

  const write = await invoke({
    body: { filmId: firstFilmId },
    method: "POST",
    query,
    seedFixture: false,
  });
  assert.equal(write.statusCode, 400);
  assert.deepEqual(write.body, expected);
});

void test("rejects films outside the fixed catalogue", async () => {
  const response = await invoke({
    body: { filmId: 999 },
    method: "POST",
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, {
    error: { code: "INVALID_REQUEST", message: "Ugyldig stemme." },
  });
});

void test("rejects a non-boolean requested vote state", async () => {
  const response = await invoke({
    body: { filmId: secondFilmId, hasVoted: "false" },
    method: "POST",
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, {
    error: { code: "INVALID_REQUEST", message: "Ugyldig stemme." },
  });
});

void test("rejects unsupported methods with the stable error shape", async () => {
  const response = await invoke({ method: "DELETE" });

  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.allow, "GET, POST");
  assert.deepEqual(response.body, {
    error: { code: "METHOD_NOT_ALLOWED", message: "Metoden er ikke tillatt." },
  });
});

void test("rejects vote changes after the round has been locked", async () => {
  const boardId = "default-2026-09-22";
  const film = filmVoteCatalogue[0]!;
  store.setVote(boardId, film.id, "round-closed-voter", true);
  store.lockRound(boardId, buildFilmRoundLockMetadata("default"), 1);

  const response = await invoke({
    body: { filmId: film.id },
    method: "POST",
    query: { boardId },
  });

  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.body, {
    error: { code: "ROUND_CLOSED", message: "Avstemningen er låst." },
  });
});
