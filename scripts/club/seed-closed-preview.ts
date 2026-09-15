// Disposable local example only. Never opens the configured club database.
import { mkdir, access } from "node:fs/promises";
import path from "node:path";

if (process.env.NODE_ENV === "production") {
  throw new Error("This preview must not run in production.");
}
const databasePath = path.resolve(".cache/closed-preview/votes.sqlite");
try {
  await access(databasePath);
  throw new Error("Preview database already exists; refusing to overwrite it.");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
await mkdir(path.dirname(databasePath), { recursive: true });
process.env.CLUB_DB_PATH = databasePath;
const [
  { getFilmVoteStore },
  { buildFilmRoundLockMetadata, getCurrentFilmRound },
] = await Promise.all([
  import("../../src/lib/filmVotes"),
  import("../../src/lib/filmRoundService"),
]);
const store = getFilmVoteStore();
try {
  const { boardId } = getCurrentFilmRound("NA");
  const metadata = buildFilmRoundLockMetadata("NA");
  // Fictional votes, not a copy or a forecast of the live election.
  const samples = [
    ["PlayTime", 8],
    ["Anatomy of a Fall", 7],
    ["The Lighthouse", 5],
  ] as const;
  let revision = 0;
  for (const [title, count] of samples) {
    const film = metadata.catalogue.find((entry) => entry.title === title);
    if (!film) throw new Error(`Missing preview film: ${title}`);
    for (let voter = 0; voter < count; voter++) {
      store.setVote(boardId, film.id, `preview-voter-${voter}`, true);
      revision++;
    }
  }
  const snapshot = store.lockRound(boardId, metadata, revision);
  console.log(
    `LOCAL EXAMPLE ONLY: ${snapshot.stats.totalVotes} fictional votes; winner ${snapshot.winner?.film.title}.`,
  );
  console.log(`Start with CLUB_DB_PATH=${databasePath}`);
} finally {
  store.close();
}
