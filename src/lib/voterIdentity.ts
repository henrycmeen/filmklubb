import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { NextApiRequest } from "next";
import ipaddr from "ipaddr.js";
import { CLUB_SQLITE_PATH } from "@/lib/storagePaths";

const SECRET_BYTE_LENGTH = 32;
const DEVICE_NONCE_BYTE_LENGTH = 32;
const DEVICE_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
const DEVICE_COOKIE_PATTERN = /^v1\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/;

export const DEVICE_COOKIE_NAME = "filmklubb_device_v1";

export interface DeviceIdentity {
  cookieValue: string;
  voterKey: string;
}

interface DeviceCookieOptions {
  basePath?: string;
  secure: boolean;
}

const assertValidSecret = (secret: Uint8Array): void => {
  if (secret.byteLength < SECRET_BYTE_LENGTH) {
    throw new Error("Film vote secret must contain at least 32 bytes.");
  }
};

const deviceCookieMac = (nonce: string, secret: Uint8Array): string =>
  createHmac("sha256", secret)
    .update(`filmklubb-device-cookie:v1:${nonce}`)
    .digest("base64url");

const deviceVoterKey = (nonce: string, secret: Uint8Array): string =>
  `device-v1:${createHmac("sha256", secret)
    .update(`filmklubb-voter-key:v1:${nonce}`)
    .digest("hex")}`;

export const createDeviceIdentity = (
  secret: Uint8Array,
  nonceBytes: Uint8Array = randomBytes(DEVICE_NONCE_BYTE_LENGTH),
): DeviceIdentity => {
  assertValidSecret(secret);
  if (nonceBytes.byteLength !== DEVICE_NONCE_BYTE_LENGTH) {
    throw new Error("Film vote device nonce must contain exactly 32 bytes.");
  }

  const nonce = Buffer.from(nonceBytes).toString("base64url");
  return {
    cookieValue: `v1.${nonce}.${deviceCookieMac(nonce, secret)}`,
    voterKey: deviceVoterKey(nonce, secret),
  };
};

export const parseDeviceIdentity = (
  cookieValue: string | undefined,
  secret: Uint8Array,
): string | null => {
  assertValidSecret(secret);
  const match = cookieValue?.match(DEVICE_COOKIE_PATTERN);
  if (!match) {
    return null;
  }

  const [, nonce, suppliedMac] = match;
  if (!nonce || !suppliedMac) {
    return null;
  }

  const nonceBytes = Buffer.from(nonce, "base64url");
  const suppliedBytes = Buffer.from(suppliedMac, "base64url");
  const expectedBytes = Buffer.from(
    deviceCookieMac(nonce, secret),
    "base64url",
  );
  if (
    nonceBytes.byteLength !== DEVICE_NONCE_BYTE_LENGTH ||
    nonceBytes.toString("base64url") !== nonce ||
    suppliedBytes.byteLength !== expectedBytes.byteLength ||
    suppliedBytes.toString("base64url") !== suppliedMac ||
    !timingSafeEqual(suppliedBytes, expectedBytes)
  ) {
    return null;
  }

  return deviceVoterKey(nonce, secret);
};

const normalizeCookiePath = (basePath: string | undefined): string => {
  const trimmed = basePath?.trim().replace(/^\/+|\/+$/g, "") ?? "";
  if (!trimmed) {
    return "/";
  }

  return /^[A-Za-z0-9/_-]+$/.test(trimmed) ? `/${trimmed}` : "/";
};

export const serializeDeviceCookie = (
  cookieValue: string,
  options: DeviceCookieOptions,
): string => {
  const attributes = [
    `${DEVICE_COOKIE_NAME}=${cookieValue}`,
    `Max-Age=${DEVICE_COOKIE_MAX_AGE_SECONDS}`,
    `Path=${normalizeCookiePath(options.basePath)}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (options.secure) {
    attributes.push("Secure");
  }

  return attributes.join("; ");
};

const normalizeIp = (rawAddress: string | undefined): string | null => {
  const address = rawAddress?.trim();
  if (!address || !ipaddr.isValid(address)) {
    return null;
  }

  const parsed = ipaddr.parse(address);
  if (parsed instanceof ipaddr.IPv6 && parsed.isIPv4MappedAddress()) {
    return parsed.toIPv4Address().toString();
  }

  return parsed.toString();
};

const isLoopback = (address: string): boolean =>
  ipaddr.parse(address).range() === "loopback";

const firstHeaderValue = (
  value: string | string[] | undefined,
): string | undefined => (Array.isArray(value) ? value[0] : value);

export const resolveTrustedClientIp = (req: NextApiRequest): string | null => {
  const remoteAddress = normalizeIp(req.socket.remoteAddress);
  if (!remoteAddress) {
    return null;
  }

  if (isLoopback(remoteAddress)) {
    const proxiedAddress = normalizeIp(
      firstHeaderValue(req.headers["x-client-ip"]),
    );
    if (proxiedAddress) {
      return proxiedAddress;
    }
  }

  return remoteAddress;
};

export const createVoterKey = (
  ipAddress: string,
  secret: Uint8Array,
): string => {
  assertValidSecret(secret);

  return createHmac("sha256", secret).update(ipAddress).digest("hex");
};

const getSecretPath = (): string => {
  const configuredPath = process.env.FILM_VOTE_SECRET_PATH?.trim();
  return configuredPath && configuredPath.length > 0
    ? configuredPath
    : path.join(path.dirname(CLUB_SQLITE_PATH), ".film-vote-secret");
};

const readSecret = async (secretPath: string): Promise<Buffer> => {
  const secret = await fs.readFile(secretPath);
  if (secret.byteLength < SECRET_BYTE_LENGTH) {
    throw new Error("Film vote secret file is invalid.");
  }
  return secret;
};

let secretPromise: Promise<Buffer> | null = null;

export const getOrCreateVoterSecret = async (): Promise<Buffer> => {
  if (secretPromise) {
    return secretPromise;
  }

  secretPromise = (async () => {
    const secretPath = getSecretPath();
    await fs.mkdir(path.dirname(secretPath), { recursive: true });

    try {
      return await readSecret(secretPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    const generatedSecret = randomBytes(SECRET_BYTE_LENGTH);
    try {
      const handle = await fs.open(secretPath, "wx", 0o600);
      try {
        await handle.writeFile(generatedSecret);
      } finally {
        await handle.close();
      }
      return generatedSecret;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        return readSecret(secretPath);
      }
      throw error;
    }
  })().catch((error: unknown) => {
    secretPromise = null;
    throw error;
  });

  return secretPromise;
};
