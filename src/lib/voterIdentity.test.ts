import assert from "node:assert/strict";
import test from "node:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { NextApiRequest } from "next";
import {
  getOrCreateVoterSecret,
  createDeviceIdentity,
  createVoterKey,
  DEVICE_COOKIE_NAME,
  parseDeviceIdentity,
  resolveTrustedClientIp,
  serializeDeviceCookie,
} from "./voterIdentity";

const identitySecret = Buffer.alloc(32, 7);

const request = ({
  clientIp,
  forwardedFor,
  remoteAddress,
}: {
  clientIp?: string;
  forwardedFor?: string;
  remoteAddress?: string;
}) =>
  ({
    headers: {
      ...(clientIp ? { "x-client-ip": clientIp } : {}),
      ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
    },
    socket: { remoteAddress },
  }) as unknown as NextApiRequest;

void test("trusts Caddy's client header only over the loopback proxy", () => {
  assert.equal(
    resolveTrustedClientIp(
      request({ clientIp: "203.0.113.8", remoteAddress: "127.0.0.1" }),
    ),
    "203.0.113.8",
  );

  assert.equal(
    resolveTrustedClientIp(
      request({ clientIp: "203.0.113.8", remoteAddress: "192.168.1.20" }),
    ),
    "192.168.1.20",
  );
});

void test("does not trust a client supplied forwarded-for chain", () => {
  assert.equal(
    resolveTrustedClientIp(
      request({
        forwardedFor: "203.0.113.8, 198.51.100.2",
        remoteAddress: "192.168.1.20",
      }),
    ),
    "192.168.1.20",
  );
});

void test("normalizes IPv4-mapped addresses", () => {
  assert.equal(
    resolveTrustedClientIp(request({ remoteAddress: "::ffff:192.0.2.4" })),
    "192.0.2.4",
  );
});

void test("creates a stable keyed identity without exposing the IP", () => {
  const first = createVoterKey("203.0.113.8", Buffer.alloc(32, 7));
  const second = createVoterKey("203.0.113.8", Buffer.alloc(32, 7));

  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first.includes("203.0.113.8"), false);
});

void test("creates a signed opaque device identity and a server-only voter key", () => {
  const first = createDeviceIdentity(identitySecret, Buffer.alloc(32, 1));
  const second = createDeviceIdentity(identitySecret, Buffer.alloc(32, 1));

  assert.equal(first.cookieValue, second.cookieValue);
  assert.equal(first.voterKey, second.voterKey);
  assert.match(first.cookieValue, /^v1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/);
  assert.match(first.voterKey, /^device-v1:[a-f0-9]{64}$/);
  assert.equal(
    parseDeviceIdentity(first.cookieValue, identitySecret),
    first.voterKey,
  );
  assert.equal(first.cookieValue.includes(first.voterKey), false);
});

void test("rejects malformed, truncated, and tampered device cookies", () => {
  const identity = createDeviceIdentity(identitySecret, Buffer.alloc(32, 2));
  const tampered = `${identity.cookieValue.slice(0, -1)}${
    identity.cookieValue.endsWith("A") ? "B" : "A"
  }`;

  assert.equal(
    parseDeviceIdentity("not-a-device-cookie", identitySecret),
    null,
  );
  assert.equal(
    parseDeviceIdentity(identity.cookieValue.slice(0, -1), identitySecret),
    null,
  );
  assert.equal(parseDeviceIdentity(tampered, identitySecret), null);
  assert.equal(
    parseDeviceIdentity(identity.cookieValue, Buffer.alloc(32, 8)),
    null,
  );
});

void test("serializes a host-only long-lived cookie for the configured app path", () => {
  const value = createDeviceIdentity(
    identitySecret,
    Buffer.alloc(32, 3),
  ).cookieValue;
  const productionCookie = serializeDeviceCookie(value, {
    basePath: "/filmklubb/",
    secure: true,
  });

  assert.match(productionCookie, new RegExp(`^${DEVICE_COOKIE_NAME}=`));
  assert.match(productionCookie, /; Max-Age=31536000/);
  assert.match(productionCookie, /; Path=\/filmklubb/);
  assert.match(productionCookie, /; HttpOnly/);
  assert.match(productionCookie, /; SameSite=Lax/);
  assert.match(productionCookie, /; Secure/);
  assert.equal(productionCookie.includes("Domain="), false);

  const localCookie = serializeDeviceCookie(value, {
    basePath: "",
    secure: false,
  });
  assert.match(localCookie, /; Path=\//);
  assert.equal(localCookie.includes("; Secure"), false);
});


void test("retries identity initialization after a transient file failure", async () => {
  await fs.mkdir(".cache", { recursive: true });
  const directory = await fs.mkdtemp(path.resolve(".cache/voter-retry-"));
  const secretPath = path.join(directory, "test-secret");
  const previousPath = process.env.FILM_VOTE_SECRET_PATH;
  process.env.FILM_VOTE_SECRET_PATH = secretPath;
  try {
    // A recoverable invalid file must not poison all later vote requests.
    await fs.writeFile(secretPath, Buffer.alloc(1));
    await assert.rejects(getOrCreateVoterSecret(), /secret file is invalid/);
    const expectedSecret = Buffer.alloc(32, 9);
    await fs.writeFile(secretPath, expectedSecret);
    const [first, second] = await Promise.all([
      getOrCreateVoterSecret(), getOrCreateVoterSecret(),
    ]);
    assert.deepEqual(first, expectedSecret);
    assert.deepEqual(second, expectedSecret);
  } finally {
    if (previousPath === undefined) delete process.env.FILM_VOTE_SECRET_PATH;
    else process.env.FILM_VOTE_SECRET_PATH = previousPath;
    await fs.rm(directory, { recursive: true, force: true });
  }
});
