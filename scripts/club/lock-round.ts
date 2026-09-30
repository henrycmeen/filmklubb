import { stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

interface LockRoundCliArgs {
  clubProvided: boolean;
  clubSlug: string;
  commit: boolean;
  databasePath?: string;
  expectedRevision?: number;
  help: boolean;
  screeningId?: string;
  screeningProvided: boolean;
}

const usage = `Usage: node --import tsx scripts/club/lock-round.ts [options]

Preview the configured current round (read-only):
  --club <slug>                 Club slug (default: default)
  --screening <id>              Current screening id
  --expected-revision <number>  Expected vote revision to check
  --database <path>             Existing SQLite database to inspect

Close a round (all four flags are required):
  --club <slug> --screening <id> --expected-revision <number> --commit

Options:
  --help                        Show this help
`;

const parseIdentifier = (rawValue: string, optionName: string): string => {
  const value = rawValue.trim().toLowerCase();
  if (!value || value.length > 128 || !IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`Invalid ${optionName}.`);
  }
  return value;
};

const parseExpectedRevision = (rawValue: string): number => {
  if (!/^\d+$/.test(rawValue.trim())) {
    throw new Error("Invalid expected revision.");
  }

  const revision = Number(rawValue);
  if (!Number.isSafeInteger(revision)) {
    throw new Error("Invalid expected revision.");
  }
  return revision;
};

const readOptionValue = (
  argv: string[],
  index: number,
  optionName: string,
): string => {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${optionName} requires a value.`);
  }
  return value;
};

export const parseLockRoundArgs = (argv: string[]): LockRoundCliArgs => {
  let clubProvided = false;
  let clubSlug = "default";
  let commit = false;
  let databasePath: string | undefined;
  let expectedRevision: number | undefined;
  let help = false;
  let screeningId: string | undefined;
  let screeningProvided = false;

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    switch (option) {
      case "--club": {
        if (clubProvided) {
          throw new Error("--club may only be provided once.");
        }
        clubSlug = parseIdentifier(
          readOptionValue(argv, index, "--club"),
          "club",
        );
        clubProvided = true;
        index += 1;
        break;
      }
      case "--screening": {
        if (screeningProvided) {
          throw new Error("--screening may only be provided once.");
        }
        screeningId = parseIdentifier(
          readOptionValue(argv, index, "--screening"),
          "screening",
        );
        screeningProvided = true;
        index += 1;
        break;
      }
      case "--expected-revision": {
        if (expectedRevision !== undefined) {
          throw new Error("--expected-revision may only be provided once.");
        }
        expectedRevision = parseExpectedRevision(
          readOptionValue(argv, index, "--expected-revision"),
        );
        index += 1;
        break;
      }
      case "--database": {
        if (databasePath !== undefined) {
          throw new Error("--database may only be provided once.");
        }
        databasePath = readOptionValue(argv, index, "--database").trim();
        if (!databasePath) {
          throw new Error("--database requires a value.");
        }
        index += 1;
        break;
      }
      case "--commit":
        if (commit) {
          throw new Error("--commit may only be provided once.");
        }
        commit = true;
        break;
      case "--help":
      case "-h":
        help = true;
        break;
      default:
        throw new Error(`Unknown option: ${option ?? ""}`);
    }
  }

  return {
    clubProvided,
    clubSlug,
    commit,
    ...(databasePath ? { databasePath } : {}),
    ...(expectedRevision !== undefined ? { expectedRevision } : {}),
    help,
    ...(screeningId ? { screeningId } : {}),
    screeningProvided,
  };
};

const requireExistingDatabase = async (databasePath: string): Promise<void> => {
  let databaseStat;
  try {
    databaseStat = await stat(databasePath);
  } catch {
    throw new Error("The configured SQLite database does not exist.");
  }

  if (!databaseStat.isFile()) {
    throw new Error("The configured SQLite database is not a file.");
  }
};

const run = async (args: LockRoundCliArgs): Promise<unknown> => {
  if (
    args.commit &&
    (!args.clubProvided ||
      !args.screeningProvided ||
      args.expectedRevision === undefined)
  ) {
    throw new Error(
      "Closing a round requires --club, --screening, --expected-revision, and --commit.",
    );
  }

  const [
    storagePaths,
    filmRoundService,
    filmVotes,
    filmClubProgramme,
    filmRound,
  ] = await Promise.all([
    import("../../src/lib/storagePaths"),
    import("../../src/lib/filmRoundService"),
    import("../../src/lib/filmVotes"),
    import("../../src/lib/filmClubProgramme"),
    import("../../src/lib/filmRound"),
  ]);
  const clubId = filmClubProgramme.resolveCanonicalClubId(args.clubSlug);
  if (!filmRoundService.isConfiguredClub(clubId)) {
    throw new Error("The requested club is not configured.");
  }

  const currentRound = filmRoundService.getCurrentFilmRound(clubId);
  if (!currentRound) {
    throw new Error(
      "No legacy screening is configured. Manage scheduled rounds through admin.",
    );
  }
  const screeningId = args.screeningId ?? currentRound.screeningId;
  if (screeningId !== currentRound.screeningId) {
    throw new Error("Only the configured current screening can be locked.");
  }

  const metadata = filmRoundService.buildFilmRoundLockMetadata(
    clubId,
    screeningId,
  );
  const databasePath = path.resolve(
    args.databasePath ?? storagePaths.CLUB_SQLITE_PATH,
  );
  await requireExistingDatabase(databasePath);

  const store = filmVotes.createFilmVoteStore(databasePath, {
    readOnly: !args.commit,
  });
  try {
    const boardId = filmRoundService.getFilmRoundBoardId(clubId, screeningId);
    if (!args.commit) {
      const lockedRound = store.getLockedRound(boardId);
      if (lockedRound) {
        return {
          mode: "preview",
          status: "closed",
          boardId,
          expectedRevision: args.expectedRevision ?? lockedRound.revision,
          snapshotId: lockedRound.snapshotId,
          snapshotHash: lockedRound.snapshotHash,
          revision: lockedRound.revision,
        };
      }

      const currentResults = store.getResults(
        boardId,
        metadata.catalogue.map((film) => film.id),
        new Map(
          metadata.catalogue.map((film) => [film.id, film.tmdbVoteAverage]),
        ),
      );
      if (
        args.expectedRevision !== undefined &&
        args.expectedRevision !== currentResults.revision
      ) {
        throw new filmRound.FilmRoundRevisionConflictError(
          args.expectedRevision,
          currentResults.revision,
        );
      }

      return {
        mode: "preview",
        status: "open",
        boardId,
        expectedRevision: args.expectedRevision ?? currentResults.revision,
        revision: currentResults.revision,
        totalVotes: currentResults.totalVotes,
        participatingDevices: currentResults.participatingDevices,
        lastVoteAt: currentResults.lastVoteAt,
      };
    }

    const snapshot = store.lockRound(
      boardId,
      metadata,
      args.expectedRevision as number,
    );
    return { mode: "commit", status: "closed", boardId, snapshot };
  } finally {
    store.close();
  }
};

const main = async (): Promise<void> => {
  const args = parseLockRoundArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage);
    return;
  }

  const result = await run(args);
  console.log(JSON.stringify(result, null, 2));
};

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  void main().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Round lock failed.";
    console.error(message);
    process.exitCode = 1;
  });
}
