import assert from "node:assert/strict";
import test from "node:test";
import { archiveWinner, otherScreenings } from "./filmArchive";
import type { FilmClubHistoryEntry } from "./filmRoundClient";

void test("empty and zero-vote archives never invent a winner", () => {
  const film = { id: 1, title: "PlayTime", year: 1967, coverImage: "" };
  assert.equal(archiveWinner([]), null);
  assert.equal(archiveWinner([{ film, votes: 0 }]), null);
  assert.equal(archiveWinner([{ film, votes: 13 }]), film);
});

void test("a direct historical result is not repeated in its archive shelf", () => {
  const entries = ["current", "older"].map((snapshotId) => ({
    snapshot: { snapshotId },
  })) as FilmClubHistoryEntry[];
  assert.deepEqual(otherScreenings(entries), entries);
  assert.deepEqual(otherScreenings(entries, "current"), [entries[1]]);
  assert.deepEqual(otherScreenings([entries[0]!], "current"), []);
});
