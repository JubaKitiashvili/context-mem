import type { StoragePlugin, ContextEvent, EventPriority } from './types.js';
import { ulid } from './utils.js';

const EVENT_PRIORITIES: Record<string, EventPriority> = {
  task_start: 1,
  task_complete: 1,
  error: 1,
  file_modify: 2,
  decision: 2,
  dependency_change: 3,
  knowledge_save: 3,
  file_read: 4,
  search: 4,
};

export class EventTracker {
  constructor(private storage: StoragePlugin) {}

  emit(
    sessionId: string,
    eventType: string,
    data: Record<string, unknown> = {},
    agent?: string,
  ): ContextEvent {
    const priority = EVENT_PRIORITIES[eventType] || 4;
    const event: ContextEvent = {
      id: ulid(),
      session_id: sessionId,
      event_type: eventType,
      priority,
      agent,
      data,
      context_bytes: Buffer.byteLength(JSON.stringify(data), 'utf8'),
      timestamp: Date.now(),
    };

    this.storage.exec(
      'INSERT INTO events (id, session_id, event_type, priority, agent, data, context_bytes, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        event.id,
        event.session_id,
        event.event_type,
        event.priority,
        event.agent || null,
        JSON.stringify(event.data),
        event.context_bytes,
        event.timestamp,
      ],
    );

    return event;
  }

  query(
    sessionId: string,
    opts: {
      event_type?: string;
      priority?: EventPriority;
      limit?: number;
      from?: number;
      to?: number;
    } = {},
  ): ContextEvent[] {
    let sql = 'SELECT * FROM events WHERE session_id = ?';
    const params: unknown[] = [sessionId];

    if (opts.event_type) {
      sql += ' AND event_type = ?';
      params.push(opts.event_type);
    }
    if (opts.priority) {
      sql += ' AND priority <= ?';
      params.push(opts.priority);
    }
    if (opts.from !== undefined) {
      sql += ' AND timestamp >= ?';
      params.push(opts.from);
    }
    if (opts.to !== undefined) {
      sql += ' AND timestamp <= ?';
      params.push(opts.to);
    }

    sql += ' ORDER BY timestamp DESC, rowid DESC LIMIT ?';
    params.push(opts.limit || 50);

    const rows = this.storage.prepare(sql).all(...params) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: r.id as string,
      session_id: r.session_id as string,
      event_type: r.event_type as string,
      priority: r.priority as EventPriority,
      agent: r.agent as string | undefined,
      data: JSON.parse(r.data as string) as Record<string, unknown>,
      context_bytes: r.context_bytes as number,
      timestamp: r.timestamp as number,
    }));
  }

  detectErrorFix(
    sessionId: string,
  ): Array<{ error_event: string; fix_event: string; file: string }> {
    const events = this.query(sessionId, { limit: 100 });
    const fixes: Array<{ error_event: string; fix_event: string; file: string }> = [];

    // Walk events in chronological order (reverse since query returns DESC)
    const chronological = [...events].reverse();
    let lastError: ContextEvent | null = null;

    for (const evt of chronological) {
      if (evt.event_type === 'error') {
        lastError = evt;
      } else if (evt.event_type === 'file_modify' && lastError) {
        fixes.push({
          error_event: lastError.id,
          fix_event: evt.id,
          file: (evt.data.file as string) || 'unknown',
        });
        lastError = null;
      }
    }

    return fixes;
  }
}
