import crypto from "crypto";
import fsp from "fs/promises";
import path from "path";
import { config } from "./config.js";
import { getFilesDb } from "./db.js";

/**
 * `n1-202608-a3f2b8c19d4e`
 *
 * The node prefix is dead weight on a single box today. It is here so that
 * adding a second node later needs no id change and no data movement: any node
 * can tell from the id alone which node owns the file.
 */
export const makeFileId = (now = new Date()): string => {
  const ym = yearMonth(now);
  const rand = crypto.randomBytes(6).toString("hex");
  return `${config.nodeId}-${ym}-${rand}`;
};

export const yearMonth = (d: Date): string =>
  `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

const makeBucketId = (): string => crypto.randomBytes(5).toString("hex");

/**
 * Hands back the bucket that the next file belongs in, rolling to a fresh one
 * once the current bucket is full.
 *
 * Runs inside a transaction because every http worker races for the same
 * counter row. SQLite serialises writers anyway, so the lock costs nothing
 * beyond what an insert already pays.
 */
export const allocateBucket = (ym: string): string => {
  const db = getFilesDb();

  const tx = db.transaction((key: string): string => {
    const row = db
      .prepare("SELECT bucket, count FROM buckets WHERE ym = ?")
      .get(key) as { bucket: string; count: number } | undefined;

    if (!row) {
      const bucket = makeBucketId();
      db.prepare("INSERT INTO buckets (ym, bucket, count) VALUES (?, ?, 1)").run(
        key,
        bucket
      );
      return bucket;
    }

    if (row.count >= config.bucketSize) {
      const bucket = makeBucketId();
      db.prepare("UPDATE buckets SET bucket = ?, count = 1 WHERE ym = ?").run(
        bucket,
        key
      );
      return bucket;
    }

    db.prepare("UPDATE buckets SET count = count + 1 WHERE ym = ?").run(key);
    return row.bucket;
  });

  return tx(ym);
};

/** `2026/08/7fa39d4e2b/n1-202608-a3f2b8c19d4e.webp` */
export const buildRelPath = (
  now: Date,
  bucket: string,
  fileId: string,
  ext: string
): string => {
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const name = ext ? `${fileId}.${ext}` : fileId;
  return path.posix.join(year, month, bucket, name);
};

export const absoluteBlobPath = (relPath: string): string =>
  path.join(config.blobsDir, relPath);

/**
 * Extension taken from the *client's* filename, so it is attacker-controlled.
 * Only the shape is kept — never the name itself, which stays in the database.
 */
export const safeExtension = (filename: string): string => {
  const ext = path.extname(filename).slice(1).toLowerCase();
  return /^[a-z0-9]{1,12}$/.test(ext) ? ext : "";
};

export const tmpPath = (prefix: string): string =>
  path.join(config.tmpDir, `${prefix}-${crypto.randomBytes(8).toString("hex")}`);

/**
 * Containment check for the legacy tree, where paths still come from the URL.
 *
 * The previous implementation used `resolved.startsWith(root)`, which let
 * `/data/uploads-evil/x` through because it shares a string prefix with
 * `/data/uploads`. Comparing against `root + sep` is what actually tests for
 * "inside the directory". realpath then closes the symlink route.
 */
export const resolveInside = async (
  root: string,
  requested: string
): Promise<string | null> => {
  if (requested.includes("\0")) return null;

  const rootResolved = path.resolve(root);
  const candidate = path.resolve(rootResolved, requested);

  if (
    candidate !== rootResolved &&
    !candidate.startsWith(rootResolved + path.sep)
  ) {
    return null;
  }

  try {
    const realRoot = await fsp.realpath(rootResolved);
    const realCandidate = await fsp.realpath(candidate);
    if (
      realCandidate !== realRoot &&
      !realCandidate.startsWith(realRoot + path.sep)
    ) {
      return null;
    }
    return realCandidate;
  } catch {
    // Missing file: containment already held on the lexical path, so let the
    // caller's stat produce the 404.
    return candidate;
  }
};

export const ensureDirs = async (): Promise<void> => {
  await fsp.mkdir(config.blobsDir, { recursive: true });
  await fsp.mkdir(config.tmpDir, { recursive: true });
};

/**
 * Deletes leftovers from uploads that died mid-stream. Safe by construction:
 * nothing in tmp/ is ever referenced by the database — files only get a row
 * after they have been renamed into blobs/.
 */
export const sweepTmp = async (maxAgeMs: number): Promise<number> => {
  let removed = 0;
  const cutoff = Date.now() - maxAgeMs;

  let entries: string[];
  try {
    entries = await fsp.readdir(config.tmpDir);
  } catch {
    return 0;
  }

  for (const entry of entries) {
    const full = path.join(config.tmpDir, entry);
    try {
      const stat = await fsp.stat(full);
      if (stat.mtimeMs < cutoff) {
        await fsp.unlink(full);
        removed++;
      }
    } catch {
      /* raced with another sweep or an active upload; leave it */
    }
  }

  return removed;
};
