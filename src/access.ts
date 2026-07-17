import crypto from "crypto";
import { config } from "./config.js";
import { errMeta, log } from "./log.js";

export type AccessResult =
  | { ok: true; user: Record<string, unknown> }
  | { ok: false; status: number; body: unknown };

interface CacheEntry {
  result: AccessResult;
  expiresAt: number;
}

/**
 * Keyed by a hash rather than the token itself: a Map keyed by live tokens
 * hands every active credential to anyone who can read a heap dump.
 */
const cacheKey = (
  token: string,
  policy: string,
  part: string,
  onlyToken: boolean
): string =>
  crypto
    .createHash("sha256")
    .update(`${token}\0${policy}\0${part}\0${onlyToken}`)
    .digest("hex");

/** Same hash, truncated — safe to log, useless to replay. */
const tokenFingerprint = (token: string): string =>
  crypto.createHash("sha256").update(token).digest("hex").slice(0, 12);

/**
 * Insertion-ordered Map used as an LRU.
 *
 * The bound is the point: failures are cached too, so an unbounded map lets
 * anyone mint entries at will by spraying junk tokens until the worker runs out
 * of memory.
 */
const cache = new Map<string, CacheEntry>();

const cacheGet = (key: string): AccessResult | null => {
  const entry = cache.get(key);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }

  // Re-insert so eviction drops the coldest key.
  cache.delete(key);
  cache.set(key, entry);
  return entry.result;
};

const cacheSet = (key: string, result: AccessResult, ttlMs: number): void => {
  if (cache.size >= config.access.maxCacheEntries) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { result, expiresAt: Date.now() + ttlMs });
};

/**
 * Trips after repeated transport failures so a dead auth service costs one
 * timeout per reset window instead of one per request. Without it every
 * in-flight request sits on a 2s timeout and the workers fill with waiters.
 */
const breaker = { failures: 0, openUntil: 0 };

const breakerIsOpen = (): boolean => Date.now() < breaker.openUntil;

const breakerRecordFailure = (): void => {
  breaker.failures++;
  if (breaker.failures >= config.access.breakerThreshold) {
    breaker.openUntil = Date.now() + config.access.breakerResetMs;
    breaker.failures = 0;
    log.warn("access_breaker_open", { forMs: config.access.breakerResetMs });
  }
};

const breakerRecordSuccess = (): void => {
  breaker.failures = 0;
};

const SERVICE_UNAVAILABLE: AccessResult = {
  ok: false,
  status: 503,
  body: { message: "Auth service unavailable", error: "AUTH_UNAVAILABLE" },
};

/**
 * Verifies a token against the access service, with a short cache in front.
 *
 * Cache lifetime doubles as revocation delay, which is why it stays at ~10s to
 * match the other services rather than the hour a bigger cache would allow.
 */
export const verifyAccess = async (
  token: string,
  part: string,
  onlyToken: boolean
): Promise<AccessResult> => {
  const { url, policy, ttlMs, negativeTtlMs, timeoutMs } = config.access;

  if (!token || token.trim() === "") {
    return {
      ok: false,
      status: 401,
      body: { message: "Token not provided", error: "UNAUTHORIZED" },
    };
  }

  const key = cacheKey(token, policy, part, onlyToken);
  const cached = cacheGet(key);
  if (cached) return cached;

  if (breakerIsOpen()) return SERVICE_UNAVAILABLE;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        token,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ policy, part, onlyToken }),
      // fetch has no default timeout in Node; without this a hung auth service
      // hangs every upload behind it.
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    breakerRecordFailure();
    log.error("access_transport_failed", {
      part,
      token: tokenFingerprint(token),
      ...errMeta(err),
    });
    // Deliberately not cached: a network blip should not pin a 503 onto a
    // token for the whole TTL. The breaker handles the repeat cost.
    return SERVICE_UNAVAILABLE;
  }

  breakerRecordSuccess();

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    /* tolerated: some error responses carry no JSON body */
  }

  if (!response.ok) {
    const result: AccessResult = {
      ok: false,
      status: response.status,
      body: body ?? { message: "Access denied", error: "ACCESS_DENIED" },
    };
    // Negative caching, on a longer ttl than success: without it, a flood of
    // junk tokens turns this server into an amplifier aimed at the auth service.
    cacheSet(key, result, negativeTtlMs);
    return result;
  }

  if (!body || typeof body !== "object") {
    log.error("access_invalid_body", { part, token: tokenFingerprint(token) });
    return {
      ok: false,
      status: 502,
      body: { message: "Invalid response from access service", error: "BAD_GATEWAY" },
    };
  }

  const result: AccessResult = { ok: true, user: body as Record<string, unknown> };
  cacheSet(key, result, ttlMs);
  return result;
};

/**
 * Periodic eviction of expired entries. cacheGet already drops them lazily;
 * this only reclaims keys that are never looked up again.
 */
export const startAccessCacheSweeper = (): NodeJS.Timeout => {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (now > entry.expiresAt) cache.delete(key);
    }
  }, Math.max(config.access.ttlMs, 5_000));

  // unref, or this timer keeps the event loop alive and graceful shutdown hangs.
  timer.unref();
  return timer;
};

export const accessCacheStats = () => ({
  size: cache.size,
  breakerOpen: breakerIsOpen(),
});

/** Test hook. */
export const __resetAccessCache = () => {
  cache.clear();
  breaker.failures = 0;
  breaker.openUntil = 0;
};
