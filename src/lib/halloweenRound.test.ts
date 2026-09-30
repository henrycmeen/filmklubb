import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import type { NextApiRequest, NextApiResponse } from "next";
import {
  halloweenFilmCatalogue,
  legacyFilmCatalogue,
} from "@/lib/filmCatalogue";

const testDirectory = await fs.mkdtemp(
  path.join(tmpdir(), "filmklubb-halloween-round-"),
);
process.env.CLUB_DB_PATH = path.join(testDirectory, "votes.sqlite");
process.env.FILM_VOTE_SECRET_PATH = path.join(testDirectory, "vote-secret");
await fs.writeFile(process.env.FILM_VOTE_SECRET_PATH, Buffer.alloc(32, 23));

const [
  { default: votesHandler },
  { getFilmVoteStore },
  { buildScheduledFilmRoundMetadata },
  { createDeviceIdentity, DEVICE_COOKIE_NAME },
] = await Promise.all([
  import("@/pages/api/club/votes"),
  import("@/lib/filmVotes"),
  import("@/lib/filmRoundService"),
  import("@/lib/voterIdentity"),
]);

const store = getFilmVoteStore();
const boardId = "na-halloween-api";
const screeningId = "halloween-api";
const halloweenFilm = halloweenFilmCatalogue[0]!;
const outsideSeasonFilm = halloweenFilmCatalogue[1]!;
const now = Date.now();
const time = (offsetMs: number): string =>
  new Date(now + offsetMs).toISOString();
const scheduledAt = time(3 * 60 * 60 * 1000);

store.saveScheduledRound(
  {
    boardId,
    clubId: "na",
    screeningId,
    voteStartsAt: time(-60 * 60 * 1000),
    voteEndsAt: time(60 * 60 * 1000),
    resultsAt: time(2 * 60 * 60 * 1000),
    scheduledAt,
    displayUntil: time(4 * 60 * 60 * 1000),
    venue: "Wergelandshallen",
    published: true,
    metadata: buildScheduledFilmRoundMetadata(
      "na",
      screeningId,
      scheduledAt,
      "Wergelandshallen",
      [halloweenFilm.id],
    ),
  },
  null,
);

const testIdentitySecret = Buffer.alloc(32, 23);
const deviceCookie = (seed: number): Record<string, string> => ({
  [DEVICE_COOKIE_NAME]: createDeviceIdentity(
    testIdentitySecret,
    Buffer.alloc(32, seed),
  ).cookieValue,
});

interface RecordedResponse {
  body: unknown;
  statusCode: number;
}

const invoke = async ({
  body,
  board = boardId,
  cookies = deviceCookie(1),
  method,
}: {
  body?: unknown;
  board?: string;
  cookies?: Record<string, string>;
  method: string;
}): Promise<RecordedResponse> => {
  let responseBody: unknown;
  let statusCode = 200;
  const request = {
    body,
    cookies,
    headers: { "x-client-ip": "203.0.113.44" },
    method,
    query: { boardId: board },
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as NextApiRequest;
  const response = {
    json(payload: unknown) {
      responseBody = payload;
      return this;
    },
    setHeader() {
      return this;
    },
    status(nextStatusCode: number) {
      statusCode = nextStatusCode;
      return this;
    },
  } as unknown as NextApiResponse;

  await votesHandler(request, response);
  return { body: responseBody, statusCode };
};

after(async () => {
  store.close();
  await fs.rm(testDirectory, { force: true, recursive: true });
});

void test("scheduled Halloween voting is limited to its frozen candidate subset", async () => {
  const response = await invoke({
    body: { filmId: halloweenFilm.id },
    method: "POST",
  });

  assert.equal(response.statusCode, 200);
  const body = response.body as {
    ranking: Array<{ filmId: number; votes: number }>;
    votedFilmIds: number[];
  };
  assert.deepEqual(body.ranking, [{ filmId: halloweenFilm.id, votes: 1 }]);
  assert.deepEqual(body.votedFilmIds, [halloweenFilm.id]);

  const outsideSubset = await invoke({
    body: { filmId: outsideSeasonFilm.id },
    cookies: deviceCookie(2),
    method: "POST",
  });
  assert.equal(outsideSubset.statusCode, 400);
  assert.deepEqual(outsideSubset.body, {
    error: {
      code: "INVALID_REQUEST",
      message: "Filmen er ikke med i denne avstemningen.",
    },
  });
});

void test("the unmanaged legacy board rejects Halloween-only film ids", async () => {
  const response = await invoke({
    board: "na",
    body: { filmId: halloweenFilm.id },
    method: "POST",
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, {
    error: { code: "INVALID_REQUEST", message: "Ugyldig stemme." },
  });
  assert.equal(
    legacyFilmCatalogue.some((film) => film.id === halloweenFilm.id),
    false,
  );
});
