/**
 * Feedback Engine — tracks whether recalled memories led to action.
 *
 * After search results are returned, tracks result IDs. When a file_modify
 * event touches a file mentioned in search results, marks those results
 * as "useful". At session end, batch-updates last_useful_at and boosts
 * relevance_score for useful entries.
 */

import type { StoragePlugin } from './types.js';

interface TrackedResult {
  id: string;
  files_mentioned: string[];
  tracked_at: number;
}

export class FeedbackEngine {
  private trackedResults: TrackedResult[] = [];
  private usefulIds = new Set<string>();

  constructor(private storage: StoragePlugin) {}

  /**
   * Track search result IDs and their associated files.
   * Called after search/recall returns results.
   */
  trackSearchResults(resultIds: string[]): void {
    for (const id of resultIds) {
      // Look up files mentioned in observation metadata
      try {
        const row = this.storage.prepare(
          'SELECT metadata FROM observations WHERE id = ?'
        ).get(id) as { metadata: string } | undefined;

        if (row) {
          const meta = JSON.parse(row.metadata);
          const files: string[] = [];
          if (meta.file_path) files.push(meta.file_path);
          if (meta.files_modified) files.push(...meta.files_modified);

          this.trackedResults.push({
            id,
            files_mentioned: files,
            tracked_at: Date.now(),
          });
        }
      } catch {
        // Non-critical — skip this result
      }
    }
  }

  /**
   * Check if an event indicates usefulness of tracked results.
   * Called on file_modify events.
   */
  checkUsefulness(eventData: { file?: string; files?: string[] }): void {
    const modifiedFiles: string[] = [];
    if (eventData.file) modifiedFiles.push(eventData.file);
    if (eventData.files) modifiedFiles.push(...eventData.files);

    if (modifiedFiles.length === 0) return;

    for (const tracked of this.trackedResults) {
      if (this.usefulIds.has(tracked.id)) continue;

      // Check if any modified file matches tracked result's files
      for (const modified of modifiedFiles) {
        for (const mentioned of tracked.files_mentioned) {
          if (filesMatch(modified, mentioned)) {
            this.usefulIds.add(tracked.id);
            break;
          }
        }
        if (this.usefulIds.has(tracked.id)) break;
      }
    }
  }

  /**
   * Batch-update last_useful_at and boost relevance_score for useful entries.
   * Called at session end (handoff).
   */
  flushFeedback(): { updated_observations: number; updated_knowledge: number } {
    const now = Date.now();
    let updatedObs = 0;
    let updatedKnowledge = 0;

    for (const id of this.usefulIds) {
      try {
        // Update observations
        const obsResult = this.storage.prepare(
          'UPDATE observations SET last_useful_at = ? WHERE id = ?'
        ).run(now, id);
        if (obsResult.changes > 0) updatedObs++;

        // Also boost knowledge relevance if related
        // (search results from knowledge base have knowledge IDs)
        const knResult = this.storage.prepare(
          'UPDATE knowledge SET last_useful_at = ?, relevance_score = MIN(relevance_score * 1.1, 5.0) WHERE id = ?'
        ).run(now, id);
        if (knResult.changes > 0) updatedKnowledge++;
      } catch {
        // Non-critical
      }
    }

    // Clear tracked state
    this.trackedResults = [];
    this.usefulIds.clear();

    return { updated_observations: updatedObs, updated_knowledge: updatedKnowledge };
  }

  /**
   * Get current tracking state for testing.
   */
  getTrackedCount(): number {
    return this.trackedResults.length;
  }

  getUsefulCount(): number {
    return this.usefulIds.size;
  }
}

/**
 * Check if two file paths refer to the same file.
 * Handles partial path matching (e.g., "pipeline.ts" matches "src/core/pipeline.ts").
 */
function filesMatch(a: string, b: string): boolean {
  if (a === b) return true;
  // Check if one is a suffix of the other
  return a.endsWith(b) || b.endsWith(a);
}
