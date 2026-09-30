import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import type { NextApiRequest, NextApiResponse } from "next";
import type { FilmRoundLockMetadata } from "./filmRound";
import filmVoteCatalogue from "@/data/filmVoteCatalogue.json";

const testDirectory = await fs.mkdtemp(
  path.join(tmpdir(), "filmklubb-results-api-"),
);
process.env.CLUB_DB_PATH = path.join(testDirectory, "results.sqlite");

const { getFilmVoteStore } = await import("./filmVotes");
const { buildScheduledFilmRoundMetadata } = await import("./filmRoundService");
const { default: handler } = await import("../pages/api/club/results");

interface RecordedResponse {
  body: unknown;
  headers: Record<string, string>;
  statusCode: number;
}

const invoke = async ({
  method = "GET",
  query = { clubSlug: "NA" },
}: {
  method?: string;
  query?: Record<string, string | string[]>;
} = {}): Promise<RecordedResponse> => {
  let responseBody: unknown;
  let statusCode = 200;
  const headers: Record<string, string> = {};
  const request = { method, query } as unknown as NextApiRequest;
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

const createOpenRound = (
  clubId: string,
  candidateIds: number[],
  customize?: (metadata: FilmRoundLockMetadata) => void,
) => {
  const instant = (offset: number) =>
    new Date(Date.now() + offset).toISOString();
  const screeningId = "first-screening";
  const scheduledAt = instant(86_400_000);
  const metadata = buildScheduledFilmRoundMetadata(
    clubId,
    screeningId,
    scheduledAt,
    "Testsal",
    candidateIds,
  );
  customize?.(metadata);
  const input = {
    clubId,
    screeningId,
    boardId: `${clubId}-${screeningId}`,
    metadata,
    scheduledAt,
    venue: "Testsal",
    published: true,
    voteStartsAt: instant(-3_600_000),
    voteEndsAt: instant(3_600_000),
    resultsAt: instant(7_200_000),
    displayUntil: instant(90_000_000),
  };
  getFilmVoteStore().saveScheduledRound(input, null);
  return input;
};

void test("fresh template has no fabricated results", async () => {
  assert.equal(
    (await invoke({ query: { clubSlug: "default" } })).statusCode,
    404,
  );
});

void test("returns scheduled screening, exact ranking and private aggregate use", async () => {
  const first = filmVoteCatalogue[0]!;
  const second = filmVoteCatalogue[1]!;
  const round = createOpenRound("ranking-fixture", [first.id, second.id]);
  const store = getFilmVoteStore();
  store.setVote("unrelated-board", first.id, "other-voter", true);
  store.setVote(round.boardId, second.id, "device-v1:a", true);
  store.setVote(round.boardId, second.id, "device-v1:b", true);
  store.setVote(round.boardId, first.id, "device-v1:a", true);
  const response = await invoke({ query: { clubSlug: round.clubId } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "private, no-store");
  const body = response.body as {
    activeScreening: { id: string; scheduledAt: string };
    ranking: unknown[];
    history: unknown[];
    revision: number;
    stats: {
      totalVotes: number;
      participatingDevices: number;
      lastVoteAt: string;
    };
  };
  assert.deepEqual(body.activeScreening, {
    id: round.screeningId,
    scheduledAt: round.scheduledAt,
  });
  assert.deepEqual(body.ranking[0], {
    filmId: second.id,
    rank: 1,
    title: second.title,
    coverImage: second.coverImage,
    tmdbVoteAverage: second.tmdbVoteAverage,
    votes: 2,
  });
  assert.equal(body.revision, 3);
  assert.equal(body.stats.totalVotes, 3);
  assert.equal(body.stats.participatingDevices, 2);
  assert.match(body.stats.lastVoteAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(body.history, []);
  assert.equal(JSON.stringify(body).includes("device-v1"), false);
});

void test("orders tied scheduled results by TMDB score", async () => {
  const master = filmVoteCatalogue.find(({ title }) => title === "The Master")!;
  const yiYi = filmVoteCatalogue.find(({ title }) => title === "Yi Yi")!;
  const round = createOpenRound("ties-fixture", [master.id, yiYi.id]);
  const store = getFilmVoteStore();
  store.setVote(round.boardId, master.id, "results-master", true);
  store.setVote(round.boardId, yiYi.id, "results-yi-yi", true);
  const response = await invoke({ query: { clubSlug: round.clubId } });
  assert.equal(response.statusCode, 200);
  const body = response.body as { ranking: Array<{ filmId: number }> };
  assert.deepEqual(
    body.ranking.map(({ filmId }) => filmId),
    [yiYi.id, master.id],
  );
});

void test("rejects unsupported methods", async () => {
  const response = await invoke({ method: "POST" });
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.allow, "GET");
});

void test("closed scheduled results use frozen metadata, scores and totals", async () => {
  const first = filmVoteCatalogue[0]!;
  const round = createOpenRound("frozen-results", [first.id], (metadata) => {
    metadata.catalogue[0]!.title = "Title when the round closed";
    metadata.ticketTemplates[String(first.id)]!.film.title =
      "Title when the round closed";
    metadata.catalogue[0]!.tmdbVoteAverage = 6.5;
  });
  const store = getFilmVoteStore();
  store.setVote(round.boardId, first.id, "private-test-voter", true);
  store.closeScheduledRound(round.boardId, 0);
  round.metadata.catalogue[0]!.title = "Later catalogue title";
  const response = await invoke({ query: { clubSlug: round.clubId } });
  const body = response.body as {
    ranking: Array<{ title: string; votes: number; tmdbVoteAverage: number }>;
    stats: { totalVotes: number };
  };
  assert.equal(response.statusCode, 200);
  assert.equal(body.ranking[0]?.title, "Title when the round closed");
  assert.equal(body.ranking[0]?.tmdbVoteAverage, 6.5);
  assert.equal(body.ranking[0]?.votes, 1);
  assert.equal(body.stats.totalVotes, 1);
  assert.equal(JSON.stringify(body).includes("private-test-voter"), false);
});
