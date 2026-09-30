import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import type { NextApiRequest, NextApiResponse } from "next";
import filmVoteCatalogue from "@/data/filmVoteCatalogue.json";

const testDirectory = await fs.mkdtemp(
  path.join(tmpdir(), "filmklubb-round-api-"),
);
process.env.CLUB_DB_PATH = path.join(testDirectory, "rounds.sqlite");

const [
  { getFilmVoteStore },
  { buildScheduledFilmRoundMetadata },
  { default: handler },
] = await Promise.all([
  import("./filmVotes"),
  import("./filmRoundService"),
  import("../pages/api/club/round"),
]);

interface RecordedResponse {
  body: unknown;
  headers: Record<string, string>;
  statusCode: number;
}

const invoke = async ({
  method = "GET",
  query = { clubSlug: "default" },
}: {
  method?: string;
  query?: Record<string, string | string[]>;
} = {}): Promise<RecordedResponse> => {
  let responseBody: unknown;
  let statusCode = 200;
  const headers: Record<string, string> = {};
  const request = {
    headers: { "x-forwarded-for": "198.51.100.20" },
    method,
    query,
    socket: { remoteAddress: "198.51.100.20" },
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

  handler(request, response);
  return { body: responseBody, headers, statusCode };
};

after(async () => {
  await fs.rm(testDirectory, { force: true, recursive: true });
});

void test("a fresh template has no active election", async () => {
  const response = await invoke();
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "private, no-store");
  assert.deepEqual(response.body, { status: "idle" });
});

void test("reports an explicitly published round as open", async () => {
  const now = Date.now();
  const scheduledAt = new Date(now + 3 * 3600000).toISOString();
  getFilmVoteStore().saveScheduledRound(
    {
      boardId: "default-screening",
      clubId: "default",
      screeningId: "screening",
      voteStartsAt: new Date(now - 3600000).toISOString(),
      voteEndsAt: new Date(now + 3600000).toISOString(),
      resultsAt: new Date(now + 2 * 3600000).toISOString(),
      scheduledAt,
      displayUntil: new Date(now + 4 * 3600000).toISOString(),
      venue: "Test fixture",
      published: true,
      metadata: buildScheduledFilmRoundMetadata(
        "default",
        "screening",
        scheduledAt,
        "Test fixture",
        filmVoteCatalogue.map((film) => film.id),
      ),
    },
    null,
  );
  const response = await invoke();
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "private, no-store");
  assert.deepEqual(response.body, {
    status: "open",
    boardId: "default-screening",
    scheduledAt,
    venue: "Test fixture",
    candidateIds: filmVoteCatalogue.map((film) => film.id),
  });
});

void test("rejects malformed and extra round query parameters", async () => {
  const malformed = await invoke({
    query: { clubSlug: ["default"], screeningId: "2026/09/22" },
  });
  const extra = await invoke({
    query: { clubSlug: "default", unexpected: "value" },
  });

  assert.equal(malformed.statusCode, 400);
  assert.deepEqual(malformed.body, {
    error: { code: "INVALID_REQUEST", message: "Ugyldig runde." },
  });
  assert.equal(extra.statusCode, 400);
  assert.deepEqual(extra.body, {
    error: { code: "INVALID_REQUEST", message: "Ugyldig runde." },
  });
});

void test("rejects unsupported methods and unknown historic rounds", async () => {
  const method = await invoke({ method: "POST" });
  const historic = await invoke({
    query: { clubSlug: "default", screeningId: "2026-01-01" },
  });

  assert.equal(method.statusCode, 405);
  assert.equal(method.headers.allow, "GET");
  assert.deepEqual(method.body, {
    error: {
      code: "METHOD_NOT_ALLOWED",
      message: "Metoden er ikke tillatt.",
    },
  });
  assert.equal(historic.statusCode, 404);
  assert.deepEqual(historic.body, {
    error: { code: "ROUND_NOT_FOUND", message: "Runden finnes ikke." },
  });
});

void test("returns the frozen snapshot after the round is locked", async () => {
  const boardId = "default-closed";
  const winningFilm = filmVoteCatalogue[0]!;
  const store = getFilmVoteStore();
  store.setVote(boardId, winningFilm.id, "round-api-voter", true);
  store.lockRound(
    boardId,
    buildScheduledFilmRoundMetadata(
      "default",
      "closed",
      "2030-01-01T16:00:00+01:00",
      "Test fixture",
      filmVoteCatalogue.map((film) => film.id),
    ),
    1,
  );

  const response = await invoke({
    query: { clubSlug: "default", screeningId: "closed" },
  });

  assert.equal(response.statusCode, 200);
  const body = response.body as {
    boardId: string;
    snapshot: {
      ranking: Array<{
        film: { id: number };
        tmdbVoteAverage?: number;
        votes: number;
      }>;
      stats: { totalVotes: number };
      ticket: { director?: string; film: { id: number } } | null;
      winner: { film: { id: number } } | null;
    };
    status: string;
  };
  assert.equal(body.status, "closed");
  assert.equal(body.boardId, boardId);
  assert.equal(body.snapshot.ranking.length, filmVoteCatalogue.length);
  assert.equal(body.snapshot.ranking[0]?.film.id, winningFilm.id);
  assert.equal(
    body.snapshot.ranking[0]?.tmdbVoteAverage,
    winningFilm.tmdbVoteAverage,
  );
  assert.equal(body.snapshot.winner?.film.id, winningFilm.id);
  assert.equal(body.snapshot.stats.totalVotes, 1);
  assert.equal(body.snapshot.ticket?.film.id, winningFilm.id);
  assert.equal(typeof body.snapshot.ticket?.director, "string");
});
