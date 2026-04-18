function fmtDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function fmtDateTime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
}

export function safeName(name: string): string {
  const cleaned = name
    .replace(/[/\\:]/g, '-')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\.\./g, '--')
    .trim();
  if (!cleaned || /^[-.]+$/.test(cleaned)) return '_unnamed';
  return cleaned.slice(0, 200);
}

export interface EntityRow {
  id: string;
  name: string;
  entity_type: string;
  metadata: string;
  knowledge_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface TopicRow {
  id: string;
  name: string;
  parent_id: string | null;
  observation_count: number;
  last_seen: number | null;
}

export interface ObsRow {
  id: string;
  type: string;
  content: string;
  summary: string | null;
  indexed_at: number;
  session_id: string | null;
}

export interface KnowledgeRow {
  id: string;
  category: string;
  title: string;
  content: string;
  tags: string;
  access_count: number;
  created_at: number;
}

export function renderEntityPage(entity: EntityRow, backlinks: string[]): string {
  const meta = (() => { try { return JSON.parse(entity.metadata); } catch { return {}; } })();
  const backlinkSection = backlinks.length > 0
    ? backlinks.map(b => `- [[entities/${safeName(b)}]]`).join('\n')
    : '_No backlinks yet._';
  return `# ${entity.name}

- **Type:** ${entity.entity_type}
- **Created:** ${fmtDate(entity.created_at)}
- **Updated:** ${fmtDate(entity.updated_at)}

## Backlinks

${backlinkSection}

## Metadata

\`\`\`json
${JSON.stringify(meta, null, 2)}
\`\`\`
`;
}

export function renderTopicPage(topic: TopicRow, observations: ObsRow[]): string {
  const shown = observations.slice(0, 20);
  const obsList = shown.length > 0
    ? shown.map(o => `- [${fmtDate(o.indexed_at)}] ${o.summary ?? o.content.slice(0, 120)}`).join('\n')
    : '_No observations yet._';
  return `# ${topic.name}

- **Observations:** ${topic.observation_count}
- **Last seen:** ${topic.last_seen ? fmtDate(topic.last_seen) : 'never'}

## Observations

${obsList}
`;
}

export function renderSessionPage(sessionId: string, observations: ObsRow[]): string {
  const date = observations.length > 0 ? fmtDate(observations[0].indexed_at) : fmtDate(Date.now());
  const items = observations.map(o => `- [${o.type}] ${o.summary ?? o.content.slice(0, 120)}`).join('\n');
  return `# Session ${sessionId}

- **Date:** ${date}
- **Observations:** ${observations.length}

## Observations

${items || '_No observations._'}
`;
}

export function renderKnowledgePage(k: KnowledgeRow): string {
  const tags = (() => { try { return (JSON.parse(k.tags) as string[]).join(', '); } catch { return k.tags; } })();
  return `# ${k.title}

- **Category:** ${k.category}
- **Created:** ${fmtDate(k.created_at)}
- **Tags:** ${tags || 'none'}
- **Access count:** ${k.access_count}

## Content

${k.content}
`;
}

export interface IndexCounts {
  observations: number;
  entities: number;
  topics: number;
  knowledge: number;
  sessions: number;
}

export function renderIndex(
  counts: IndexCounts,
  topEntities: EntityRow[],
  recentTopics: TopicRow[],
  recentKnowledge: KnowledgeRow[],
): string {
  const entityLinks = topEntities.map(e => `- [[entities/${safeName(e.name)}]] — updated ${fmtDate(e.updated_at)}`).join('\n') || '_None yet._';
  const topicLinks = recentTopics.map(t => `- [[topics/${safeName(t.name)}]] — ${t.observation_count} observations`).join('\n') || '_None yet._';
  const knowledgeLinks = recentKnowledge.map(k => `- [[knowledge/${safeName(k.id)}]]  ${k.title}`).join('\n') || '_None yet._';
  const now = fmtDateTime(Date.now());
  return `# Context-Mem Vault

> Auto-generated. Last updated: ${now}

## Counts

| Table | Rows |
|-------|------|
| Observations | ${counts.observations} |
| Entities | ${counts.entities} |
| Topics | ${counts.topics} |
| Knowledge | ${counts.knowledge} |
| Sessions | ${counts.sessions} |

## Top Entities

${entityLinks}

## Recent Topics

${topicLinks}

## Recent Knowledge

${knowledgeLinks}

---

_Schema reference: see \`docs/llm-wiki-schema.md\` in the context-mem repository._
`;
}

export function renderLogEntry(event: string, summary: string, timestamp: number): string {
  return `## [${fmtDateTime(timestamp)}] ${event} | ${summary}\n`;
}

// ---------------------------------------------------------------------------
// Answer-as-Page (T4.5)
// ---------------------------------------------------------------------------

export interface AnswerPage {
  id: string;
  question: string;
  answer: string;
  sources: Array<{ id: string; title?: string; snippet?: string }>;
  createdAt: number;
  knowledgeId?: string;
}

export function renderAnswerPage(a: AnswerPage): string {
  const sourceLines = a.sources.map((s, i) => {
    const label = s.title ?? (s.snippet ? s.snippet.slice(0, 80) : s.id);
    return `${i + 1}. [[observations/${safeName(s.id)}]] — ${label}`;
  }).join('\n');

  const knowledgeLine = a.knowledgeId
    ? `- Filed as knowledge entry: [[knowledge/${safeName(a.knowledgeId)}]]`
    : '';

  return `# Q: ${a.question}

**Answered:** ${fmtDateTime(a.createdAt)}
**Answer ID:** \`${a.id}\`

## Answer

${a.answer}

## Sources

${sourceLines || '_No sources._'}

## Context

${knowledgeLine}
- Re-asked? This page is overwritten only when explicitly re-filed; otherwise it accrues as history.
`;
}
