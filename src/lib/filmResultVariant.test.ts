import assert from "node:assert/strict";
import test from "node:test";
import { getFilmResultVariant } from "./filmResultVariant";

void test("billettannonseringen brukes bare før visningen starter", () => {
  const start = "2026-09-22T16:00:00+02:00";
  const now = Date.parse(start);
  assert.equal(getFilmResultVariant(start, now - 1), "announcement");
  assert.equal(getFilmResultVariant(start, now), "archive");
  assert.equal(getFilmResultVariant(start, now + 86400000), "archive");
});

void test("ugyldig dato utløser ikke en ny vinnerannonsering", () => {
  assert.equal(getFilmResultVariant("invalid", 0), "archive");
});
