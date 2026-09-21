import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import {
  FilmRoundCandidateError,
  FilmRoundNotOpenError,
  FilmRoundScheduleConflictError,
  FilmRoundScheduleNotEditableError,
  FilmScheduleRevisionConflictError,
  createFilmVoteStore,
  type FilmVoteStore,
} from "./filmVotes";
import { FilmRoundClosedError, type FilmRoundLockMetadata } from "./filmRound";
import type { FilmScheduleInput } from "./filmSchedule";

const testDirectories: string[] = [];
const openStores: FilmVoteStore[] = [];

const createStore = async (clock: () => Date) => {
  const directory = await fs.mkdtemp(
    path.join(tmpdir(), "filmklubb-schedule-"),
  );
  testDirectories.push(directory);
  const store = createFilmVoteStore(
    path.join(directory, "votes.sqlite"),
    undefined,
    clock,
  );
  openStores.push(store);
  return { directory, store };
};

const metadataFor = (
  clubId = "default",
  screeningId = "september",
  scheduledAt = "2026-09-21T13:00:00Z",
): FilmRoundLockMetadata => {
  const films = [
    {
      id: 10,
      title: "Ten",
      year: 2000,
      coverImage: "/ten.webp",
      tmdbVoteAverage: 7.2,
    },
    {
      id: 20,
      title: "Twenty",
      year: 2001,
      coverImage: "/twenty.webp",
      tmdbVoteAverage: 8.4,
    },
  ];
  const ticketTemplates = Object.fromEntries(
    films.map((film, index) => [
      String(film.id),
      {
        film: {
          id: film.id,
          title: film.title,
          year: film.year,
          coverImage: film.coverImage,
        },
        image: `/image-${film.id}.jpg`,
        fallback: `/fallback-${film.id}.jpg`,
        palette: "ember",
        date: "2026-09-21",
        time: "15:00",
        venue: "Wergelandssalen",
        note: "ADGANG FOR ÉN",
        serial: String(index + 1).padStart(3, "0"),
      },
    ]),
  );
  return {
    clubId,
    screeningId,
    scheduledAt,
    catalogue: films,
    ticketTemplates,
  };
};

const inputFor = (
  overrides: Partial<FilmScheduleInput> = {},
): FilmScheduleInput => {
  const clubId = overrides.clubId ?? "default";
  const screeningId = overrides.screeningId ?? "september";
  const scheduledAt = overrides.scheduledAt ?? "2026-09-21T13:00:00Z";
  return {
    boardId: overrides.boardId ?? `${clubId}-${screeningId}`,
    clubId,
    screeningId,
    voteStartsAt: overrides.voteStartsAt ?? "2026-09-21T10:00:00Z",
    voteEndsAt: overrides.voteEndsAt ?? "2026-09-21T11:00:00Z",
    resultsAt: overrides.resultsAt ?? "2026-09-21T12:00:00Z",
    scheduledAt,
    displayUntil: overrides.displayUntil ?? "2026-09-22T23:59:00Z",
    venue: overrides.venue ?? "Wergelandssalen",
    published: overrides.published ?? true,
    metadata:
      overrides.metadata ?? metadataFor(clubId, screeningId, scheduledAt),
  };
};

afterEach(async () => {
  for (const store of openStores.splice(0)) {
    store.close();
  }
  await Promise.all(
    testDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { force: true, recursive: true })),
  );
});

void test("saves and reads a strict scheduled round with a stable board id", async () => {
  const { store } = await createStore(() => new Date("2026-09-21T09:00:00Z"));
  const saved = store.saveScheduledRound(inputFor(), null);

  assert.equal(saved.boardId, "default-september");
  assert.equal(saved.revision, 0);
  assert.equal(saved.completedAt, null);
  assert.deepEqual(store.getScheduledRound(saved.boardId), saved);
  assert.deepEqual(store.listScheduledRounds("default"), [saved]);
});

void test("requires the published voting window and the frozen candidate set", async () => {
  let now = new Date("2026-09-21T09:59:59.999Z");
  const { store } = await createStore(() => new Date(now));
  store.saveScheduledRound(inputFor(), null);

  assert.throws(
    () => store.recordVote("default-september", 10, "voter-a"),
    (error: unknown) =>
      error instanceof FilmRoundNotOpenError && error.code === "ROUND_NOT_OPEN",
  );

  now = new Date("2026-09-21T10:00:00Z");
  assert.throws(
    () => store.recordVote("default-september", 999, "voter-a"),
    (error: unknown) =>
      error instanceof FilmRoundCandidateError &&
      error.code === "CANDIDATE_NOT_IN_ROUND",
  );
  assert.equal(store.recordVote("default-september", 10, "voter-a"), true);
});

void test("closes exactly at the deadline and commits the snapshot before throwing", async () => {
  let now = new Date("2026-09-21T10:00:00Z");
  const { store } = await createStore(() => new Date(now));
  store.saveScheduledRound(inputFor(), null);
  store.recordVote("default-september", 10, "voter-a");

  now = new Date("2026-09-21T11:00:00Z");
  assert.throws(
    () => store.recordVote("default-september", 20, "voter-a"),
    (error: unknown) =>
      error instanceof FilmRoundClosedError && error.code === "ROUND_CLOSED",
  );
  const snapshot = store.getLockedRound("default-september");
  assert.ok(snapshot);
  assert.equal(snapshot?.winner?.film.id, 10);
  assert.equal(snapshot?.lockedAt, "2026-09-21T11:00:00.000Z");
  assert.equal(
    store.getScheduledRound("default-september")?.voteEndsAt,
    "2026-09-21T11:00:00Z",
  );
  assert.equal(store.getScheduledRound("default-september")?.revision, 1);
});

void test("automatic close survives a store restart without changing snapshot bytes", async () => {
  let now = new Date("2026-09-21T10:00:00Z");
  const { directory, store } = await createStore(() => new Date(now));
  store.saveScheduledRound(inputFor(), null);
  store.recordVote("default-september", 20, "voter-a");
  now = new Date("2026-09-21T11:00:00Z");
  const first = store.finalizeDueRounds("default", now)[0];
  assert.ok(first);
  const firstJson = JSON.stringify(store.getLockedRound("default-september"));
  store.close();
  openStores.splice(openStores.indexOf(store), 1);

  const restarted = createFilmVoteStore(
    path.join(directory, "votes.sqlite"),
    undefined,
    () => new Date(now),
  );
  openStores.push(restarted);
  assert.equal(
    JSON.stringify(restarted.getLockedRound("default-september")),
    firstJson,
  );
  assert.equal(restarted.finalizeDueRounds("default", now).length, 1);
  assert.equal(
    JSON.stringify(restarted.getLockedRound("default-september")),
    firstJson,
  );
});

void test("finalization marks a closed round completed at displayUntil without rewriting its snapshot", async () => {
  let now = new Date("2026-09-21T10:00:00Z");
  const { store } = await createStore(() => new Date(now));
  store.saveScheduledRound(inputFor(), null);
  store.recordVote("default-september", 10, "voter-a");
  const snapshot = store.finalizeDueRounds(
    "default",
    new Date("2026-09-21T11:00:00Z"),
  )[0];
  assert.ok(snapshot);
  const snapshotJson = JSON.stringify(
    store.getLockedRound("default-september"),
  );

  now = new Date("2026-09-22T23:59:00Z");
  store.finalizeDueRounds("default", now);
  const completed = store.getScheduledRound("default-september");
  assert.equal(completed?.completedAt, "2026-09-22T23:59:00.000Z");
  assert.equal(completed?.revision, 2);
  assert.equal(
    JSON.stringify(store.getLockedRound("default-september")),
    snapshotJson,
  );
  assert.deepEqual(store.finalizeDueRounds("default", now), [snapshot]);
});

void test("manual close lowers the deadline atomically, increments schedule revision, and is idempotent", async () => {
  const now = new Date("2026-09-21T10:20:00Z");
  const { store } = await createStore(() => new Date(now));
  store.saveScheduledRound(inputFor(), null);
  const first = store.closeScheduledRound("default-september", 0);
  const saved = store.getScheduledRound("default-september");
  assert.equal(saved?.voteEndsAt, "2026-09-21T10:20:00.000Z");
  assert.equal(saved?.resultsAt, "2026-09-21T10:20:00.000Z");
  assert.equal(saved?.revision, 1);
  assert.equal(
    store.closeScheduledRound("default-september", 0).snapshotHash,
    first.snapshotHash,
  );
  assert.deepEqual(store.getScheduledRound("default-september"), saved);
});

void test("rejects manual close exactly at opening without mutating the round", async () => {
  const now = new Date("2026-09-21T10:00:00Z");
  const { store } = await createStore(() => new Date(now));
  const saved = store.saveScheduledRound(inputFor(), null);

  assert.throws(
    () => store.closeScheduledRound(saved.boardId, saved.revision),
    (error: unknown) =>
      error instanceof FilmRoundNotOpenError &&
      error.code === "ROUND_NOT_OPEN",
  );
  assert.deepEqual(store.getScheduledRound(saved.boardId), saved);
  assert.equal(store.getLockedRound(saved.boardId), null);
});

void test("allows overlapping drafts but rejects publishing an overlapping display interval", async () => {
  const { store } = await createStore(() => new Date("2026-09-01T09:00:00Z"));
  store.saveScheduledRound(inputFor(), null);
  const draft = inputFor({
    screeningId: "october",
    scheduledAt: "2026-09-21T14:00:00Z",
    published: false,
    metadata: metadataFor("default", "october", "2026-09-21T14:00:00Z"),
  });
  store.saveScheduledRound(draft, null);
  assert.throws(
    () => store.saveScheduledRound({ ...draft, published: true }, 0),
    (error: unknown) =>
      error instanceof FilmRoundScheduleConflictError &&
      error.code === "ROUND_SCHEDULE_CONFLICT",
  );
});

void test("uses schedule CAS and freezes candidate metadata once voting starts", async () => {
  let now = new Date("2026-09-21T09:00:00Z");
  const { store } = await createStore(() => new Date(now));
  const first = store.saveScheduledRound(inputFor(), null);
  assert.throws(
    () => store.saveScheduledRound({ ...inputFor(), venue: "Other" }, 99),
    (error: unknown) =>
      error instanceof FilmScheduleRevisionConflictError &&
      error.code === "REVISION_CONFLICT",
  );

  now = new Date("2026-09-21T10:00:00Z");
  store.recordVote("default-september", 10, "voter-a");
  const changed: FilmScheduleInput = {
    ...inputFor(),
    venue: "Other",
    metadata: {
      ...metadataFor("default", "september", "2026-09-21T13:00:00Z"),
      catalogue: [
        {
          ...metadataFor("default", "september", "2026-09-21T13:00:00Z")
            .catalogue[0]!,
          title: "Changed after voting started",
        },
        ...metadataFor(
          "default",
          "september",
          "2026-09-21T13:00:00Z",
        ).catalogue.slice(1),
      ],
    },
  };
  assert.throws(
    () => store.saveScheduledRound(changed, first.revision),
    (error: unknown) =>
      error instanceof FilmRoundScheduleNotEditableError &&
      error.code === "ROUND_NOT_EDITABLE",
  );
});

void test("bootstraps a legacy locked board without rewriting its snapshot", async () => {
  const now = new Date("2026-09-21T09:00:00Z");
  const { store } = await createStore(() => new Date(now));
  const metadata = metadataFor();
  store.recordVote("default-september", 10, "voter-a");
  const snapshot = store.lockRound("default-september", metadata, 1);
  const input = inputFor({ metadata });
  const scheduled = store.saveScheduledRound(input, null);
  assert.equal(scheduled.revision, 0);
  assert.equal(
    store.getLockedRound("default-september")?.snapshotHash,
    snapshot.snapshotHash,
  );
});

void test("completion requires an immutable close and the screening time", async () => {
  let now = new Date("2026-09-21T10:20:00Z");
  const { store } = await createStore(() => new Date(now));
  store.saveScheduledRound(inputFor(), null);
  store.closeScheduledRound("default-september", 0);
  assert.throws(
    () => store.completeScheduledRound("default-september", 1),
    (error: unknown) =>
      error instanceof FilmRoundNotOpenError && error.code === "ROUND_NOT_OPEN",
  );
  now = new Date("2026-09-21T13:00:00Z");
  const completed = store.completeScheduledRound("default-september", 1);
  assert.equal(completed.completedAt, "2026-09-21T13:00:00.000Z");
  assert.equal(completed.revision, 2);
  assert.deepEqual(
    store.completeScheduledRound("default-september", 0),
    completed,
  );
});
