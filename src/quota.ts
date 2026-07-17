import fsp from "fs/promises";
import { config } from "./config.js";
import { getFilesDb } from "./db.js";
import { errMeta, log } from "./log.js";

export type QuotaVerdict =
  | { ok: true }
  | { ok: false; status: number; message: string; error: string };

const OK: QuotaVerdict = { ok: true };

const utcDay = (now = new Date()): string => now.toISOString().slice(0, 10);

/**
 * Free space is read once and reused for a short window. statfs on every upload
 * is a syscall per request to answer a question whose answer moves slowly.
 */
let diskCache: { freeBytes: number; totalBytes: number; at: number } | null = null;
const DISK_CACHE_MS = 5_000;

const readDisk = async (): Promise<{ freeBytes: number; totalBytes: number } | null> => {
  if (diskCache && Date.now() - diskCache.at < DISK_CACHE_MS) return diskCache;

  try {
    const stat = await fsp.statfs(config.dataDir);
    const freeBytes = Number(stat.bavail) * Number(stat.bsize);
    const totalBytes = Number(stat.blocks) * Number(stat.bsize);
    diskCache = { freeBytes, totalBytes, at: Date.now() };
    return diskCache;
  } catch (err) {
    log.warn("statfs_failed", errMeta(err));
    return null;
  }
};

/**
 * Refuses uploads before the disk is actually full.
 *
 * Files are never deleted here, so filling the disk is a matter of when. A full
 * disk does not merely fail uploads: SQLite cannot write either, so the whole
 * node goes down rather than the one endpoint that caused it. Stopping early
 * leaves room to notice and act.
 */
export const checkDiskSpace = async (): Promise<QuotaVerdict> => {
  const disk = await readDisk();
  if (!disk) return OK; // statfs unavailable: do not invent a failure

  const minByPercent = (disk.totalBytes * config.minFreeDiskPercent) / 100;
  const floor = Math.max(config.minFreeDiskBytes, minByPercent);

  if (disk.freeBytes < floor) {
    log.error("disk_space_low", {
      freeBytes: disk.freeBytes,
      requiredFree: Math.round(floor),
      totalBytes: disk.totalBytes,
    });
    return {
      ok: false,
      status: 507,
      message: "Insufficient storage on server",
      error: "INSUFFICIENT_STORAGE",
    };
  }

  return OK;
};

export const diskStats = async () => {
  const disk = await readDisk();
  if (!disk) return null;
  return {
    freeBytes: disk.freeBytes,
    totalBytes: disk.totalBytes,
    freePercent: Math.round((disk.freeBytes / disk.totalBytes) * 1000) / 10,
  };
};

/**
 * Identity for the budget, taken from the access service's response.
 *
 * Falls back to a single shared bucket rather than to per-token: tokens rotate
 * every few minutes, so keying on one would hand out a fresh budget on every
 * rotation and the ceiling would mean nothing.
 */
export const quotaSubject = (user: Record<string, unknown>): string => {
  const id = user._id ?? user.id ?? user.username;
  if (id === undefined || id === null || id === "") {
    log.warn("quota_subject_missing", { keys: Object.keys(user).slice(0, 10) });
    return "__unknown__";
  }
  return String(id);
};

interface DailyRow {
  count: number;
  bytes: number;
}

const usage = (day: string, userId: string): DailyRow => {
  const row = getFilesDb()
    .prepare("SELECT count, bytes FROM daily WHERE day = ? AND user_id = ?")
    .get(day, userId) as DailyRow | undefined;
  return row ?? { count: 0, bytes: 0 };
};

const overBudget = (used: DailyRow, incoming: number): QuotaVerdict => {
  if (
    config.maxUploadsPerUserPerDay > 0 &&
    used.count + (incoming > 0 ? 1 : 0) > config.maxUploadsPerUserPerDay
  ) {
    return {
      ok: false,
      status: 429,
      message: `Daily upload limit reached (${config.maxUploadsPerUserPerDay} files per day)`,
      error: "DAILY_LIMIT_REACHED",
    };
  }

  if (
    config.maxBytesPerUserPerDay > 0 &&
    used.bytes + incoming > config.maxBytesPerUserPerDay
  ) {
    return {
      ok: false,
      status: 429,
      message: `Daily upload size limit reached (${config.maxBytesPerUserPerDay} bytes per day)`,
      error: "DAILY_LIMIT_REACHED",
    };
  }

  return OK;
};

/**
 * Cheap pre-check, before the request body is read: the exact size is not known
 * until the stream ends, so this only catches a user who is already out of
 * budget. Worth it — it avoids receiving a 100MB body just to reject it.
 */
export const checkDailyQuota = (userId: string): QuotaVerdict =>
  overBudget(usage(utcDay(), userId), 0);

/** Second check, once the staged size is known. */
export const wouldExceedDailyQuota = (
  userId: string,
  incomingBytes: number
): QuotaVerdict => overBudget(usage(utcDay(), userId), incomingBytes);

/**
 * Counted after the files are durably in place, so a failed upload does not eat
 * anyone's budget. Upsert because every http worker writes this same row.
 */
export const recordUpload = (userId: string, count: number, bytes: number): void => {
  getFilesDb()
    .prepare(
      `INSERT INTO daily (day, user_id, count, bytes) VALUES (?, ?, ?, ?)
       ON CONFLICT(day, user_id) DO UPDATE SET
         count = count + excluded.count,
         bytes = bytes + excluded.bytes`
    )
    .run(utcDay(), userId, count, bytes);
};

/**
 * Counters, not data — the "never delete" rule covers files. Left alone, this
 * table grows by one row per active user per day forever.
 */
export const sweepDailyCounters = (keepDays = 7): number => {
  const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000);
  const result = getFilesDb()
    .prepare("DELETE FROM daily WHERE day < ?")
    .run(utcDay(cutoff));
  return result.changes;
};

export const dailyStats = () => {
  const day = utcDay();
  const row = getFilesDb()
    .prepare(
      "SELECT COUNT(*) AS users, SUM(count) AS count, SUM(bytes) AS bytes FROM daily WHERE day = ?"
    )
    .get(day) as { users: number; count: number | null; bytes: number | null };

  return {
    day,
    users: row.users,
    count: row.count ?? 0,
    bytes: row.bytes ?? 0,
    maxBytesPerUserPerDay: config.maxBytesPerUserPerDay,
    maxUploadsPerUserPerDay: config.maxUploadsPerUserPerDay,
  };
};
