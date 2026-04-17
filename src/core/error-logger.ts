import type { StoragePlugin, ErrorCategory, ErrorSeverity, ErrorLogEntry, ErrorLogSummary } from './types.js';

// FNV-1a 32-bit — same hash the project already uses in utils.
function fnv1a(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16);
}

export interface ErrorLogContext {
  [key: string]: string | number | boolean | null | undefined;
}

export interface LogParams {
  severity: ErrorSeverity;
  category: ErrorCategory;
  message: string;
  error?: unknown;
  context?: ErrorLogContext;
}

export interface ErrorLoggerOptions {
  /** Milliseconds to collapse duplicate (category,message) into one row. Default 1000. */
  throttleMs?: number;
  /** Rows older than this are pruned. Default 7 days. */
  maxAgeMs?: number;
  /** Max total rows; oldest trimmed past cap. Default 10000. */
  maxRows?: number;
  /** Prune cadence. Default 5 min. */
  pruneIntervalMs?: number;
}

interface ThrottleEntry {
  lastSeen: number;
  /** Row id in DB. 0 means INSERT is still pending (setImmediate not yet fired). */
  id: number;
  /** Extra occurrences accumulated while id === 0 (INSERT pending). */
  pendingOccurrences: number;
}

const MESSAGE_MAX = 500;
const STACK_MAX = 2000;

/**
 * Registry: storage instance → active logger.
 * When a new ErrorLogger is created over the same storage, the previous one is deactivated
 * so stale setImmediate callbacks from it become no-ops.
 */
const storageRegistry = new WeakMap<StoragePlugin, ErrorLogger>();

export class ErrorLogger {
  private storage: StoragePlugin;
  private opts: Required<ErrorLoggerOptions>;
  private throttleCache = new Map<string, ThrottleEntry>();
  private pruneTimer: ReturnType<typeof setInterval> | null = null;
  /** Set to false when this logger is superseded or stopped; stale callbacks check this. */
  private active = true;

  constructor(storage: StoragePlugin, options: ErrorLoggerOptions = {}) {
    this.storage = storage;
    this.opts = {
      throttleMs: options.throttleMs ?? 1000,
      maxAgeMs: options.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000,
      maxRows: options.maxRows ?? 10_000,
      pruneIntervalMs: options.pruneIntervalMs ?? 5 * 60 * 1000,
    };

    // Deactivate any previous logger for the same storage so its pending setImmediate
    // callbacks don't fire after the new logger has taken over. Also stop its prune timer.
    const prev = storageRegistry.get(storage);
    if (prev && prev !== this) {
      prev.stop();
    }
    storageRegistry.set(storage, this);

    this.pruneTimer = setInterval(() => {
      try { this.prune(); } catch { /* logger must never throw */ }
    }, this.opts.pruneIntervalMs);
    (this.pruneTimer as unknown as { unref?: () => void }).unref?.();
  }

  /**
   * Get or create the active ErrorLogger for a storage instance.
   * Preferred over `new ErrorLogger(...)` for production code — guarantees a single
   * active logger per storage.
   */
  static instance(storage: StoragePlugin, options?: ErrorLoggerOptions): ErrorLogger {
    const existing = storageRegistry.get(storage);
    if (existing && existing.active) return existing;
    return new ErrorLogger(storage, options);
  }

  stop(): void {
    this.active = false;
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
  }

  private truncate(s: string, max: number): string {
    if (s.length <= max) return s;
    return s.slice(0, max - 1) + '\u2026';
  }

  private sanitizeStack(stack: string | undefined): string | undefined {
    if (!stack) return undefined;
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
    const sanitized = home ? stack.split(home).join('~') : stack;
    return this.truncate(sanitized, STACK_MAX);
  }

  log(params: LogParams): void {
    try {
      if (!this.active) return;
      const message = this.truncate(params.message, MESSAGE_MAX);
      const hash = fnv1a(`${params.category}|${message}`);
      const now = Date.now();
      const key = `${params.category}:${hash}`;

      const cached = this.throttleCache.get(key);
      if (cached && now - cached.lastSeen < this.opts.throttleMs) {
        cached.lastSeen = now;
        if (cached.id === 0) {
          // INSERT still pending — accumulate and let the setImmediate apply them
          cached.pendingOccurrences++;
        } else {
          try {
            this.storage.exec(
              `UPDATE error_log SET occurrences = occurrences + 1, last_seen = ? WHERE id = ?`,
              [now, cached.id],
            );
          } catch { /* logger must never throw */ }
        }
        return;
      }

      const stack =
        params.error instanceof Error ? this.sanitizeStack(params.error.stack) :
        typeof (params.error as { stack?: string })?.stack === 'string' ? this.sanitizeStack((params.error as { stack?: string }).stack) :
        undefined;

      const contextJson = params.context ? JSON.stringify(params.context) : null;

      // Pre-populate cache with id=0 (pending) so same-tick duplicates are throttled correctly.
      const entry: ThrottleEntry = { lastSeen: now, id: 0, pendingOccurrences: 0 };
      this.throttleCache.set(key, entry);
      // Capture active reference at time of log — closure checks it before inserting.
      const self = this;

      setImmediate(() => {
        if (!self.active) return;
        try {
          const result = self.storage.prepare(
            `INSERT INTO error_log (timestamp, severity, category, message, message_hash, context_json, stack, occurrences, first_seen, last_seen)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          ).run(now, params.severity, params.category, message, hash, contextJson, stack ?? null, now, now);
          const id = Number((result as { lastInsertRowid: number | bigint }).lastInsertRowid);
          entry.id = id;
          // Apply any occurrences that accumulated while id was 0
          if (entry.pendingOccurrences > 0) {
            try {
              self.storage.exec(
                `UPDATE error_log SET occurrences = occurrences + ?, last_seen = ? WHERE id = ?`,
                [entry.pendingOccurrences, entry.lastSeen, id],
              );
            } catch { /* logger must never throw */ }
          }
          if (self.throttleCache.size > 500) {
            const oldest = [...self.throttleCache.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen);
            for (const [k] of oldest.slice(0, self.throttleCache.size - 500)) {
              self.throttleCache.delete(k);
            }
          }
        } catch {
          // INSERT failed — evict cache entry so a future log attempts a fresh insert
          // (prevents pendingOccurrences from growing unboundedly on persistent DB errors).
          self.throttleCache.delete(key);
        }
      });
    } catch { /* logger must never throw */ }
  }

  error(category: ErrorCategory, err: unknown, context?: ErrorLogContext): void {
    const message = err instanceof Error ? err.message : String(err);
    this.log({ severity: 'error', category, message, error: err, context });
  }

  warn(category: ErrorCategory, message: string, context?: ErrorLogContext): void {
    this.log({ severity: 'warn', category, message, context });
  }

  query(opts: {
    since?: number;
    severity?: ErrorSeverity | ErrorSeverity[];
    category?: ErrorCategory | ErrorCategory[];
    limit?: number;
  } = {}): ErrorLogEntry[] {
    const clauses: string[] = [];
    const args: unknown[] = [];
    if (opts.since !== undefined) {
      clauses.push('timestamp >= ?');
      args.push(opts.since);
    }
    if (opts.severity !== undefined) {
      const arr = Array.isArray(opts.severity) ? opts.severity : [opts.severity];
      clauses.push(`severity IN (${arr.map(() => '?').join(',')})`);
      args.push(...arr);
    }
    if (opts.category !== undefined) {
      const arr = Array.isArray(opts.category) ? opts.category : [opts.category];
      clauses.push(`category IN (${arr.map(() => '?').join(',')})`);
      args.push(...arr);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = Math.max(1, Math.min(500, opts.limit ?? 50));
    try {
      const rows = this.storage.prepare(
        `SELECT id, timestamp, severity, category, message, message_hash, context_json, stack, occurrences, first_seen, last_seen
         FROM error_log ${where}
         ORDER BY timestamp DESC
         LIMIT ?`
      ).all(...args, limit) as ErrorLogEntry[];
      return rows;
    } catch {
      return [];
    }
  }

  summary(opts: { since?: number; limit?: number } = {}): ErrorLogSummary[] {
    const since = opts.since ?? 0;
    const limit = Math.max(1, Math.min(500, opts.limit ?? 50));
    try {
      // GROUP BY includes severity so the same (category, message) logged at different
      // levels is split into distinct summary rows with accurate severity.
      return this.storage.prepare(
        `SELECT category, message, severity, SUM(occurrences) as count, MIN(first_seen) as first_seen, MAX(last_seen) as last_seen
         FROM error_log
         WHERE timestamp >= ?
         GROUP BY category, message_hash, severity
         ORDER BY last_seen DESC
         LIMIT ?`
      ).all(since, limit) as ErrorLogSummary[];
    } catch {
      return [];
    }
  }

  prune(): void {
    try {
      const cutoff = Date.now() - this.opts.maxAgeMs;
      this.storage.exec('DELETE FROM error_log WHERE timestamp < ?', [cutoff]);
      const row = this.storage.prepare('SELECT COUNT(*) as c FROM error_log').get() as { c: number } | undefined;
      if (row && row.c > this.opts.maxRows) {
        const excess = row.c - this.opts.maxRows;
        this.storage.exec(
          `DELETE FROM error_log WHERE id IN (SELECT id FROM error_log ORDER BY timestamp ASC LIMIT ?)`,
          [excess],
        );
      }
    } catch { /* logger must never throw */ }
  }
}
