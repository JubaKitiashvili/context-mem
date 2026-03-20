import type { StoragePlugin, BudgetConfig, BudgetStatus, OverflowStrategy } from './types.js';

export class BudgetManager {
  constructor(private storage: StoragePlugin) {}

  configure(config: Partial<BudgetConfig>): void {
    const current = this.getConfig();
    const updated: BudgetConfig = { ...current, ...config };

    this.storage.exec(
      'INSERT OR REPLACE INTO budget_settings (id, session_limit, overflow_strategy, agent_limits) VALUES (?, ?, ?, ?)',
      [
        1,
        updated.session_limit,
        updated.overflow_strategy,
        updated.agent_limits ? JSON.stringify(updated.agent_limits) : null,
      ],
    );
  }

  check(sessionId: string): BudgetStatus {
    const config = this.getConfig();

    const row = this.storage
      .prepare('SELECT COALESCE(SUM(tokens_in), 0) AS used FROM token_stats WHERE session_id = ?')
      .get(sessionId) as { used: number } | undefined;

    const used = row?.used ?? 0;
    const percentage = config.session_limit > 0 ? (used / config.session_limit) * 100 : 0;

    const status: BudgetStatus = {
      used,
      limit: config.session_limit,
      percentage,
      strategy: config.overflow_strategy,
      throttled: percentage >= 80,
      // Only hard_stop actually blocks. aggressive_truncation and warn allow observations through.
      blocked: percentage >= 100 && config.overflow_strategy === 'hard_stop',
    };

    if (percentage >= 90) {
      status.signal = 'CRITICAL: Context 90%+ full. Call restore_session NOW to save state before context is lost.';
    } else if (percentage >= 80) {
      status.signal = 'WARNING: Context 80%+ full. Consider calling restore_session to save state and reclaim context.';
    } else if (percentage >= 60) {
      status.signal = 'Context 60% used. No action needed yet.';
    }

    return status;
  }

  record(_sessionId: string, _bytes: number): void {
    // Budget tracking is handled via token_stats table.
    // This method exists as a hook for additional budget-specific metrics.
  }

  getStatus(sessionId: string): BudgetStatus {
    return this.check(sessionId);
  }

  getConfig(): BudgetConfig {
    const row = this.storage
      .prepare('SELECT session_limit, overflow_strategy, agent_limits FROM budget_settings WHERE id = 1')
      .get() as { session_limit: number; overflow_strategy: OverflowStrategy; agent_limits: string | null } | undefined;

    if (!row) {
      return {
        session_limit: 128_000,
        overflow_strategy: 'warn',
      };
    }

    return {
      session_limit: row.session_limit,
      overflow_strategy: row.overflow_strategy,
      agent_limits: row.agent_limits ? (JSON.parse(row.agent_limits) as Record<string, number>) : undefined,
    };
  }
}
