import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import type { NextApiRequest, NextApiResponse } from "next";
import {
  ADMIN_COOKIE,
  hasAdminPassword,
  setInitialAdminPassword,
  verifyAdminPassword,
  createAdminSession,
  verifyAdminSession,
  serializeAdminCookie,
  validAdminOrigin,
} from "./filmAdminSession";
import handler from "../pages/api/club/admin-session";
import adminHandler from "../pages/api/club/admin";

const directory = mkdtempSync(path.join(tmpdir(), "film-admin-auth-"));
process.env.CLUB_DB_PATH = path.join(directory, "votes.sqlite");
process.env.FILMKLUBB_ADMIN_AUTH_PATH = path.join(directory, "admin.json");
process.env.FILMKLUBB_LOCAL_ADMIN = "1";
process.env.NEXT_PUBLIC_BASE_PATH = "/filmklubb";
after(() => rmSync(directory, { recursive: true, force: true }));

function request(
  body?: unknown,
  overrides: Partial<NextApiRequest> = {},
): NextApiRequest {
  return {
    method: body ? "POST" : "GET",
    body,
    query: { clubSlug: "DEFAULT" },
    cookies: {},
    headers: {
      host: "127.0.0.1:3058",
      origin: "http://127.0.0.1:3058",
      "content-type": "application/json",
    },
    socket: { remoteAddress: "127.0.0.1" },
    ...overrides,
  } as NextApiRequest;
}
function invoke(req: NextApiRequest, fn = handler) {
  let status = 200;
  let body: unknown;
  const headers: Record<string, string> = {};
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(value: unknown) {
      body = value;
      return this;
    },
    setHeader(key: string, value: string | number) {
      headers[key.toLowerCase()] = String(value);
      return this;
    },
  } as unknown as NextApiResponse;
  fn(req, res);
  return { status, body, headers };
}

void test("setup is local and stores only a salted password hash with restricted permissions", () => {
  assert.equal(hasAdminPassword(), false);
  const remote = request(
    { action: "setup", password: "test-only-password" },
    {
      headers: {
        host: "public.example",
        origin: "https://public.example",
        "content-type": "application/json",
      },
    },
  );
  assert.equal(invoke(remote).status, 403);
  assert.equal(hasAdminPassword(), false);
  assert.equal(
    invoke(request({ action: "setup", password: "test-only-password" })).status,
    200,
  );
  assert.equal(hasAdminPassword(), true);
  const content = readFileSync(process.env.FILMKLUBB_ADMIN_AUTH_PATH!, "utf8");
  assert.equal(content.includes("test-only-password"), false);
  assert.equal(
    statSync(process.env.FILMKLUBB_ADMIN_AUTH_PATH!).mode & 0o777,
    0o600,
  );
  assert.equal(verifyAdminPassword("test-only-password"), true);
  assert.equal(verifyAdminPassword("wrong-password"), false);
  assert.throws(() => setInitialAdminPassword("replacement-password"));
  assert.equal(
    invoke(request({ action: "setup", password: "replacement-password" }))
      .status,
    403,
  );
});

void test("sessions are signed, expire, and cannot be reused for a different club", () => {
  const now = Date.now();
  const cookie = createAdminSession("default", now);
  assert.equal(verifyAdminSession(cookie, "default", now), true);
  assert.equal(verifyAdminSession(cookie, "other", now), false);
  assert.equal(verifyAdminSession(cookie, "default", now - 1), false);
  assert.equal(
    verifyAdminSession(cookie, "default", now + 8 * 60 * 60 * 1000),
    false,
  );
  assert.equal(verifyAdminSession(`X${cookie}`, "default", now), false);
  assert.equal(verifyAdminSession("garbage", "default", now), false);
  assert.match(
    serializeAdminCookie(cookie, true),
    /Path=\/filmklubb; HttpOnly; SameSite=Strict; Max-Age=28800; Secure$/,
  );
  assert.match(serializeAdminCookie("", true, true), /Max-Age=0/);
});

void test("admin data and writes require a session, login/logout use protected cookies", () => {
  assert.equal(invoke(request(), adminHandler).status, 401);
  assert.equal(
    invoke(
      request({
        action: "close",
        boardId: "default-screening",
        expectedRevision: 0,
      }),
      adminHandler,
    ).status,
    401,
  );
  const bad = invoke(request({ action: "login", password: "wrong" }));
  assert.equal(bad.status, 401);
  const login = invoke(
    request({ action: "login", password: "test-only-password" }),
  );
  assert.equal(login.status, 200);
  const value = login.headers["set-cookie"]!.split(";")[0]!.slice(
    ADMIN_COOKIE.length + 1,
  );
  assert.deepEqual(
    invoke(request(undefined, { cookies: { [ADMIN_COOKIE]: value } })).body,
    { authenticated: true, needsSetup: false, canSetup: true },
  );
  assert.match(
    invoke(request({ action: "logout" })).headers["set-cookie"]!,
    /Max-Age=0/,
  );
});

void test("origin checks fail closed; incoming proxy headers cannot enable local enrollment", () => {
  assert.equal(
    validAdminOrigin(
      request(undefined, {
        headers: { host: "127.0.0.1:3058", "content-type": "application/json" },
      }),
    ),
    false,
  );
  assert.equal(
    validAdminOrigin(
      request(undefined, {
        headers: {
          host: "127.0.0.1:3058",
          origin: "https://evil.example",
          "content-type": "application/json",
        },
      }),
    ),
    false,
  );
  assert.equal(
    validAdminOrigin(
      request(undefined, {
        headers: {
          host: "127.0.0.1:3058",
          origin: "http://127.0.0.1:3058",
          "content-type": "application/json",
          "sec-fetch-site": "cross-site",
        },
      }),
    ),
    false,
  );
  const injected = request();
  injected.headers["x-forwarded-for"] = "127.0.0.1";
  injected.rawHeaders = ["Host", "127.0.0.1:3058"];
  assert.equal(validAdminOrigin(injected), true);
  injected.rawHeaders.push("X-Forwarded-For", "127.0.0.1");
  assert.equal(validAdminOrigin(injected), false);
});

void test("spoofed forwarding addresses cannot bypass login throttling", () => {
  process.env.FILMKLUBB_ADMIN_ORIGIN = "https://admin.example";
  for (let i = 0; i < 11; i++) {
    const req = request(
      { action: "login", password: "wrong" },
      {
        headers: {
          host: "admin.example",
          origin: "https://admin.example",
          "content-type": "application/json",
          "x-forwarded-for": `192.0.2.${i}`,
        },
        socket: { remoteAddress: "192.0.2.250" } as NextApiRequest["socket"],
      },
    );
    assert.equal(invoke(req).status, i < 10 ? 401 : 429);
  }
  delete process.env.FILMKLUBB_ADMIN_ORIGIN;
});
