import fs from "fs";
import os from "os";
import path from "path";

const int = (v: string | undefined, fallback: number): number => {
  if (v === undefined || v.trim() === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`expected a positive number, got "${v}"`);
  }
  return Math.floor(n);
};

/**
 * os.cpus() reports the *host's* cores, not the container's cpu limit. Forking
 * one worker per host core inside a 2-cpu container buries the machine, so read
 * the cgroup quota when there is one. An explicit httpWorkers always wins.
 */
const detectCores = (): number => {
  const read = (p: string): string | null => {
    try {
      return fs.readFileSync(p, "utf8").trim();
    } catch {
      return null;
    }
  };

  // cgroup v2: "<quota> <period>", quota is "max" when unlimited.
  const v2 = read("/sys/fs/cgroup/cpu.max");
  if (v2) {
    const [quota, period] = v2.split(/\s+/);
    if (quota !== "max") {
      const cores = Math.floor(Number(quota) / Number(period));
      if (Number.isFinite(cores) && cores > 0) return cores;
    }
  }

  // cgroup v1: quota of -1 means unlimited.
  const quotaV1 = read("/sys/fs/cgroup/cpu/cpu.cfs_quota_us");
  const periodV1 = read("/sys/fs/cgroup/cpu/cpu.cfs_period_us");
  if (quotaV1 && periodV1 && quotaV1 !== "-1") {
    const cores = Math.floor(Number(quotaV1) / Number(periodV1));
    if (Number.isFinite(cores) && cores > 0) return cores;
  }

  return os.availableParallelism?.() ?? os.cpus().length;
};

const dataDir = path.resolve(process.env.dataDir ?? "./data");

export const config = {
  port: int(process.env.port, 2005),
  nodeId: process.env.nodeId ?? "n1",

  // tmp MUST sit inside dataDir: the whole design leans on rename() being
  // atomic, and rename across filesystems fails with EXDEV.
  dataDir,
  blobsDir: path.join(dataDir, "blobs"),
  tmpDir: path.join(dataDir, "tmp"),
  filesDb: path.join(dataDir, "files.db"),
  jobsDb: path.join(dataDir, "jobs.db"),

  // The pre-rewrite tree. Served read-only and never written to, so urls handed
  // out by the old server keep resolving. Unset it to turn the route off.
  legacyDir: process.env.legacyDir ? path.resolve(process.env.legacyDir) : null,
  legacyUrlPrefix: process.env.legacyUrlPrefix ?? "download",

  httpWorkers: process.env.httpWorkers
    ? int(process.env.httpWorkers, 1)
    : detectCores(),
  jobWorkers: int(process.env.jobWorkers, 2),

  bucketSize: int(process.env.bucketSize, 5000),
  maxFileSize: int(process.env.maxFileSize, 100 * 1024 * 1024),
  maxFilesPerRequest: int(process.env.maxFilesPerRequest, 10),

  // Per user, per day, rather than lifetime. Files are never deleted, so the
  // only useful question is how fast the disk can be consumed — and a lifetime
  // cap would eventually lock the server permanently. 0 disables either limit.
  maxBytesPerUserPerDay: int(
    process.env.maxBytesPerUserPerDay,
    3 * 1024 * 1024 * 1024
  ),
  maxUploadsPerUserPerDay: int(process.env.maxUploadsPerUserPerDay, 10_000),

  // Stop before the disk is actually full: SQLite cannot write on a full disk
  // either, so the whole node goes down rather than just uploads.
  minFreeDiskBytes: int(process.env.minFreeDiskBytes, 5 * 1024 * 1024 * 1024),
  minFreeDiskPercent: int(process.env.minFreeDiskPercent, 5),

  access: {
    url: process.env.accessUrl ?? "",
    policy: process.env.accessPolicy ?? "fileServer",
    partUpload: process.env.accessPartUpload ?? "upload",
    partDownload: process.env.accessPartDownload ?? "download",
    ttlMs: int(process.env.accessCacheTtl, 10_000),
    negativeTtlMs: int(process.env.accessNegativeCacheTtl, 60_000),
    timeoutMs: int(process.env.accessTimeout, 2_000),
    maxCacheEntries: int(process.env.accessCacheMax, 10_000),
    // Consecutive transport failures before the breaker opens.
    breakerThreshold: int(process.env.accessBreakerThreshold, 5),
    breakerResetMs: int(process.env.accessBreakerReset, 10_000),
  },

  tmpSweepMaxAgeMs: int(process.env.tmpSweepMaxAge, 6 * 60 * 60 * 1000),
  tmpSweepIntervalMs: int(process.env.tmpSweepInterval, 60 * 60 * 1000),

  compressibleFormats: ["png", "jpg", "jpeg", "webp"] as const,
} as const;

/**
 * Boot-time validation. The old server treated a missing token env as "auth
 * disabled" and happily served the internet; anything missing here is fatal
 * instead.
 */
export const validateConfig = (): void => {
  const problems: string[] = [];

  if (!config.access.url) {
    problems.push("accessUrl is required — refusing to start without an auth endpoint");
  } else {
    try {
      const u = new URL(config.access.url);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        problems.push(`accessUrl must be http(s), got ${u.protocol}`);
      }
    } catch {
      problems.push(`accessUrl is not a valid URL: ${config.access.url}`);
    }
  }

  if (config.maxFileSize > 5 * 1024 * 1024 * 1024) {
    problems.push("maxFileSize above 5GB is not supported");
  }
  if (config.access.ttlMs > 60 * 60 * 1000) {
    problems.push("accessCacheTtl above 1h would delay revocation too long");
  }

  if (problems.length > 0) {
    throw new Error("invalid configuration:\n  - " + problems.join("\n  - "));
  }
};
