/**
 * HTTP client for the context-mem bridge.
 *
 * Uses Obsidian's `requestUrl` helper instead of raw `fetch` to avoid
 * CORS / mixed-content restrictions in the Electron renderer. All methods
 * return null on network / parse failure — they never throw.
 */
import { requestUrl, RequestUrlResponse } from 'obsidian';
import type { ContextMemSettings } from './settings';

export interface HealthResponse {
  ok: boolean;
  pid?: number;
  uptime?: number;
}

export interface ServiceInfoResponse {
  ok: boolean;
  service: string;
  version: string;
  description?: string;
  endpoints: Record<string, string>;
  dashboard: string;
  docs?: string;
}

export interface ObserveResponse {
  ok: boolean;
  enqueued?: boolean;
  error?: string;
}

/** Observation types accepted by the bridge (mirrors OBSERVATION_TYPES in core). */
export const OBSERVATION_TYPES = [
  'code',
  'log',
  'decision',
  'note',
  'conversation',
  'document',
  'snippet',
  'error',
  'metric',
  'event',
] as const;

export type ObservationType = typeof OBSERVATION_TYPES[number];

export class ContextMemBridge {
  private settings: ContextMemSettings;

  constructor(settings: ContextMemSettings) {
    this.settings = settings;
  }

  /** Update settings reference (called after user changes settings). */
  updateSettings(settings: ContextMemSettings): void {
    this.settings = settings;
  }

  private baseUrl(): string {
    return `http://${this.settings.bridgeHost}:${this.settings.bridgePort}`;
  }

  /**
   * GET /api/health
   * Liveness check — returns { ok, pid, uptime } or null on failure.
   */
  async health(): Promise<HealthResponse | null> {
    try {
      const res: RequestUrlResponse = await requestUrl({
        url: `${this.baseUrl()}/api/health`,
        method: 'GET',
        headers: { Accept: 'application/json' },
        // Don't throw on non-2xx; we inspect status ourselves
        throw: false,
      });
      if (res.status !== 200) return null;
      return res.json as HealthResponse;
    } catch {
      return null;
    }
  }

  /**
   * GET /
   * Returns service info including the dashboard URL.
   */
  async serviceInfo(): Promise<ServiceInfoResponse | null> {
    try {
      const res: RequestUrlResponse = await requestUrl({
        url: `${this.baseUrl()}/`,
        method: 'GET',
        headers: { Accept: 'application/json' },
        throw: false,
      });
      if (res.status !== 200) return null;
      return res.json as ServiceInfoResponse;
    } catch {
      return null;
    }
  }

  /**
   * POST /api/observe
   * Sends an observation to be ingested by context-mem.
   */
  async observe(
    content: string,
    type: string,
    source: string,
    filePath?: string
  ): Promise<ObserveResponse> {
    try {
      const body: Record<string, string> = { content, type, source };
      if (filePath) body.filePath = filePath;

      const res: RequestUrlResponse = await requestUrl({
        url: `${this.baseUrl()}/api/observe`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        throw: false,
      });

      if (res.status === 200) return res.json as ObserveResponse;

      // Bridge returned an error payload
      const payload = res.json as { ok?: boolean; error?: string };
      return { ok: false, error: payload?.error ?? `HTTP ${res.status}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  }

  /** Convenience: is the bridge currently reachable? */
  async isReachable(): Promise<boolean> {
    const h = await this.health();
    return h?.ok === true;
  }
}
