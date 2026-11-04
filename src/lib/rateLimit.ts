import ipaddr from 'ipaddr.js';
import type { NextApiRequest, NextApiResponse } from 'next';

interface RateLimitEntry {
  count: number;
  resetAtMs: number;
}

interface RateLimitStore {
  entries: Map<string, RateLimitEntry>;
  lastSweepAtMs: number;
}

export interface RateLimitOptions {
  key: string;
  maxRequests: number;
  windowMs: number;
}

interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAtMs: number;
  retryAfterSeconds: number;
}

const MAX_IDENTIFIERS_PER_STORE = 10_000;
const storesByKey = new Map<string, RateLimitStore>();

const clampInt = (value: number, min: number): number =>
  Math.max(min, Math.floor(value));

const normalizeIp = (value: string): string | null => {
  try {
    return ipaddr.process(value.trim()).toString();
  } catch {
    return null;
  }
};

const getClientIp = (req: NextApiRequest): string => {
  const remote = normalizeIp(req.socket.remoteAddress ?? '') ?? 'unknown';
  // Only explicitly configured proxy peers may supply a forwarding chain.
  const trusted = new Set((process.env.FILMKLUBB_TRUSTED_PROXIES ?? '')
    .split(',').map(normalizeIp).filter((ip): ip is string => ip !== null));
  if (!trusted.has(remote)) return remote;

  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded !== 'string' || forwarded.length > 4096) return remote;
  const chain = forwarded.split(',').map(normalizeIp);
  if (chain.length > 32 || chain.some(ip => ip === null)) return remote;

  let client = remote;
  // Walk from the socket towards the client; ignore attacker-supplied prefixes.
  for (let index = chain.length - 1; index >= 0 && trusted.has(client); index--) {
    client = chain[index]!;
  }
  return client;
};

const getStore = (key: string): RateLimitStore => {
  const existing = storesByKey.get(key);
  if (existing) {
    return existing;
  }

  const created: RateLimitStore = { entries: new Map(), lastSweepAtMs: 0 };
  storesByKey.set(key, created);
  return created;
};

const evaluateRateLimit = (
  identifier: string,
  options: RateLimitOptions
): RateLimitResult => {
  const now = Date.now();
  const maxRequests = clampInt(options.maxRequests, 1);
  const windowMs = clampInt(options.windowMs, 1_000);
  const store = getStore(options.key);
  if (now - store.lastSweepAtMs >= 30_000 || store.entries.size >= MAX_IDENTIFIERS_PER_STORE) {
    for (const [key, entry] of store.entries) {
      if (entry.resetAtMs <= now) store.entries.delete(key);
    }
    store.lastSweepAtMs = now;
  }
  const existing = store.entries.get(identifier);
  if (!existing && store.entries.size >= MAX_IDENTIFIERS_PER_STORE) {
    // Fail closed rather than evicting active limits or growing without bound.
    return {
      allowed: false, limit: maxRequests, remaining: 0,
      resetAtMs: now + windowMs,
      retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)),
    };
  }

  if (!existing || existing.resetAtMs <= now) {
    const resetAtMs = now + windowMs;
    store.entries.set(identifier, { count: 1, resetAtMs });
    return {
      allowed: true,
      limit: maxRequests,
      remaining: Math.max(0, maxRequests - 1),
      resetAtMs,
      retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)),
    };
  }

  if (existing.count >= maxRequests) {
    return {
      allowed: false,
      limit: maxRequests,
      remaining: 0,
      resetAtMs: existing.resetAtMs,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAtMs - now) / 1000)),
    };
  }

  existing.count += 1;
  store.entries.set(identifier, existing);

  return {
    allowed: true,
    limit: maxRequests,
    remaining: Math.max(0, maxRequests - existing.count),
    resetAtMs: existing.resetAtMs,
    retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAtMs - now) / 1000)),
  };
};

export const applyRateLimit = (
  req: NextApiRequest,
  res: NextApiResponse,
  options: RateLimitOptions
): boolean => {
  const identifier = getClientIp(req);
  const result = evaluateRateLimit(identifier, options);

  res.setHeader('X-RateLimit-Limit', String(result.limit));
  res.setHeader('X-RateLimit-Remaining', String(result.remaining));
  res.setHeader(
    'X-RateLimit-Reset',
    String(Math.max(0, Math.floor(result.resetAtMs / 1000)))
  );

  if (result.allowed) {
    return true;
  }

  res.setHeader('Retry-After', String(result.retryAfterSeconds));
  res.status(429).json({
    message: 'Rate limit exceeded. Please retry shortly.',
    retryAfterSeconds: result.retryAfterSeconds,
  });
  return false;
};
