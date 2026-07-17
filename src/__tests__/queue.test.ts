import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { after, before, describe, it } from "node:test";

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));

let dataDir: string;

const JOBS = 200;
const WORKERS = 8;

before(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "fs-queue-"));
  process.env.dataDir = dataDir;

  // Imported after dataDir is set: config reads the environment once, at
  // module load.
  const { openDatabases, closeDatabases } = await import("../db.js");
  const { enqueue } = await import("../queue.js");

  openDatabases();
  for (let i = 0; i < JOBS; i++) {
    enqueue(`file-${i}`, "compress", { level: 5 });
  }
  closeDatabases();
});

after(async () => {
  await fsp.rm(dataDir, { recursive: true, force: true });
});

describe("job claim under concurrent workers", () => {
  /**
   * The reason claimJob is a single UPDATE with the target chosen by a
   * subquery: a SELECT followed by an UPDATE would let two workers read the
   * same pending row before either marked it, and the file would be compressed
   * twice — concurrently, over the same path.
   *
   * Real processes, because better-sqlite3 is synchronous and nothing inside
   * one process could ever interleave here.
   */
  it("hands every job to exactly one worker", async () => {
    const workerScript = path.join(here, "claimWorker.js");

    const results = await Promise.all(
      Array.from({ length: WORKERS }, (_, i) =>
        run(process.execPath, [workerScript, `w${i}`], {
          env: { ...process.env, dataDir },
        })
      )
    );

    const claims = results.flatMap((r) => JSON.parse(r.stdout) as number[]);

    const unique = new Set(claims);
    assert.equal(
      unique.size,
      claims.length,
      `a job was claimed more than once: ${claims.length - unique.size} duplicate(s)`
    );
    assert.equal(claims.length, JOBS, "every job should have been claimed once");
  });

  it("leaves nothing pending afterwards", async () => {
    const { openDatabases, closeDatabases } = await import("../db.js");
    const { queueStats } = await import("../queue.js");

    openDatabases();
    const stats = queueStats();
    closeDatabases();

    assert.equal(stats.pending, 0);
    assert.equal(stats.active, JOBS);
  });
});
