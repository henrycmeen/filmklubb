import assert from "node:assert/strict";
import { test } from "node:test";
import {
  groupAdminEvents,
  adminEventStatus,
  adminEventTitle,
} from "./filmAdminOverview";

const active = {
  published: true,
  completedAt: null,
  voteStartsAt: "2026-09-01T00:00:00Z",
  voteEndsAt: "2026-09-21T12:00:00Z",
  resultsAt: "2026-09-21T13:00:00Z",
  scheduledAt: "2026-09-22T14:00:00Z",
  displayUntil: "2026-09-22T21:59:00Z",
};
const now = Date.parse("2026-09-21T11:00:00Z");

void test("all future events and drafts stay planned, not just the first one", () => {
  const draft = { ...active, published: false };
  const october = {
    ...active,
    voteStartsAt: "2026-10-01T00:00:00Z",
    scheduledAt: "2026-10-20T14:00:00Z",
    displayUntil: "2026-10-21T00:00:00Z",
  };
  const november = {
    ...october,
    voteStartsAt: "2026-11-01T00:00:00Z",
    scheduledAt: "2026-11-20T14:00:00Z",
  };
  const past = { ...active, completedAt: "2026-09-20T00:00:00Z" };
  const input = [november, past, active, october, draft];
  const before = [...input];
  const groups = groupAdminEvents(input, now);
  assert.deepEqual(groups.active, [active]);
  assert.deepEqual(groups.planned, [draft, october, november]);
  assert.deepEqual(groups.historical, [past]);
  assert.deepEqual(input, before);
});

void test("result display stays active until its end, including after the screening", () => {
  const end = Date.parse(active.displayUntil);
  assert.equal(groupAdminEvents([active], end - 1).active.length, 1);
  assert.equal(groupAdminEvents([active], end).historical.length, 1);
  assert.equal(adminEventStatus(active, end), "Gjennomført");
  assert.equal(
    adminEventStatus(active, Date.parse(active.voteEndsAt)),
    "Venter på resultat",
  );
  assert.equal(
    adminEventStatus(active, Date.parse(active.resultsAt)),
    "Resultat publisert",
  );
});

void test("unpublished old dates remain drafts and titles use Oslo date", () => {
  const draft = { ...active, published: false };
  assert.equal(
    groupAdminEvents([draft], Date.parse("2027-01-01")).planned.length,
    1,
  );
  assert.equal(adminEventStatus(draft, now), "Utkast");
  assert.equal(
    adminEventTitle({ scheduledAt: "2026-09-21T23:00:00Z" }),
    "22. september 2026",
  );
});
