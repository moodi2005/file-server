import Database from "better-sqlite3";
import fs from "fs";
import { config } from "./config.js";

export interface FileRow {
  id: string;
  original_name: string;
  rel_path: string;
  mime: string;
  size: number;
  sha256: string;
  created_at: number;
  /** 1 for rows backfilled from the pre-rewrite uploads/ tree. */
  legacy: number;
}

export type JobState = "pending" | "active" | "done" | "failed";

export interface JobRow {
  id: number;
  file_id: string;
  type: string;
  params: string;
  state: JobState;
  attempts: number;
  run_after: number;
  claimed_at: number | null;
  worker: string | null;
  error: string | null;
}

/**
 * Two database files on purpose. SQLite takes one write lock per *database*,
 * and the queue writes constantly (insert, claim, finish). Sharing a file with
 * `files` would put every upload behind queue churn.
 */
let filesDb: Database.Database;
let jobsDb: Database.Database;

const applyPragmas = (db: Database.Database) => {
  db.pragma("journal_mode = WAL"); // readers never block on the writer
  db.pragma("synchronous = NORMAL"); // safe with WAL, far fewer fsyncs
  db.pragma("busy_timeout = 5000"); // wait rather than throw SQLITE_BUSY
  db.pragma("mmap_size = 268435456");
  db.pragma("cache_size = -64000");
  db.pragma("foreign_keys = ON");
};

export const openDatabases = () => {
  fs.mkdirSync(config.dataDir, { recursive: true });

  filesDb = new Database(config.filesDb);
  jobsDb = new Database(config.jobsDb);
  applyPragmas(filesDb);
  applyPragmas(jobsDb);

  // No secondary indexes: files are never searched or filtered, only fetched
  // by primary key. Every extra index would be write cost for nothing.
  filesDb.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id            TEXT PRIMARY KEY,
      original_name TEXT NOT NULL,
      rel_path      TEXT NOT NULL,
      mime          TEXT NOT NULL,
      size          INTEGER NOT NULL,
      sha256        TEXT NOT NULL,
      created_at    INTEGER NOT NULL,
      legacy        INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS buckets (
      ym       TEXT PRIMARY KEY,
      bucket   TEXT NOT NULL,
      count    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS legacy_paths (
      old_path TEXT PRIMARY KEY,
      file_id  TEXT NOT NULL
    );

    -- Upload budget per user per UTC day. Kept here, not in files: files
    -- deliberately record no owner, but a per-user ceiling needs a per-user
    -- counter. Old rows are swept — these are counters, not data.
    CREATE TABLE IF NOT EXISTS daily (
      day     TEXT NOT NULL,
      user_id TEXT NOT NULL,
      count   INTEGER NOT NULL,
      bytes   INTEGER NOT NULL,
      PRIMARY KEY (day, user_id)
    );
  `);

  jobsDb.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id    TEXT NOT NULL,
      type       TEXT NOT NULL,
      params     TEXT NOT NULL,
      state      TEXT NOT NULL DEFAULT 'pending',
      attempts   INTEGER NOT NULL DEFAULT 0,
      run_after  INTEGER NOT NULL DEFAULT 0,
      claimed_at INTEGER,
      worker     TEXT,
      error      TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS jobs_claim
      ON jobs (state, run_after, id);
  `);

  return { filesDb, jobsDb };
};

export const getFilesDb = () => filesDb;
export const getJobsDb = () => jobsDb;

export const closeDatabases = () => {
  try {
    filesDb?.close();
  } catch {
    /* already closed */
  }
  try {
    jobsDb?.close();
  } catch {
    /* already closed */
  }
};
