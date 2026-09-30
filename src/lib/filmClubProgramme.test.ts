import assert from "node:assert/strict";
import { test } from "node:test";
import {
  filmClubHistoryEntrySchema,
  filmClubProgrammeConfigSchema,
  getActiveVoteBoardId,
  getFilmClubProgramme,
  resolveCanonicalClubId,
} from "./filmClubProgramme";

const legacyProgramme = {
  name: "Legacy fixture",
  activeScreening: {
    id: "fixture-screening",
    scheduledAt: "2026-09-22T16:00:00+02:00",
  },
  history: [],
};

void test("accepts an empty club without a fabricated screening date", () => {
  const config = filmClubProgrammeConfigSchema.parse({
    clubs: { default: { name: "Filmklubben", history: [] } },
    aliases: {},
  });
  assert.equal(config.clubs.default!.activeScreening, null);
  assert.equal(
    filmClubProgrammeConfigSchema.safeParse({
      clubs: {
        default: { name: "Filmklubben", activeScreening: null, history: [] },
      },
      aliases: {},
    }).success,
    true,
  );
});

void test("preserves explicit legacy screening metadata and validates aliases", () => {
  const config = filmClubProgrammeConfigSchema.parse({
    clubs: { default: legacyProgramme, legacy: legacyProgramme },
    aliases: { existing: "legacy" },
  });
  assert.deepEqual(
    config.clubs.legacy!.activeScreening,
    legacyProgramme.activeScreening,
  );
  assert.equal(config.aliases.existing, "legacy");
  assert.equal(
    filmClubProgrammeConfigSchema.safeParse({
      clubs: { default: legacyProgramme },
      aliases: { missing: "unknown" },
    }).success,
    false,
  );
});

void test("fresh template and unknown namespaces have no legacy election", () => {
  assert.equal(getFilmClubProgramme("default").activeScreening, null);
  assert.equal(getActiveVoteBoardId("default"), null);
  assert.equal(resolveCanonicalClubId("guest-night"), "guest-night");
  assert.equal(getActiveVoteBoardId("guest-night"), null);
  assert.deepEqual(getFilmClubProgramme("guest-night").history, []);
});

void test("validates history entries used by the results view", () => {
  const historyEntry = filmClubHistoryEntrySchema.parse({
    screeningId: "2026-08-30",
    scheduledAt: "2026-08-30T19:00:00+02:00",
    winnerFilmId: 655,
    finalVoteCount: 6,
    totalVotes: 17,
    participatingDevices: 9,
  });

  assert.equal(historyEntry.screeningId, "2026-08-30");
  assert.equal(historyEntry.scheduledAt, "2026-08-30T19:00:00+02:00");
  assert.equal(historyEntry.winnerFilmId, 655);
  assert.equal(historyEntry.finalVoteCount, 6);
  assert.equal(historyEntry.totalVotes, 17);
  assert.equal(historyEntry.participatingDevices, 9);
  assert.equal(
    filmClubHistoryEntrySchema.safeParse({
      ...historyEntry,
      scheduledAt: "not-a-date",
    }).success,
    false,
  );
  assert.equal(
    filmClubHistoryEntrySchema.safeParse({
      ...historyEntry,
      winnerFilmId: 999_999_999,
    }).success,
    false,
  );
});
