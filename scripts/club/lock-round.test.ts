import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLockRoundArgs } from "./lock-round";

void test("uses a safe read-only preview by default", () => {
  assert.deepEqual(parseLockRoundArgs([]), {
    clubProvided: false,
    clubSlug: "default",
    commit: false,
    help: false,
    screeningProvided: false,
  });
});

void test("parses the explicit close gate", () => {
  assert.deepEqual(
    parseLockRoundArgs([
      "--club",
      "DEMO",
      "--screening",
      "screening",
      "--expected-revision",
      "12",
      "--database",
      "/tmp/filmklubb.sqlite",
      "--commit",
    ]),
    {
      clubProvided: true,
      clubSlug: "demo",
      commit: true,
      databasePath: "/tmp/filmklubb.sqlite",
      expectedRevision: 12,
      help: false,
      screeningId: "screening",
      screeningProvided: true,
    },
  );
});

void test("rejects unsafe or ambiguous command line input", () => {
  assert.throws(
    () => parseLockRoundArgs(["--screening", "../current"]),
    /invalid screening/i,
  );
  assert.throws(
    () => parseLockRoundArgs(["--expected-revision", "1.5"]),
    /invalid expected revision/i,
  );
  assert.throws(() => parseLockRoundArgs(["--unknown"]), /unknown option/i);
});

const runLockRound = async (
  cwd: string,
  env: Record<string, string>,
): Promise<string> => {
  const { execFile } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        `${repoRoot}scripts/club/lock-round.ts`,
        "--database",
        `${cwd}/missing.sqlite`,
      ],
      {
        cwd,
        env: {
          ...process.env,
          FILMKLUBB_PROGRAMME_PATH: "",
          TSX_TSCONFIG_PATH: `${repoRoot}tsconfig.json`,
          ...env,
        },
      },
      (_error, stdout, stderr) => resolve(`${stdout}${stderr}`),
    );
  });
};

const legacyProgramme = JSON.stringify({
  clubs: {
    default: {
      name: "Filmklubb",
      activeScreening: {
        id: "fixture-screening",
        scheduledAt: "2026-09-22T16:00:00+02:00",
      },
      history: [],
    },
  },
  aliases: {},
});

void test("reads the club programme file the build uses", async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const directory = await mkdtemp(`${tmpdir()}/lock-round-`);
  try {
    // Without a club file, the template has no legacy screening.
    assert.match(
      await runLockRound(directory, {}),
      /No legacy screening is configured/,
    );
    // The default data/club/programme.json path.
    await mkdir(`${directory}/data/club`, { recursive: true });
    await writeFile(`${directory}/data/club/programme.json`, legacyProgramme);
    assert.match(
      await runLockRound(directory, {}),
      /The configured SQLite database does not exist/,
    );
    // An explicit FILMKLUBB_PROGRAMME_PATH.
    await rm(`${directory}/data`, { recursive: true });
    await writeFile(`${directory}/club.json`, legacyProgramme);
    assert.match(
      await runLockRound(directory, {
        FILMKLUBB_PROGRAMME_PATH: `${directory}/club.json`,
      }),
      /The configured SQLite database does not exist/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
