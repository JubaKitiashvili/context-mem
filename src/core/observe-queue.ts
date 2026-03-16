import { fnv1a64 } from './utils.js';
import type { ObservationType } from './types.js';

export interface QueueItem {
  content: string;
  type: ObservationType;
  source: string;
  filePath?: string;
}

const MAX_QUEUE_SIZE = 500;
const BATCH_SIZE = 50;
const DEDUP_WINDOW_MS = 60_000;

export class ObserveQueue {
  private queue: QueueItem[] = [];
  private dedupMap: Map<string, number> = new Map(); // hash → timestamp
  private onFlush: (items: QueueItem[]) => Promise<void>;
  private flushing = false;

  constructor(onFlush: (items: QueueItem[]) => Promise<void>) {
    this.onFlush = onFlush;
  }

  async enqueue(item: QueueItem): Promise<boolean> {
    const hash = fnv1a64(item.content);
    const now = Date.now();

    // Dedup check
    const lastSeen = this.dedupMap.get(hash);
    if (lastSeen !== undefined && (now - lastSeen) < DEDUP_WINDOW_MS) {
      return false; // Duplicate
    }

    // Clean old dedup entries
    for (const [key, ts] of this.dedupMap) {
      if (now - ts >= DEDUP_WINDOW_MS) this.dedupMap.delete(key);
    }

    this.dedupMap.set(hash, now);
    this.queue.push(item);

    // Evict oldest if over capacity
    if (this.queue.length > MAX_QUEUE_SIZE) {
      this.queue.shift();
    }

    // Auto-flush at batch size
    if (this.queue.length >= BATCH_SIZE) {
      await this.flush();
    }

    return true;
  }

  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;
    this.flushing = true;
    try {
      const items = this.queue.splice(0);
      await this.onFlush(items);
    } finally {
      this.flushing = false;
    }
  }

  get size(): number { return this.queue.length; }
}
