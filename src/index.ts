import cluster from "cluster";
import { config, validateConfig } from "./config.js";
import { closeDatabases, openDatabases } from "./db.js";
import { ensureDirs, sweepTmp } from "./paths.js";
import { reclaimStaleJobs } from "./queue.js";
import { sweepDailyCounters } from "./quota.js";
import { startAccessCacheSweeper } from "./access.js";
import { startJobWorker } from "./jobWorker.js";
import { createServer } from "./server.js";
import { errMeta, log, setLogContext } from "./log.js";

const ROLE = "FS_ROLE";
const SHUTDOWN_GRACE_MS = 30_000;

const runPrimary = async (): Promise<void> => {
  validateConfig();
  await ensureDirs();

  openDatabases();
  // A worker killed mid-job leaves the row 'active' forever; nothing else ever
  // puts it back.
  reclaimStaleJobs();
  const swept = await sweepTmp(config.tmpSweepMaxAgeMs);
  // Quota counters, not files — the never-delete rule does not apply, and this
  // table would otherwise grow by a row per active user per day forever.
  const countersSwept = sweepDailyCounters();
  closeDatabases();

  log.info("primary_started", {
    port: config.port,
    dataDir: config.dataDir,
    httpWorkers: config.httpWorkers,
    jobWorkers: config.jobWorkers,
    bucketSize: config.bucketSize,
    maxFileSize: config.maxFileSize,
    legacyDir: config.legacyDir ?? "disabled",
    maxBytesPerUserPerDay: config.maxBytesPerUserPerDay,
    tmpSwept: swept,
    countersSwept,
  });

  const fork = (role: "http" | "job", index: number) => {
    const worker = cluster.fork({ [ROLE]: role, FS_WORKER_INDEX: String(index) });
    worker.on("exit", (code, signal) => {
      if (shuttingDown) return;
      log.error("worker_died", { role, index, code, signal });
      // Respawn, otherwise one crash silently reduces capacity until there is
      // none left.
      setTimeout(() => fork(role, index), 1000);
    });
  };

  for (let i = 0; i < config.httpWorkers; i++) fork("http", i);
  for (let i = 0; i < config.jobWorkers; i++) fork("job", i);

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("shutdown_initiated", { signal });

    for (const worker of Object.values(cluster.workers ?? {})) {
      worker?.process.kill("SIGTERM");
    }

    const force = setTimeout(() => {
      log.warn("shutdown_forced");
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    force.unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Periodic tmp sweep: uploads that die mid-stream leave a file behind, and
  // nothing in tmp/ is ever referenced by the database.
  const sweeper = setInterval(() => {
    sweepTmp(config.tmpSweepMaxAgeMs)
      .then((n) => n > 0 && log.info("tmp_swept", { removed: n }))
      .catch((err) => log.warn("tmp_sweep_failed", errMeta(err)));
  }, config.tmpSweepIntervalMs);
  sweeper.unref();
};

const runHttpWorker = (index: number): void => {
  setLogContext({ role: "http", worker: index, pid: process.pid });
  openDatabases();
  startAccessCacheSweeper();

  const server = createServer();

  // Every worker listens on the same port; the primary distributes connections.
  server.listen(config.port, () => {
    log.info("http_worker_listening", { port: config.port });
  });

  process.on("SIGTERM", () => {
    server.close(() => {
      closeDatabases();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS).unref();
  });
};

const runJobWorker = (index: number): void => {
  const workerId = `${config.nodeId}-job-${index}-${process.pid}`;
  setLogContext({ role: "job", worker: index, pid: process.pid });

  openDatabases();
  const stop = startJobWorker(workerId);
  log.info("job_worker_started", { workerId });

  process.on("SIGTERM", () => {
    stop();
    // Give an in-flight compression a moment to land before closing the db out
    // from under it.
    setTimeout(() => {
      closeDatabases();
      process.exit(0);
    }, 2000).unref();
  });
};

const main = async (): Promise<void> => {
  if (cluster.isPrimary) {
    await runPrimary();
    return;
  }

  const index = Number(process.env.FS_WORKER_INDEX ?? 0);
  if (process.env[ROLE] === "job") runJobWorker(index);
  else runHttpWorker(index);
};

main().catch((err) => {
  log.error("fatal", errMeta(err));
  process.exit(1);
});
