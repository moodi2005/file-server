import { getJobsDb, JobRow } from "./db.js";
import { log } from "./log.js";

const MAX_ATTEMPTS = 5;
/** A job still 'active' after this long belongs to a worker that died. */
const STALE_ACTIVE_MS = 5 * 60 * 1000;

export const enqueue = (
  fileId: string,
  type: string,
  params: Record<string, unknown> = {}
): void => {
  getJobsDb()
    .prepare(
      `INSERT INTO jobs (file_id, type, params, state, run_after, created_at)
       VALUES (?, ?, ?, 'pending', 0, ?)`
    )
    .run(fileId, type, JSON.stringify(params), Date.now());
};

/**
 * Takes one job, or null if there is nothing due.
 *
 * The claim is a single UPDATE whose target is chosen by a subquery, so SQLite
 * holds the write lock across select-and-mark. Two workers cannot come away
 * with the same row — which a SELECT followed by an UPDATE would allow.
 */
export const claimJob = (worker: string): JobRow | null => {
  const now = Date.now();

  const row = getJobsDb()
    .prepare(
      `UPDATE jobs
          SET state = 'active', worker = ?, claimed_at = ?, attempts = attempts + 1
        WHERE id = (
          SELECT id FROM jobs
           WHERE state = 'pending' AND run_after <= ?
           ORDER BY id
           LIMIT 1
        )
        RETURNING *`
    )
    .get(worker, now, now) as JobRow | undefined;

  return row ?? null;
};

export const completeJob = (id: number): void => {
  getJobsDb().prepare("UPDATE jobs SET state = 'done' WHERE id = ?").run(id);
};

/**
 * Reschedules with exponential backoff, or parks the job once it has burned
 * through its attempts. A failed job never touches the file itself: the
 * original is still in place and still served.
 */
export const failJob = (job: JobRow, err: unknown): void => {
  const message = err instanceof Error ? err.message : String(err);

  if (job.attempts >= MAX_ATTEMPTS) {
    getJobsDb()
      .prepare("UPDATE jobs SET state = 'failed', error = ? WHERE id = ?")
      .run(message, job.id);
    log.error("job_failed_permanently", {
      jobId: job.id,
      fileId: job.file_id,
      type: job.type,
      attempts: job.attempts,
      err: message,
    });
    return;
  }

  const backoffMs = Math.min(2 ** job.attempts * 1000, 60_000);
  getJobsDb()
    .prepare(
      "UPDATE jobs SET state = 'pending', run_after = ?, error = ? WHERE id = ?"
    )
    .run(Date.now() + backoffMs, message, job.id);

  log.warn("job_retry_scheduled", {
    jobId: job.id,
    type: job.type,
    attempts: job.attempts,
    backoffMs,
    err: message,
  });
};

/**
 * Returns jobs orphaned by a worker that was killed mid-run. Called at boot;
 * without it those jobs sit 'active' forever and the work silently never happens.
 */
export const reclaimStaleJobs = (): number => {
  const result = getJobsDb()
    .prepare(
      `UPDATE jobs
          SET state = 'pending', worker = NULL, claimed_at = NULL
        WHERE state = 'active' AND claimed_at < ?`
    )
    .run(Date.now() - STALE_ACTIVE_MS);

  if (result.changes > 0) {
    log.warn("jobs_reclaimed", { count: result.changes });
  }
  return result.changes;
};

export const queueStats = () => {
  const row = getJobsDb()
    .prepare(
      `SELECT
         SUM(state = 'pending') AS pending,
         SUM(state = 'active')  AS active,
         SUM(state = 'failed')  AS failed
       FROM jobs`
    )
    .get() as { pending: number | null; active: number | null; failed: number | null };

  return {
    pending: row.pending ?? 0,
    active: row.active ?? 0,
    failed: row.failed ?? 0,
  };
};
