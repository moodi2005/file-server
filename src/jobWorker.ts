import sharp from "sharp";
import { claimJob, completeJob, failJob } from "./queue.js";
import { runCompression, CompressParams } from "./compress.js";
import { errMeta, log } from "./log.js";

const IDLE_POLL_MS = 500;

/**
 * Each job worker is its own process, so libvips gets one thread here rather
 * than filling the pool. jobWorkers × 1 thread is then the whole compression
 * footprint, and it cannot crowd out the http workers.
 */
sharp.concurrency(1);
sharp.cache(false);

const runJob = async (type: string, fileId: string, params: unknown): Promise<void> => {
  switch (type) {
    case "compress":
      return runCompression(fileId, params as CompressParams);
    default:
      throw new Error(`unknown job type: ${type}`);
  }
};

export const startJobWorker = (workerId: string): (() => void) => {
  let running = true;
  let timer: NodeJS.Timeout | null = null;

  const loop = async (): Promise<void> => {
    while (running) {
      const job = claimJob(workerId);

      if (!job) {
        await new Promise<void>((resolve) => {
          timer = setTimeout(resolve, IDLE_POLL_MS);
          timer.unref();
        });
        continue;
      }

      try {
        await runJob(job.type, job.file_id, JSON.parse(job.params));
        completeJob(job.id);
      } catch (err) {
        // Never fatal: the source file is untouched and still served, the job
        // just retries or eventually parks in 'failed'.
        failJob(job, err);
        log.warn("job_attempt_failed", {
          jobId: job.id,
          type: job.type,
          fileId: job.file_id,
          ...errMeta(err),
        });
      }
    }
  };

  loop().catch((err) => {
    log.error("job_worker_crashed", errMeta(err));
    process.exit(1);
  });

  return () => {
    running = false;
    if (timer) clearTimeout(timer);
  };
};
