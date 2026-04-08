/**
 * Topic Detector — auto-classify observations into topics.
 *
 * Uses keyword matching against known topic categories,
 * entity types, and auto-tagger output to assign topics.
 */

import type { StoragePlugin } from './types.js';
import { ulid } from './utils.js';

export interface DetectedTopic {
  name: string;
  confidence: number;
}

// Known topic patterns: topic name → keyword patterns
const TOPIC_PATTERNS: Array<{ name: string; patterns: RegExp }> = [
  { name: 'auth', patterns: /\b(auth|login|logout|password|session|token|jwt|oauth|cookie|credential|permission|role|rbac)\b/i },
  { name: 'database', patterns: /\b(database|db|sql|query|migration|schema|table|index|postgres|mysql|sqlite|mongo|redis|orm|prisma|drizzle)\b/i },
  { name: 'api', patterns: /\b(api|endpoint|route|request|response|rest|graphql|grpc|webhook|cors|middleware)\b/i },
  { name: 'frontend', patterns: /\b(frontend|ui|ux|component|render|dom|css|style|layout|responsive|animation|react|vue|angular|svelte)\b/i },
  { name: 'backend', patterns: /\b(backend|server|service|handler|controller|worker|queue|cron|job|process)\b/i },
  { name: 'deployment', patterns: /\b(deploy|ci|cd|pipeline|docker|kubernetes|k8s|container|helm|terraform|infrastructure|cloud|aws|gcp|azure|vercel|netlify)\b/i },
  { name: 'testing', patterns: /\b(test|spec|jest|vitest|mocha|cypress|playwright|assertion|mock|stub|fixture|coverage|e2e|unit|integration)\b/i },
  { name: 'security', patterns: /\b(security|vulnerability|xss|csrf|injection|sanitize|encrypt|hash|ssl|tls|certificate|firewall)\b/i },
  { name: 'performance', patterns: /\b(performance|optimize|cache|latency|throughput|memory|cpu|profil|benchmark|slow|fast|bottleneck)\b/i },
  { name: 'config', patterns: /\b(config|setting|environment|env|variable|dotenv|yaml|toml|json config|.env)\b/i },
  { name: 'ci-cd', patterns: /\b(ci\/cd|github action|gitlab ci|jenkins|circleci|travis|workflow|build pipeline|artifact)\b/i },
  { name: 'monitoring', patterns: /\b(monitor|log|metric|alert|dashboard|sentry|datadog|prometheus|grafana|trace|observ)\b/i },
  { name: 'documentation', patterns: /\b(document|readme|changelog|adr|jsdoc|tsdoc|swagger|openapi|wiki)\b/i },
];

/**
 * Detect topics from content text.
 */
export function detectTopics(
  content: string,
  tags?: string[],
  entityNames?: string[],
): DetectedTopic[] {
  if (!content || !content.trim()) return [];

  const topics: DetectedTopic[] = [];
  const combined = [content, ...(tags || []), ...(entityNames || [])].join(' ');

  for (const { name, patterns } of TOPIC_PATTERNS) {
    const matches = combined.match(new RegExp(patterns.source, 'gi'));
    if (matches && matches.length > 0) {
      // Confidence based on number of keyword matches
      const confidence = Math.min(1.0, 0.5 + matches.length * 0.1);
      topics.push({ name, confidence });
    }
  }

  return topics;
}

/**
 * Store detected topics in the database, creating topic entries as needed.
 */
export function storeTopics(
  storage: StoragePlugin,
  observationId: string,
  topics: DetectedTopic[],
): void {
  for (const topic of topics) {
    // Ensure topic exists
    const existing = storage.prepare('SELECT id FROM topics WHERE name = ?').get(topic.name) as { id: string } | undefined;
    let topicId: string;

    if (existing) {
      topicId = existing.id;
      storage.exec(
        'UPDATE topics SET observation_count = observation_count + 1, last_seen = ? WHERE id = ?',
        [Date.now(), topicId],
      );
    } else {
      topicId = ulid();
      storage.exec(
        'INSERT INTO topics (id, name, observation_count, last_seen) VALUES (?, ?, 1, ?)',
        [topicId, topic.name, Date.now()],
      );
    }

    // Link observation to topic
    try {
      storage.exec(
        'INSERT OR IGNORE INTO observation_topics (observation_id, topic_id, confidence) VALUES (?, ?, ?)',
        [observationId, topicId, topic.confidence],
      );
    } catch {
      // Ignore duplicate constraint violations
    }
  }
}
