import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatOsloDateTimeInput,
  OsloDateTimeError,
  parseOsloDateTime,
  validateOsloScheduleOrder,
} from "@/lib/filmAdminTime";

void test("converts Oslo wall-clock time without using the machine timezone", () => {
  assert.equal(
    parseOsloDateTime("2026-01-15T19:30"),
    "2026-01-15T18:30:00.000Z",
  );
  assert.equal(
    parseOsloDateTime("2026-07-15T19:30"),
    "2026-07-15T17:30:00.000Z",
  );
});

void test("rejects a nonexistent spring-forward time", () => {
  assert.throws(
    () => parseOsloDateTime("2026-03-29T02:30"),
    (error: unknown) =>
      error instanceof OsloDateTimeError && error.code === "nonexistent",
  );
});

void test("rejects an ambiguous fall-back time", () => {
  assert.throws(
    () => parseOsloDateTime("2026-10-25T02:30"),
    (error: unknown) =>
      error instanceof OsloDateTimeError && error.code === "ambiguous",
  );
});

void test("formats an instant back into an Oslo datetime-local value", () => {
  assert.equal(
    formatOsloDateTimeInput("2026-07-15T17:30:00.000Z"),
    "2026-07-15T19:30",
  );
});

void test("reports schedule milestones that are out of order", () => {
  assert.equal(
    validateOsloScheduleOrder({
      voteStartsAt: "2026-01-01T18:00:00.000Z",
      voteEndsAt: "2026-01-02T18:00:00.000Z",
      resultsAt: "2026-01-02T17:00:00.000Z",
      scheduledAt: "2026-01-03T18:00:00.000Z",
      displayUntil: "2026-01-03T21:00:00.000Z",
    }),
    "Stemmefrist må være før Resultatslipp.",
  );
});
