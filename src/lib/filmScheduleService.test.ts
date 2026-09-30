import assert from "node:assert/strict";
import { test } from "node:test";
import { createFilmVoteStore } from "./filmVotes";
import { buildScheduledFilmRoundMetadata } from "./filmRoundService";
import {
  getPublicFilmRound,
  getPublicFilmHistory,
} from "./filmScheduleService";
import type { FilmScheduleInput } from "./filmSchedule";
import catalogue from "@/data/filmVoteCatalogue.json";

const filmId = catalogue[0]!.id;
function schedule(
  screeningId = "2026-09-22",
  published = true,
): FilmScheduleInput {
  const scheduledAt = "2026-09-22T16:00:00+02:00";
  return {
    boardId: `na-${screeningId}`,
    clubId: "na",
    screeningId,
    voteStartsAt: "2026-09-01T00:00:00+02:00",
    voteEndsAt: "2026-09-21T12:00:00+02:00",
    resultsAt: "2026-09-21T13:00:00+02:00",
    scheduledAt,
    displayUntil: "2026-09-22T23:59:00+02:00",
    venue: "Wergelandshallen",
    published,
    metadata: buildScheduledFilmRoundMetadata(
      "na",
      screeningId,
      scheduledAt,
      "Wergelandshallen",
      [filmId],
    ),
  };
}

void test("public lifecycle respects exact opening, deadline, release and history boundaries", () => {
  let now = new Date("2026-08-31T21:59:59Z");
  const store = createFilmVoteStore(":memory:", undefined, () => now);
  try {
    store.saveScheduledRound(schedule(), null);
    const read = () => getPublicFilmRound("NA", undefined, store, now);
    assert.equal(read()?.status, "scheduled");
    now = new Date("2026-08-31T22:00:00Z");
    assert.equal(read()?.status, "open");
    store.setVote("na-2026-09-22", filmId, "test-voter", true);
    now = new Date("2026-09-21T09:59:59Z");
    assert.equal(read()?.status, "open");
    now = new Date("2026-09-21T10:00:00Z");
    assert.deepEqual(read(), {
      status: "awaiting",
      boardId: "na-2026-09-22",
      resultsAt: "2026-09-21T13:00:00+02:00",
      scheduledAt: "2026-09-22T16:00:00+02:00",
    });
    assert.equal(
      getPublicFilmRound("na", "2026-09-22", store, now)?.status,
      "awaiting",
    );
    assert.throws(() =>
      store.setVote("na-2026-09-22", filmId, "late-voter", true),
    );
    const hash = store.getLockedRound("na-2026-09-22")!.snapshotHash;
    now = new Date("2026-09-21T11:00:00Z");
    assert.equal(read()?.status, "closed");
    assert.equal(getPublicFilmHistory("na", store, now).length, 0);
    now = new Date("2026-09-22T21:59:00Z");
    assert.equal(read()?.status, "idle");
    const history = getPublicFilmHistory("na", store, now);
    assert.equal(history.length, 1);
    assert.equal(history[0]!.snapshot.snapshotHash, hash);
    assert.equal(history[0]!.snapshot.stats.totalVotes, 1);
    assert.equal(
      getPublicFilmRound("na", "2026-09-22", store, now)?.status,
      "closed",
    );
  } finally {
    store.close();
  }
});

void test("fresh club remains idle for a draft and selects its first published schedule", () => {
  let now = new Date("2026-08-31T21:59:59Z");
  const store = createFilmVoteStore(":memory:", undefined, () => now);
  try {
    assert.deepEqual(getPublicFilmRound("default", undefined, store, now), {
      status: "idle",
    });
    const draft = schedule("first-round", false);
    draft.clubId = "default";
    draft.boardId = "default-first-round";
    draft.metadata = buildScheduledFilmRoundMetadata(
      draft.clubId,
      draft.screeningId,
      draft.scheduledAt,
      draft.venue,
      [filmId],
    );
    const saved = store.saveScheduledRound(draft, null);
    assert.deepEqual(getPublicFilmRound("default", undefined, store, now), {
      status: "idle",
    });
    assert.equal(
      getPublicFilmRound("default", "first-round", store, now),
      null,
    );
    assert.equal(getPublicFilmRound("default", "2026-09-22", store, now), null);
    store.saveScheduledRound({ ...draft, published: true }, saved.revision);
    assert.equal(
      getPublicFilmRound("default", undefined, store, now)?.status,
      "scheduled",
    );
    now = new Date("2026-08-31T22:00:00Z");
    assert.deepEqual(getPublicFilmRound("default", undefined, store, now), {
      status: "open",
      boardId: "default-first-round",
      scheduledAt: draft.scheduledAt,
      venue: draft.venue,
      candidateIds: [filmId],
    });
    store.setVote(draft.boardId, filmId, "first-voter", true);
    now = new Date("2026-09-21T10:00:00Z");
    assert.equal(
      getPublicFilmRound("default", undefined, store, now)?.status,
      "awaiting",
    );
    now = new Date("2026-09-21T11:00:00Z");
    assert.equal(
      getPublicFilmRound("default", undefined, store, now)?.status,
      "closed",
    );
    now = new Date("2026-09-22T21:59:00Z");
    assert.deepEqual(getPublicFilmRound("default", undefined, store, now), {
      status: "idle",
    });
    assert.equal(getPublicFilmHistory("default", store, now).length, 1);
  } finally {
    store.close();
  }
});

void test("manual close publishes immediately and preserves snapshot on retries", () => {
  const now = new Date("2026-09-21T09:00:00Z");
  const store = createFilmVoteStore(":memory:", undefined, () => now);
  try {
    const round = store.saveScheduledRound(schedule(), null);
    store.setVote(round.boardId, filmId, "existing-voter", true);
    const snapshot = store.closeScheduledRound(round.boardId, round.revision);
    assert.equal(
      getPublicFilmRound("na", undefined, store, now)?.status,
      "closed",
    );
    assert.equal(
      store.getScheduledRound(round.boardId)!.resultsAt,
      now.toISOString(),
    );
    assert.deepEqual(
      store.closeScheduledRound(round.boardId, round.revision),
      snapshot,
    );
  } finally {
    store.close();
  }
});
