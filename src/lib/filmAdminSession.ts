import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import {
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  lstatSync,
} from "node:fs";
import path from "node:path";
import type { IncomingMessage } from "node:http";
import { z } from "zod";
import { isLocalFilmAdminRequest } from "./filmAdminAccess";

const configSchema = z
  .object({
    salt: z.string().regex(/^[a-f0-9]{32}$/),
    hash: z.string().regex(/^[a-f0-9]{128}$/),
    secret: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const ADMIN_COOKIE = "filmclub_admin";
const lifetime = 8 * 60 * 60 * 1000;
const authPath = () =>
  path.resolve(
    process.env.FILMKLUBB_ADMIN_AUTH_PATH ??
      path.join(process.cwd(), "data/club/admin-auth.json"),
  );
const readConfig = () => {
  const filename = authPath();
  if (!existsSync(filename)) return null;
  if (!lstatSync(filename).isFile() || lstatSync(filename).isSymbolicLink())
    throw new Error("Invalid admin configuration");
  return configSchema.parse(
    JSON.parse(readFileSync(filename, "utf8")) as unknown,
  );
};
export const hasAdminPassword = () => readConfig() !== null;

export function setInitialAdminPassword(password: string): void {
  if (password.length < 10 || password.length > 256)
    throw new Error("Passordet må ha mellom 10 og 256 tegn.");
  const salt = randomBytes(16).toString("hex");
  const config = {
    salt,
    hash: scryptSync(password, salt, 64).toString("hex"),
    secret: randomBytes(32).toString("hex"),
  };
  const filename = authPath();
  mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  // Exclusive creation: setup cannot overwrite an existing password/session key.
  writeFileSync(filename, JSON.stringify(config), { flag: "wx", mode: 0o600 });
}

export function verifyAdminPassword(password: string): boolean {
  const config = readConfig();
  if (!config || password.length > 256) return false;
  return timingSafeEqual(
    scryptSync(password, config.salt, 64),
    Buffer.from(config.hash, "hex"),
  );
}

export function createAdminSession(clubId: string, now = Date.now()): string {
  const config = readConfig();
  if (!config) throw new Error("Admin unavailable");
  const payload = Buffer.from(
    JSON.stringify({ clubId, issuedAt: now, expiresAt: now + lifetime }),
  ).toString("base64url");
  return `${payload}.${createHmac("sha256", config.secret).update(payload).digest("base64url")}`;
}

export function verifyAdminSession(
  value: string | undefined,
  clubId: string,
  now = Date.now(),
): boolean {
  if (!value || value.length > 1024) return false;
  const config = readConfig();
  if (!config) return false;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra) return false;
  const expected = createHmac("sha256", config.secret).update(payload).digest();
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return false;
  try {
    const session = z
      .object({
        clubId: z.string(),
        issuedAt: z.number().int(),
        expiresAt: z.number().int(),
      })
      .strict()
      .parse(
        JSON.parse(Buffer.from(payload, "base64url").toString()) as unknown,
      );
    return (
      session.clubId === clubId &&
      session.issuedAt <= now &&
      session.expiresAt > now &&
      session.expiresAt - session.issuedAt === lifetime
    );
  } catch {
    return false;
  }
}

type AdminRequest = Pick<IncomingMessage, "headers" | "socket">;
export function validAdminOrigin(req: AdminRequest): boolean {
  if (req.headers["content-type"]?.split(";")[0]?.trim() !== "application/json")
    return false;
  if (
    req.headers["sec-fetch-site"] &&
    req.headers["sec-fetch-site"] !== "same-origin"
  )
    return false;
  const origin = req.headers.origin;
  if (typeof origin !== "string") return false;
  if (isLocalFilmAdminRequest(req) && origin === `http://${req.headers.host}`)
    return true;
  const configured = process.env.FILMKLUBB_ADMIN_ORIGIN;
  return configured?.startsWith("https://") === true && origin === configured;
}

export function serializeAdminCookie(
  value: string,
  secure: boolean,
  logout = false,
): string {
  const base = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/g, "");
  const cookiePath = /^\/[a-zA-Z0-9/_-]*$/.test(base) ? base : "/";
  return `${ADMIN_COOKIE}=${value}; Path=${cookiePath}; HttpOnly; SameSite=Strict; Max-Age=${logout ? 0 : lifetime / 1000}${secure ? "; Secure" : ""}`;
}
