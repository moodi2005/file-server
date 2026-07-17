/**
 * Child process for queue.test.ts. Claims jobs until the queue is empty and
 * reports what it got. Not a test file itself — the runner's glob only picks up
 * *.test.js.
 */
import { openDatabases } from "../db.js";
import { claimJob } from "../queue.js";

openDatabases();

const workerId = process.argv[2] ?? "unknown";
const claimed: number[] = [];

for (;;) {
  const job = claimJob(workerId);
  if (!job) break;
  claimed.push(job.id);
}

process.stdout.write(JSON.stringify(claimed));
