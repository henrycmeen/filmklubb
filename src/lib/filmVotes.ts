import { DatabaseSync } from "node:sqlite";
import { selectRoundCandidates } from "./filmRoundCandidates";
import { createHash } from "node:crypto";
import { CLUB_SQLITE_PATH } from "@/lib/storagePaths";
import {
  FILM_ROUND_ALGORITHM_VERSION,
  FilmRoundClosedError,
  FilmRoundRevisionConflictError,
  filmRoundLockMetadataSchema,
  filmRoundSnapshotSchema,
  freezeFilmRoundSnapshot,
  type FilmRoundLockMetadata,
  type FilmRoundSnapshot,
} from "@/lib/filmRound";
import {
  filmScheduleInputSchema,
  scheduledFilmRoundSchema,
  type FilmScheduleInput,
  type ScheduledFilmRound,
} from "@/lib/filmSchedule";

export interface FilmVoteRankingEntry {
  filmId: number;
  votes: number;
}

export interface FilmVoteSnapshot {
  boardId: string;
  ranking: FilmVoteRankingEntry[];
  revision: number;
  votedFilmIds: number[];
}

export interface FilmVoteResults {
  boardId: string;
  lastVoteAt: string | null;
  participatingDevices: number;
  ranking: FilmVoteRankingEntry[];
  revision: number;
  totalVotes: number;
}

interface VoteCountRow {
  film_id: number;
  first_vote_order: number;
  votes: number;
}

interface VoteRevisionRow {
  revision: number;
}

interface VotedFilmRow {
  film_id: number;
}

interface VoteFilmIdRow {
  film_id: number;
}

interface VoteStatsRow {
  last_vote_at: string | null;
  participating_devices: number;
  total_votes: number;
}

interface FilmVoteRoundSnapshotRow {
  board_id: string;
  club_id: string;
  screening_id: string;
  scheduled_at: string;
  locked_at: string;
  snapshot_id: string;
  snapshot_hash: string;
  algorithm_version: string;
  revision: number;
  snapshot_json: string;
}

interface FilmScheduleRow {
  board_id: string;
  club_id: string;
  screening_id: string;
  vote_starts_at: string;
  vote_ends_at: string;
  results_at: string;
  scheduled_at: string;
  display_until: string;
  venue: string;
  published: number;
  completed_at: string | null;
  revision: number;
  metadata_json: string;
}

export class FilmScheduleError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FilmScheduleError";
  }
}

export class FilmRoundNotOpenError extends FilmScheduleError {
  constructor(message = "Votes are accepted only while the round is open.") {
    super("ROUND_NOT_OPEN", message);
    this.name = "FilmRoundNotOpenError";
  }
}

export class FilmRoundCandidateError extends FilmScheduleError {
  constructor() {
    super(
      "CANDIDATE_NOT_IN_ROUND",
      "The film is not part of this voting round.",
    );
    this.name = "FilmRoundCandidateError";
  }
}

export class FilmRoundScheduleConflictError extends FilmScheduleError {
  constructor() {
    super(
      "ROUND_SCHEDULE_CONFLICT",
      "Published film rounds may not overlap their display intervals.",
    );
    this.name = "FilmRoundScheduleConflictError";
  }
}

export class FilmRoundScheduleNotEditableError extends FilmScheduleError {
  constructor(
    message = "This film round's frozen configuration cannot change.",
  ) {
    super("ROUND_NOT_EDITABLE", message);
    this.name = "FilmRoundScheduleNotEditableError";
  }
}

export class FilmScheduleRevisionConflictError extends FilmScheduleError {
  constructor(
    readonly expectedRevision: number | null,
    readonly actualRevision: number,
  ) {
    super("REVISION_CONFLICT", "The film schedule revision has changed.");
    this.name = "FilmScheduleRevisionConflictError";
  }
}

export interface FilmVoteStore {
  close(): void;
  getLockedRound(boardId: string): FilmRoundSnapshot | null;
  getRoundSnapshot(boardId: string): FilmRoundSnapshot | null;
  getSnapshot(
    boardId: string,
    voterKey: string,
    catalogueFilmIds: number[],
    tieBreakScores?: ReadonlyMap<number, number>,
  ): FilmVoteSnapshot;
  getResults(
    boardId: string,
    catalogueFilmIds: number[],
    tieBreakScores?: ReadonlyMap<number, number>,
  ): FilmVoteResults;
  listScheduledRounds(clubId: string): ScheduledFilmRound[];
  getScheduledRound(boardId: string): ScheduledFilmRound | null;
  saveScheduledRound(
    input: FilmScheduleInput,
    expectedRevision: number | null,
  ): ScheduledFilmRound;
  finalizeDueRounds(clubId: string, now?: Date): FilmRoundSnapshot[];
  closeScheduledRound(
    boardId: string,
    expectedRevision?: number,
  ): FilmRoundSnapshot;
  completeScheduledRound(
    boardId: string,
    expectedRevision?: number,
  ): ScheduledFilmRound;
  lockRound(
    boardId: string,
    metadata: FilmRoundLockMetadata,
    expectedRevision: number,
  ): FilmRoundSnapshot;
  recordVote(boardId: string, filmId: number, voterKey: string): boolean;
  setVote(
    boardId: string,
    filmId: number,
    voterKey: string,
    hasVoted: boolean,
  ): boolean;
}

const initializeDatabase = (database: DatabaseSync): void => {
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = NORMAL");
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec("PRAGMA foreign_keys = ON");

  database.exec(`
    CREATE TABLE IF NOT EXISTS film_vote_boards (
      board_id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS film_votes (
      vote_id INTEGER PRIMARY KEY AUTOINCREMENT,
      board_id TEXT NOT NULL,
      film_id INTEGER NOT NULL,
      voter_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (board_id, film_id, voter_key)
    );

    CREATE INDEX IF NOT EXISTS film_votes_board_film_idx
      ON film_votes (board_id, film_id);

    CREATE INDEX IF NOT EXISTS film_votes_board_voter_idx
      ON film_votes (board_id, voter_key);

    CREATE TABLE IF NOT EXISTS film_vote_round_snapshots (
      board_id TEXT PRIMARY KEY,
      club_id TEXT NOT NULL,
      screening_id TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      locked_at TEXT NOT NULL,
      snapshot_id TEXT NOT NULL UNIQUE,
      snapshot_hash TEXT NOT NULL,
      algorithm_version TEXT NOT NULL,
      revision INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS film_vote_round_snapshots_screening_idx
      ON film_vote_round_snapshots (club_id, screening_id);

    CREATE TABLE IF NOT EXISTS film_rounds (
      board_id TEXT PRIMARY KEY,
      club_id TEXT NOT NULL,
      screening_id TEXT NOT NULL,
      vote_starts_at TEXT NOT NULL,
      vote_ends_at TEXT NOT NULL,
      results_at TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      display_until TEXT NOT NULL,
      venue TEXT NOT NULL,
      published INTEGER NOT NULL CHECK (published IN (0, 1)),
      completed_at TEXT,
      revision INTEGER NOT NULL,
      metadata_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS film_rounds_club_schedule_idx
      ON film_rounds (club_id, vote_starts_at, board_id);
  `);
};

const runInTransaction = <T>(database: DatabaseSync, operation: () => T): T => {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
};

const runInReadTransaction = <T>(
  database: DatabaseSync,
  operation: () => T,
): T => {
  database.exec("BEGIN");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
};

type FilmRoundSnapshotHashSource = Omit<
  FilmRoundSnapshot,
  "snapshotId" | "snapshotHash"
>;

const getFilmRoundSnapshotHash = (
  snapshot: FilmRoundSnapshotHashSource,
): string => {
  const hashInput = {
    boardId: snapshot.boardId,
    clubId: snapshot.clubId,
    screeningId: snapshot.screeningId,
    scheduledAt: snapshot.scheduledAt,
    lockedAt: snapshot.lockedAt,
    snapshotId: "",
    snapshotHash: "",
    algorithmVersion: snapshot.algorithmVersion,
    revision: snapshot.revision,
    ranking: snapshot.ranking,
    winner: snapshot.winner,
    stats: snapshot.stats,
    ticket: snapshot.ticket,
  };

  return createHash("sha256").update(JSON.stringify(hashInput)).digest("hex");
};

export interface FilmVoteStoreOptions {
  readOnly?: boolean;
}

export const createFilmVoteStore = (
  databasePath: string,
  options?: FilmVoteStoreOptions,
  clock: () => Date = () => new Date(),
): FilmVoteStore => {
  const readOnly = options?.readOnly ?? false;
  const database = new DatabaseSync(databasePath, { readOnly });
  if (!readOnly) {
    initializeDatabase(database);
  }

  const getRevision = (boardId: string): number => {
    const row = database
      .prepare(
        `SELECT revision
         FROM film_vote_boards
         WHERE board_id = ?`,
      )
      .get(boardId) as VoteRevisionRow | undefined;

    return row?.revision ?? 0;
  };

  const getRanking = (
    boardId: string,
    catalogueFilmIds: number[],
    tieBreakScores?: ReadonlyMap<number, number>,
  ): FilmVoteRankingEntry[] => {
    const countRows = database
      .prepare(
        `SELECT
           film_id,
           COUNT(*) AS votes,
           MIN(vote_id) AS first_vote_order
         FROM film_votes
         WHERE board_id = ?
         GROUP BY film_id`,
      )
      .all(boardId) as unknown as VoteCountRow[];

    const countsByFilmId = new Map(
      countRows.map((row) => [
        row.film_id,
        { firstVoteOrder: row.first_vote_order, votes: row.votes },
      ]),
    );

    return Array.from(new Set(catalogueFilmIds))
      .map((filmId, initialRank) => {
        const count = countsByFilmId.get(filmId);
        return {
          filmId,
          firstVoteOrder: count?.firstVoteOrder ?? Number.MAX_SAFE_INTEGER,
          initialRank,
          votes: count?.votes ?? 0,
        };
      })
      .sort((first, second) => {
        const voteDifference = second.votes - first.votes;
        if (voteDifference !== 0) {
          return voteDifference;
        }

        if (first.votes > 0 && tieBreakScores) {
          const firstScore = tieBreakScores.get(first.filmId);
          const secondScore = tieBreakScores.get(second.filmId);
          if (firstScore !== undefined || secondScore !== undefined) {
            const scoreDifference =
              (secondScore ?? Number.NEGATIVE_INFINITY) -
              (firstScore ?? Number.NEGATIVE_INFINITY);
            if (scoreDifference !== 0) {
              return scoreDifference;
            }
          }
        }

        return (
          first.firstVoteOrder - second.firstVoteOrder ||
          first.initialRank - second.initialRank
        );
      })
      .map(({ filmId, votes }) => ({ filmId, votes }));
  };

  const getStoredRoundSnapshot = (
    boardId: string,
  ): FilmRoundSnapshot | null => {
    const row = database
      .prepare(
        `SELECT
           board_id,
           club_id,
           screening_id,
           scheduled_at,
           locked_at,
           snapshot_id,
           snapshot_hash,
           algorithm_version,
           revision,
           snapshot_json
         FROM film_vote_round_snapshots
         WHERE board_id = ?`,
      )
      .get(boardId) as FilmVoteRoundSnapshotRow | undefined;

    if (!row) {
      return null;
    }

    const snapshot = filmRoundSnapshotSchema.parse(
      JSON.parse(row.snapshot_json) as unknown,
    );
    if (
      snapshot.boardId !== row.board_id ||
      snapshot.clubId !== row.club_id ||
      snapshot.screeningId !== row.screening_id ||
      snapshot.scheduledAt !== row.scheduled_at ||
      snapshot.lockedAt !== row.locked_at ||
      snapshot.snapshotId !== row.snapshot_id ||
      snapshot.snapshotHash !== row.snapshot_hash ||
      snapshot.algorithmVersion !== row.algorithm_version ||
      snapshot.revision !== row.revision ||
      getFilmRoundSnapshotHash(snapshot) !== snapshot.snapshotHash ||
      snapshot.snapshotId !== `snapshot-${snapshot.snapshotHash.slice(0, 24)}`
    ) {
      throw new Error("Stored film round snapshot metadata is inconsistent.");
    }

    return freezeFilmRoundSnapshot(snapshot);
  };

  const isRoundClosed = (boardId: string): boolean =>
    Boolean(
      database
        .prepare(
          `SELECT snapshot_id
           FROM film_vote_round_snapshots
           WHERE board_id = ?`,
        )
        .get(boardId),
    );

  const getScheduleRow = (boardId: string): FilmScheduleRow | undefined =>
    database
      .prepare(
        `SELECT
           board_id,
           club_id,
           screening_id,
           vote_starts_at,
           vote_ends_at,
           results_at,
           scheduled_at,
           display_until,
           venue,
           published,
           completed_at,
           revision,
           metadata_json
         FROM film_rounds
         WHERE board_id = ?`,
      )
      .get(boardId) as FilmScheduleRow | undefined;

  const sameInstant = (first: string, second: string): boolean =>
    Date.parse(first) === Date.parse(second);

  const parseScheduleRow = (row: FilmScheduleRow): ScheduledFilmRound => {
    const metadata = filmRoundLockMetadataSchema.parse(
      JSON.parse(row.metadata_json) as unknown,
    );
    const round = scheduledFilmRoundSchema.parse({
      boardId: row.board_id,
      clubId: row.club_id,
      screeningId: row.screening_id,
      voteStartsAt: row.vote_starts_at,
      voteEndsAt: row.vote_ends_at,
      resultsAt: row.results_at,
      scheduledAt: row.scheduled_at,
      displayUntil: row.display_until,
      venue: row.venue,
      published: row.published === 1,
      completedAt: row.completed_at,
      revision: row.revision,
      metadata: { ...metadata, scheduledAt: row.scheduled_at },
    });
    if (
      round.boardId !== `${round.clubId}-${round.screeningId}` ||
      round.metadata.clubId !== round.clubId ||
      round.metadata.screeningId !== round.screeningId ||
      !sameInstant(round.metadata.scheduledAt, round.scheduledAt)
    ) {
      throw new Error("Stored film schedule metadata is inconsistent.");
    }
    return round;
  };

  const getStoredScheduledRound = (
    boardId: string,
  ): ScheduledFilmRound | null => {
    const row = getScheduleRow(boardId);
    return row ? parseScheduleRow(row) : null;
  };

  const getScheduleNow = (): Date => {
    const now = clock();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
      throw new Error("The film schedule clock must return a valid Date.");
    }
    return new Date(now.getTime());
  };

  const getScheduleNowIso = (): string => getScheduleNow().toISOString();

  const canonicalJson = (value: unknown): string => {
    if (Array.isArray(value)) {
      return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
    }
    if (value && typeof value === "object") {
      return `{${Object.entries(value as Record<string, unknown>)
        .sort(([first], [second]) => first.localeCompare(second))
        .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
        .join(",")}}`;
    }
    return JSON.stringify(value);
  };

  const sameMetadata = (
    first: FilmRoundLockMetadata,
    second: FilmRoundLockMetadata,
  ): boolean => canonicalJson(first) === canonicalJson(second);

  const assertBoardIdentity = (input: FilmScheduleInput): void => {
    if (input.boardId !== `${input.clubId}-${input.screeningId}`) {
      throw new Error(
        "The voting board must match the round club and screening.",
      );
    }
    if (
      input.metadata.clubId !== input.clubId ||
      input.metadata.screeningId !== input.screeningId ||
      !sameInstant(input.metadata.scheduledAt, input.scheduledAt)
    ) {
      throw new Error(
        "The schedule metadata must match its club, screening, and scheduled time.",
      );
    }
  };

  const assertNoPublishedScheduleOverlap = (input: FilmScheduleInput): void => {
    if (!input.published) return;
    const inputStartsAt = Date.parse(input.voteStartsAt);
    const inputDisplayUntil = Date.parse(input.displayUntil);
    const rows = database
      .prepare(
        `SELECT
           board_id,
           vote_starts_at,
           display_until
         FROM film_rounds
         WHERE club_id = ? AND published = 1 AND board_id <> ?`,
      )
      .all(input.clubId, input.boardId) as unknown as Array<{
      board_id: string;
      vote_starts_at: string;
      display_until: string;
    }>;

    const overlaps = rows.some((row) => {
      const startsAt = Date.parse(row.vote_starts_at);
      const displayUntil = Date.parse(row.display_until);
      return startsAt < inputDisplayUntil && inputStartsAt < displayUntil;
    });
    if (overlaps) {
      throw new FilmRoundScheduleConflictError();
    }
  };

  const assertMetadataMatchesSnapshot = (
    metadata: FilmRoundLockMetadata,
    snapshot: FilmRoundSnapshot,
  ): void => {
    if (
      metadata.clubId !== snapshot.clubId ||
      metadata.screeningId !== snapshot.screeningId ||
      !sameInstant(metadata.scheduledAt, snapshot.scheduledAt) ||
      (metadata.algorithmVersion !== undefined &&
        metadata.algorithmVersion !== snapshot.algorithmVersion)
    ) {
      throw new FilmRoundScheduleNotEditableError(
        "The schedule metadata does not match the existing round snapshot.",
      );
    }

    const filmsById = new Map(
      metadata.catalogue.map((film) => [film.id, film]),
    );
    if (filmsById.size !== snapshot.ranking.length) {
      throw new FilmRoundScheduleNotEditableError(
        "The schedule catalogue does not match the existing round snapshot.",
      );
    }
    for (const entry of snapshot.ranking) {
      const film = filmsById.get(entry.film.id);
      if (
        !film ||
        film.title !== entry.film.title ||
        film.year !== entry.film.year ||
        film.coverImage !== entry.film.coverImage ||
        (entry.tmdbVoteAverage !== undefined &&
          film.tmdbVoteAverage !== entry.tmdbVoteAverage)
      ) {
        throw new FilmRoundScheduleNotEditableError(
          "The schedule catalogue does not match the existing round snapshot.",
        );
      }
    }

    if (snapshot.ticket) {
      const ticket = metadata.ticketTemplates[String(snapshot.ticket.film.id)];
      if (!ticket || canonicalJson(ticket) !== canonicalJson(snapshot.ticket)) {
        throw new FilmRoundScheduleNotEditableError(
          "The winning ticket metadata does not match the existing round snapshot.",
        );
      }
    }
  };

  const assertLegacyVotesFitMetadata = (
    boardId: string,
    metadata: FilmRoundLockMetadata,
  ): void => {
    const catalogueFilmIds = new Set(metadata.catalogue.map((film) => film.id));
    const unlistedVote = (
      database
        .prepare(
          `SELECT DISTINCT film_id
           FROM film_votes
           WHERE board_id = ?`,
        )
        .all(boardId) as unknown as VoteFilmIdRow[]
    ).find((row) => !catalogueFilmIds.has(row.film_id));
    if (unlistedVote) {
      throw new FilmRoundScheduleNotEditableError(
        "En av filmene du prøver å fjerne har stemmer. Behold filmer med stemmer og prøv igjen.",
      );
    }
  };

  const scheduleRevisionConflict = (
    expectedRevision: number | null,
    actualRevision: number,
  ): never => {
    throw new FilmScheduleRevisionConflictError(
      expectedRevision,
      actualRevision,
    );
  };

  const setVoteInTransaction = (
    boardId: string,
    filmId: number,
    voterKey: string,
    hasVoted: boolean,
  ): boolean | "closed" => {
    const scheduledRound = getStoredScheduledRound(boardId);
    let voteNowIso: string | null = null;
    if (scheduledRound) {
      if (isRoundClosed(boardId)) {
        return "closed";
      }

      const now = getScheduleNow();
      voteNowIso = now.toISOString();
      const nowMs = now.getTime();
      const startsAt = Date.parse(scheduledRound.voteStartsAt);
      const endsAt = Date.parse(scheduledRound.voteEndsAt);
      if (!scheduledRound.published || nowMs < startsAt) {
        throw new FilmRoundNotOpenError();
      }
      if (nowMs >= endsAt) {
        const metadata = scheduledRound.metadata;
        lockScheduledRoundInTransaction(boardId, metadata, now, false);
        return "closed";
      }

      if (
        !scheduledRound.metadata.catalogue.some((film) => film.id === filmId)
      ) {
        throw new FilmRoundCandidateError();
      }
    } else if (isRoundClosed(boardId)) {
      throw new FilmRoundClosedError();
    }

    const updatedAt = voteNowIso ?? getScheduleNowIso();
    const result = hasVoted
      ? database
          .prepare(
            `INSERT OR IGNORE INTO film_votes (
               board_id,
               film_id,
               voter_key,
               created_at
             ) VALUES (?, ?, ?, ?)`,
          )
          .run(boardId, filmId, voterKey, updatedAt)
      : database
          .prepare(
            `DELETE FROM film_votes
             WHERE board_id = ? AND film_id = ? AND voter_key = ?`,
          )
          .run(boardId, filmId, voterKey);

    if (result.changes === 0) {
      return false;
    }

    database
      .prepare(
        `INSERT INTO film_vote_boards (board_id, revision, updated_at)
         VALUES (?, 1, ?)
         ON CONFLICT(board_id) DO UPDATE SET
           revision = film_vote_boards.revision + 1,
           updated_at = excluded.updated_at`,
      )
      .run(boardId, updatedAt);

    return true;
  };

  const setVote = (
    boardId: string,
    filmId: number,
    voterKey: string,
    hasVoted: boolean,
  ): boolean => {
    const result = runInTransaction(database, () =>
      setVoteInTransaction(boardId, filmId, voterKey, hasVoted),
    );
    if (result === "closed") {
      throw new FilmRoundClosedError();
    }
    return result;
  };

  const lockRoundInTransaction = (
    boardId: string,
    rawMetadata: FilmRoundLockMetadata,
    lockAt: Date = getScheduleNow(),
  ): FilmRoundSnapshot => {
    const metadata = filmRoundLockMetadataSchema.parse(rawMetadata);
    if (boardId !== `${metadata.clubId}-${metadata.screeningId}`) {
      throw new Error(
        "The voting board must match the round club and screening.",
      );
    }

    const scheduledRound = getStoredScheduledRound(boardId);
    if (scheduledRound && !sameMetadata(metadata, scheduledRound.metadata)) {
      throw new FilmRoundScheduleNotEditableError(
        "The schedule metadata is frozen for this voting round.",
      );
    }

    const existing = getStoredRoundSnapshot(boardId);
    if (existing) {
      return existing;
    }

    const currentRevision = getRevision(boardId);
    const catalogueFilmIds = metadata.catalogue.map((film) => film.id);
    const tieBreakScores = new Map(
      metadata.catalogue.map((film) => [film.id, film.tmdbVoteAverage]),
    );
    const catalogueFilmIdSet = new Set(catalogueFilmIds);
    const unlistedVote = (
      database
        .prepare(
          `SELECT DISTINCT film_id
           FROM film_votes
           WHERE board_id = ?`,
        )
        .all(boardId) as unknown as VoteFilmIdRow[]
    ).find((row) => !catalogueFilmIdSet.has(row.film_id));
    if (unlistedVote) {
      throw new Error(
        "The voting round contains a film outside its catalogue.",
      );
    }
    const ranking = getRanking(boardId, catalogueFilmIds, tieBreakScores);
    const filmsById = new Map(
      metadata.catalogue.map((film) => [film.id, film]),
    );
    const snapshotRanking = ranking.flatMap((entry) => {
      const film = filmsById.get(entry.filmId);
      return film
        ? [
            {
              film: {
                id: film.id,
                title: film.title,
                year: film.year,
                coverImage: film.coverImage,
              },
              tmdbVoteAverage: film.tmdbVoteAverage,
              votes: entry.votes,
            },
          ]
        : [];
    });
    const winner = snapshotRanking.find((entry) => entry.votes > 0) ?? null;
    const stats = database
      .prepare(
        `SELECT
           COUNT(*) AS total_votes,
           COUNT(DISTINCT voter_key) AS participating_devices,
           MAX(created_at) AS last_vote_at
         FROM film_votes
         WHERE board_id = ?`,
      )
      .get(boardId) as unknown as VoteStatsRow;

    const lockedAt = lockAt.toISOString();
    const algorithmVersion =
      metadata.algorithmVersion ?? FILM_ROUND_ALGORITHM_VERSION;
    const ticket = winner
      ? (metadata.ticketTemplates[String(winner.film.id)] ?? null)
      : null;
    if (
      winner &&
      (!ticket ||
        ticket.film.id !== winner.film.id ||
        ticket.film.title !== winner.film.title ||
        ticket.film.year !== winner.film.year ||
        ticket.film.coverImage !== winner.film.coverImage)
    ) {
      throw new Error("The winning film is missing its ticket template.");
    }
    const seed: FilmRoundSnapshotHashSource = {
      boardId,
      clubId: metadata.clubId,
      screeningId: metadata.screeningId,
      scheduledAt: metadata.scheduledAt,
      lockedAt,
      algorithmVersion,
      revision: currentRevision,
      ranking: snapshotRanking,
      winner,
      stats: {
        totalVotes: stats.total_votes,
        participatingDevices: stats.participating_devices,
        lastVoteAt: stats.last_vote_at,
      },
      ticket,
    };
    const snapshotHash = getFilmRoundSnapshotHash(seed);
    const snapshot = filmRoundSnapshotSchema.parse({
      ...seed,
      snapshotId: `snapshot-${snapshotHash.slice(0, 24)}`,
      snapshotHash,
    });
    const snapshotJson = JSON.stringify(snapshot);
    const persistedSnapshot = filmRoundSnapshotSchema.parse(
      JSON.parse(snapshotJson) as unknown,
    );

    database
      .prepare(
        `INSERT INTO film_vote_round_snapshots (
           board_id,
           club_id,
           screening_id,
           scheduled_at,
           locked_at,
           snapshot_id,
           snapshot_hash,
           algorithm_version,
           revision,
           snapshot_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        boardId,
        metadata.clubId,
        metadata.screeningId,
        metadata.scheduledAt,
        lockedAt,
        snapshot.snapshotId,
        snapshot.snapshotHash,
        snapshot.algorithmVersion,
        snapshot.revision,
        snapshotJson,
      );

    return freezeFilmRoundSnapshot(persistedSnapshot);
  };

  const lockRound = (
    boardId: string,
    rawMetadata: FilmRoundLockMetadata,
    expectedRevision: number,
  ): FilmRoundSnapshot =>
    runInTransaction(database, () => {
      const metadata = filmRoundLockMetadataSchema.parse(rawMetadata);
      if (boardId !== `${metadata.clubId}-${metadata.screeningId}`) {
        throw new Error(
          "The voting board must match the round club and screening.",
        );
      }
      const existingSchedule = getStoredScheduledRound(boardId);
      if (
        existingSchedule &&
        !sameMetadata(metadata, existingSchedule.metadata)
      ) {
        throw new FilmRoundScheduleNotEditableError(
          "The schedule metadata is frozen for this voting round.",
        );
      }
      const existing = getStoredRoundSnapshot(boardId);
      if (existing) {
        return existing;
      }

      const currentRevision = getRevision(boardId);
      if (
        !Number.isSafeInteger(expectedRevision) ||
        expectedRevision !== currentRevision
      ) {
        throw new FilmRoundRevisionConflictError(
          expectedRevision,
          currentRevision,
        );
      }
      return lockRoundInTransaction(boardId, metadata);
    });

  const lockScheduledRoundInTransaction = (
    boardId: string,
    metadata: FilmRoundLockMetadata,
    now: Date,
    lowerDeadline: boolean,
  ): FilmRoundSnapshot => {
    const existing = getStoredRoundSnapshot(boardId);
    if (existing) {
      return existing;
    }

    const snapshot = lockRoundInTransaction(boardId, metadata, now);
    if (lowerDeadline) {
      const nowIso = now.toISOString();
      database
        .prepare(
          `UPDATE film_rounds
           SET vote_ends_at = ?, results_at = ?, revision = revision + 1
           WHERE board_id = ?`,
        )
        .run(nowIso, nowIso, boardId);
    } else {
      database
        .prepare(
          `UPDATE film_rounds
           SET revision = revision + 1
           WHERE board_id = ?`,
        )
        .run(boardId);
    }
    return snapshot;
  };

  const completeScheduledRoundInTransaction = (
    scheduledRound: ScheduledFilmRound,
    now: Date,
  ): ScheduledFilmRound => {
    const current = getStoredScheduledRound(scheduledRound.boardId);
    if (!current) {
      throw new Error("The scheduled film round was not found.");
    }
    if (current.completedAt !== null) {
      return current;
    }
    if (!getStoredRoundSnapshot(current.boardId)) {
      throw new FilmRoundNotOpenError(
        "A film round must be closed before it can be completed.",
      );
    }
    if (now.getTime() < Date.parse(current.scheduledAt)) {
      throw new FilmRoundNotOpenError(
        "A film round cannot be completed before its screening time.",
      );
    }
    return updateScheduledRound(
      scheduleInputFromRound(current),
      current.revision + 1,
      now.toISOString(),
    );
  };

  const normalizeScheduleInput = (
    rawInput: FilmScheduleInput,
  ): FilmScheduleInput => {
    const input = filmScheduleInputSchema.parse(rawInput);
    assertBoardIdentity(input);
    return {
      ...input,
      metadata: {
        ...input.metadata,
        scheduledAt: input.scheduledAt,
      },
    };
  };

  const scheduleInputFromRound = (
    round: ScheduledFilmRound,
  ): FilmScheduleInput => ({
    boardId: round.boardId,
    clubId: round.clubId,
    screeningId: round.screeningId,
    voteStartsAt: round.voteStartsAt,
    voteEndsAt: round.voteEndsAt,
    resultsAt: round.resultsAt,
    scheduledAt: round.scheduledAt,
    displayUntil: round.displayUntil,
    venue: round.venue,
    published: round.published,
    metadata: round.metadata,
  });

  const sameScheduleInput = (
    first: FilmScheduleInput,
    second: FilmScheduleInput,
  ): boolean => canonicalJson(first) === canonicalJson(second);

  const insertScheduledRound = (
    input: FilmScheduleInput,
    revision: number,
    completedAt: string | null,
  ): ScheduledFilmRound => {
    database
      .prepare(
        `INSERT INTO film_rounds (
           board_id,
           club_id,
           screening_id,
           vote_starts_at,
           vote_ends_at,
           results_at,
           scheduled_at,
           display_until,
           venue,
           published,
           completed_at,
           revision,
           metadata_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.boardId,
        input.clubId,
        input.screeningId,
        input.voteStartsAt,
        input.voteEndsAt,
        input.resultsAt,
        input.scheduledAt,
        input.displayUntil,
        input.venue,
        input.published ? 1 : 0,
        completedAt,
        revision,
        JSON.stringify(input.metadata),
      );
    const inserted = getStoredScheduledRound(input.boardId);
    if (!inserted) {
      throw new Error("The film schedule could not be read after insertion.");
    }
    return inserted;
  };

  const updateScheduledRound = (
    input: FilmScheduleInput,
    revision: number,
    completedAt: string | null,
  ): ScheduledFilmRound => {
    database
      .prepare(
        `UPDATE film_rounds
         SET club_id = ?,
             screening_id = ?,
             vote_starts_at = ?,
             vote_ends_at = ?,
             results_at = ?,
             scheduled_at = ?,
             display_until = ?,
             venue = ?,
             published = ?,
             completed_at = ?,
             revision = ?,
             metadata_json = ?
         WHERE board_id = ?`,
      )
      .run(
        input.clubId,
        input.screeningId,
        input.voteStartsAt,
        input.voteEndsAt,
        input.resultsAt,
        input.scheduledAt,
        input.displayUntil,
        input.venue,
        input.published ? 1 : 0,
        completedAt,
        revision,
        JSON.stringify(input.metadata),
        input.boardId,
      );
    const updated = getStoredScheduledRound(input.boardId);
    if (!updated) {
      throw new Error("The film schedule could not be read after update.");
    }
    return updated;
  };

  const saveScheduledRound = (
    rawInput: FilmScheduleInput,
    expectedRevision: number | null,
  ): ScheduledFilmRound => {
    const input = normalizeScheduleInput(rawInput);
    return runInTransaction(database, () => {
      const existingRow = getScheduleRow(input.boardId);
      if (!existingRow) {
        if (expectedRevision !== null) {
          scheduleRevisionConflict(expectedRevision, 0);
        }

        const existingSnapshot = getStoredRoundSnapshot(input.boardId);
        if (existingSnapshot) {
          assertMetadataMatchesSnapshot(input.metadata, existingSnapshot);
        } else {
          assertLegacyVotesFitMetadata(input.boardId, input.metadata);
        }
        assertNoPublishedScheduleOverlap(input);
        return insertScheduledRound(input, 0, null);
      }

      const existing = parseScheduleRow(existingRow);
      if (expectedRevision === null || expectedRevision !== existing.revision) {
        scheduleRevisionConflict(expectedRevision, existing.revision);
      }

      const existingInput = scheduleInputFromRound(existing);
      if (sameScheduleInput(existingInput, input)) {
        return existing;
      }

      const existingSnapshot = getStoredRoundSnapshot(input.boardId);
      const now = getScheduleNow();
      const nowMs = now.getTime();
      const voteHistory = database
        .prepare(
          `SELECT MIN(created_at) AS first_vote_at, MAX(created_at) AS last_vote_at
           FROM film_votes
           WHERE board_id = ?`,
        )
        .get(input.boardId) as {
        first_vote_at: string | null;
        last_vote_at: string | null;
      };
      const started =
        nowMs >= Date.parse(existing.voteStartsAt) ||
        Boolean(
          database
            .prepare(
              `SELECT 1 AS present
               FROM film_votes
               WHERE board_id = ?
               LIMIT 1`,
            )
            .get(input.boardId),
        );

      if (existingSnapshot || existing.completedAt !== null) {
        throw new FilmRoundScheduleNotEditableError(
          "A closed or completed film round is immutable.",
        );
      }
      if (
        existing.published &&
        started &&
        (!input.published ||
          !sameInstant(input.voteStartsAt, existing.voteStartsAt))
      ) {
        throw new FilmRoundScheduleNotEditableError(
          "A published round cannot be unpublished or moved once voting starts.",
        );
      }
      if (
        existing.published &&
        started &&
        Date.parse(input.voteEndsAt) <= nowMs
      ) {
        throw new FilmRoundScheduleNotEditableError(
          "Use the close action to end an active published round.",
        );
      }
      if (
        voteHistory.first_vote_at &&
        (Date.parse(voteHistory.first_vote_at) <
          Date.parse(input.voteStartsAt) ||
          Date.parse(voteHistory.last_vote_at ?? "") >=
            Date.parse(input.voteEndsAt))
      ) {
        throw new FilmRoundScheduleNotEditableError(
          "The schedule window cannot exclude existing votes.",
        );
      }
      if (started && !sameMetadata(existing.metadata, input.metadata)) {
        const subset = selectRoundCandidates(
          existing.metadata,
          input.metadata.catalogue.map((film) => film.id),
        );
        if (
          nowMs >= Date.parse(existing.voteEndsAt) ||
          !sameMetadata(subset, input.metadata)
        ) {
          throw new FilmRoundScheduleNotEditableError(
            "Etter stemmestart kan du bare fjerne filmer uten stemmer. Filmdata og avsluttede runder er låst.",
          );
        }
        // Check under the same transaction as the update, including new votes.
        assertLegacyVotesFitMetadata(input.boardId, input.metadata);
      }

      assertNoPublishedScheduleOverlap(input);
      return updateScheduledRound(input, existing.revision + 1, null);
    });
  };

  const finalizeDueRounds = (
    clubId: string,
    requestedNow: Date = getScheduleNow(),
  ): FilmRoundSnapshot[] => {
    if (
      !(requestedNow instanceof Date) ||
      Number.isNaN(requestedNow.getTime())
    ) {
      throw new Error("The film schedule clock must return a valid Date.");
    }
    const now = new Date(requestedNow.getTime());
    try {
      return runInTransaction(database, () => {
        const rows = database
          .prepare(
            `SELECT
               board_id,
               club_id,
               screening_id,
               vote_starts_at,
               vote_ends_at,
               results_at,
               scheduled_at,
               display_until,
               venue,
               published,
               completed_at,
               revision,
               metadata_json
             FROM film_rounds
             WHERE club_id = ? AND published = 1
             ORDER BY vote_starts_at ASC, board_id ASC`,
          )
          .all(clubId) as unknown as FilmScheduleRow[];
        return rows.flatMap((row) => {
          const round = parseScheduleRow(row);
          if (now.getTime() < Date.parse(round.voteEndsAt)) {
            return [];
          }
          const snapshot = lockScheduledRoundInTransaction(
            round.boardId,
            round.metadata,
            now,
            false,
          );
          const current = getStoredScheduledRound(round.boardId);
          if (
            current &&
            current.completedAt === null &&
            now.getTime() >= Date.parse(current.displayUntil)
          ) {
            completeScheduledRoundInTransaction(current, now);
          }
          return [snapshot];
        });
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("no such table: film_rounds")
      ) {
        return [];
      }
      throw error;
    }
  };

  const closeScheduledRound = (
    boardId: string,
    expectedRevision?: number,
  ): FilmRoundSnapshot =>
    runInTransaction(database, () => {
      const scheduledRound = getStoredScheduledRound(boardId);
      if (!scheduledRound) {
        throw new Error("The scheduled film round was not found.");
      }
      const existing = getStoredRoundSnapshot(boardId);
      if (existing) {
        return existing;
      }
      if (
        expectedRevision !== undefined &&
        expectedRevision !== scheduledRound.revision
      ) {
        throw new FilmScheduleRevisionConflictError(
          expectedRevision,
          scheduledRound.revision,
        );
      }
      const now = getScheduleNow();
      const nowMs = now.getTime();
      if (!scheduledRound.published) {
        throw new FilmRoundNotOpenError(
          "An unpublished film round cannot be closed.",
        );
      }
      if (nowMs <= Date.parse(scheduledRound.voteStartsAt)) {
        throw new FilmRoundNotOpenError(
          "A film round cannot be closed until voting has started.",
        );
      }
      if (nowMs > Date.parse(scheduledRound.scheduledAt)) {
        throw new FilmRoundNotOpenError(
          "A film round cannot be closed after its screening time.",
        );
      }
      return lockScheduledRoundInTransaction(
        boardId,
        scheduledRound.metadata,
        now,
        true,
      );
    });

  const completeScheduledRound = (
    boardId: string,
    expectedRevision?: number,
  ): ScheduledFilmRound =>
    runInTransaction(database, () => {
      const scheduledRound = getStoredScheduledRound(boardId);
      if (!scheduledRound) {
        throw new Error("The scheduled film round was not found.");
      }
      if (scheduledRound.completedAt !== null) {
        return scheduledRound;
      }
      if (
        expectedRevision !== undefined &&
        expectedRevision !== scheduledRound.revision
      ) {
        throw new FilmScheduleRevisionConflictError(
          expectedRevision,
          scheduledRound.revision,
        );
      }
      const now = getScheduleNow();
      return completeScheduledRoundInTransaction(scheduledRound, now);
    });

  const getRoundSnapshot = (boardId: string): FilmRoundSnapshot | null => {
    try {
      return runInReadTransaction(database, () =>
        getStoredRoundSnapshot(boardId),
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("no such table: film_vote_round_snapshots")
      ) {
        return null;
      }
      throw error;
    }
  };

  const getScheduledRound = (boardId: string): ScheduledFilmRound | null => {
    try {
      return runInReadTransaction(database, () =>
        getStoredScheduledRound(boardId),
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("no such table: film_rounds")
      ) {
        return null;
      }
      throw error;
    }
  };

  const listScheduledRounds = (clubId: string): ScheduledFilmRound[] => {
    try {
      return runInReadTransaction(database, () => {
        const rows = database
          .prepare(
            `SELECT
               board_id,
               club_id,
               screening_id,
               vote_starts_at,
               vote_ends_at,
               results_at,
               scheduled_at,
               display_until,
               venue,
               published,
               completed_at,
               revision,
               metadata_json
             FROM film_rounds
             WHERE club_id = ?
             ORDER BY vote_starts_at ASC, board_id ASC`,
          )
          .all(clubId) as unknown as FilmScheduleRow[];
        return rows.map(parseScheduleRow);
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("no such table: film_rounds")
      ) {
        return [];
      }
      throw error;
    }
  };

  return {
    close() {
      database.close();
    },

    getLockedRound: getRoundSnapshot,

    getRoundSnapshot,

    getScheduledRound,

    listScheduledRounds,

    getSnapshot(boardId, voterKey, catalogueFilmIds, tieBreakScores) {
      return runInReadTransaction(database, () => {
        const votedRows = database
          .prepare(
            `SELECT film_id
             FROM film_votes
             WHERE board_id = ? AND voter_key = ?
             ORDER BY vote_id ASC`,
          )
          .all(boardId, voterKey) as unknown as VotedFilmRow[];

        return {
          boardId,
          ranking: getRanking(boardId, catalogueFilmIds, tieBreakScores),
          revision: getRevision(boardId),
          votedFilmIds: votedRows.map((row) => row.film_id),
        };
      });
    },

    getResults(boardId, catalogueFilmIds, tieBreakScores) {
      return runInReadTransaction(database, () => {
        const stats = database
          .prepare(
            `SELECT
               COUNT(*) AS total_votes,
               COUNT(DISTINCT voter_key) AS participating_devices,
               MAX(created_at) AS last_vote_at
             FROM film_votes
             WHERE board_id = ?`,
          )
          .get(boardId) as unknown as VoteStatsRow;

        return {
          boardId,
          lastVoteAt: stats.last_vote_at,
          participatingDevices: stats.participating_devices,
          ranking: getRanking(boardId, catalogueFilmIds, tieBreakScores),
          revision: getRevision(boardId),
          totalVotes: stats.total_votes,
        };
      });
    },

    saveScheduledRound,

    finalizeDueRounds,

    closeScheduledRound,

    completeScheduledRound,

    lockRound,

    recordVote(boardId, filmId, voterKey) {
      return setVote(boardId, filmId, voterKey, true);
    },

    setVote,
  };
};

let defaultStore: FilmVoteStore | null = null;

export const getFilmVoteStore = (): FilmVoteStore => {
  defaultStore ??= createFilmVoteStore(CLUB_SQLITE_PATH);
  return defaultStore;
};
