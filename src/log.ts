type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[(process.env.logLevel as Level) ?? "info"] ?? LEVELS.info;

let context: Record<string, unknown> = {};

/** Fields merged into every subsequent log line (node id, worker role, pid). */
export const setLogContext = (fields: Record<string, unknown>) => {
  context = { ...context, ...fields };
};

const emit = (level: Level, msg: string, meta?: Record<string, unknown>) => {
  if (LEVELS[level] < threshold) return;
  const line = JSON.stringify({
    level,
    msg,
    ts: new Date().toISOString(),
    ...context,
    ...meta,
  });
  if (level === "error" || level === "warn") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
};

export const log = {
  debug: (msg: string, meta?: Record<string, unknown>) => emit("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => emit("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit("error", msg, meta),
};

/** Errors are not JSON-serialisable by default; keep message and stack. */
export const errMeta = (err: unknown): Record<string, unknown> =>
  err instanceof Error
    ? { err: err.message, stack: err.stack }
    : { err: String(err) };
