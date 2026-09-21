// Explicitly adopts only the disposable 20-vote local fixture. No production path.
import path from "node:path";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";

if (process.env.NODE_ENV === "production")
  throw new Error("Local preview only.");
const databasePath = path.resolve(".cache/closed-preview/votes.sqlite");
process.env.CLUB_DB_PATH = databasePath;
const db = new DatabaseSync(databasePath, { readOnly: true });
const votes = db
  .prepare(
    "SELECT board_id,film_id,voter_key,created_at FROM film_votes ORDER BY vote_id",
  )
  .all();
assert.equal(
  votes.length,
  20,
  "Only the fictional closed-preview fixture may be adopted.",
);
assert.ok(
  votes.every(
    (row) =>
      row.board_id === "na-2026-09-22" &&
      String(row.voter_key).startsWith("preview-voter-"),
  ),
);
const original = db
  .prepare(
    "SELECT snapshot_json FROM film_vote_round_snapshots WHERE board_id = ?",
  )
  .get("na-2026-09-22") as { snapshot_json: string };
assert.ok(original);
db.close();
const [{ getFilmVoteStore }, { buildFilmRoundLockMetadata }] =
  await Promise.all([
    import("../../src/lib/filmVotes"),
    import("../../src/lib/filmRoundService"),
  ]);
const store = getFilmVoteStore();
try {
  const snapshot = store.getLockedRound("na-2026-09-22")!;
  if (!store.getScheduledRound(snapshot.boardId)) {
    const backup = path.resolve(".cache/closed-preview/before-schedule.json");
    writeFileSync(
      backup,
      JSON.stringify({
        votes,
        snapshot: JSON.parse(original.snapshot_json) as unknown,
      }),
      { flag: "wx", mode: 0o600 },
    );
    store.saveScheduledRound(
      {
        boardId: snapshot.boardId,
        clubId: "na",
        screeningId: snapshot.screeningId,
        voteStartsAt: "2026-09-01T00:00:00+02:00",
        voteEndsAt: snapshot.lockedAt,
        resultsAt: snapshot.lockedAt,
        scheduledAt: snapshot.scheduledAt,
        displayUntil: "2026-09-22T23:59:00+02:00",
        published: true,
        venue: snapshot.ticket?.venue ?? "Wergelandshallen",
        metadata: buildFilmRoundLockMetadata("na"),
      },
      null,
    );
  }
  const verify = new DatabaseSync(databasePath, { readOnly: true });
  assert.deepEqual(
    verify
      .prepare(
        "SELECT board_id,film_id,voter_key,created_at FROM film_votes ORDER BY vote_id",
      )
      .all(),
    votes,
  );
  assert.equal(
    (
      verify
        .prepare(
          "SELECT snapshot_json FROM film_vote_round_snapshots WHERE board_id = ?",
        )
        .get(snapshot.boardId) as { snapshot_json: string }
    ).snapshot_json,
    original.snapshot_json,
  );
  verify.close();
  console.log(
    "Local September schedule saved. All 20 fictional votes and snapshot bytes unchanged. No October dates invented.",
  );
} finally {
  store.close();
}
