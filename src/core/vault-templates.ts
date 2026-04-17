function fmtDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function fmtDateTime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
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
    ? backlinks.map(b => `- [[${b}]]`).join('\n')
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
  const entityLinks = topEntities.map(e => `- [[entities/${e.name}]]`).join('\n') || '_None yet._';
  const topicLinks = recentTopics.map(t => `- [[topics/${t.name}]]`).join('\n') || '_None yet._';
  const knowledgeLinks = recentKnowledge.map(k => `- [[knowledge/${k.id}]]  ${k.title}`).join('\n') || '_None yet._';
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

_Schema reference: [[schema.md]]_
`;
}

export function renderLogEntry(event: string, summary: string, timestamp: number): string {
  return `## [${fmtDateTime(timestamp)}] ${event} | ${summary}\n`;
}
