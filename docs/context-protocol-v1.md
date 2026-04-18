# Context Protocol v1 (Draft RFC)

**Version:** 1.0 (Draft)
**Status:** RFC — open for community review
**Published with:** context-mem v4.0.0 (target 2026-05-22)
**Authors:** Juba Kitiashvili (initial draft), [Community contributors welcome]
**License:** MIT (spec); reference implementation is MIT

---

## Abstract

Context Protocol defines the interface for interoperable AI memory and context systems. It specifies how a compliant implementation stores observations, models entities and topics, answers queries, and exposes its memory surface to external tools and frameworks. The protocol is structured as three layers: an HTTP bridge for lightweight ingestion (Layer A), an MCP tool surface for tool-invocation clients (Layer B), and a Markdown vault for filesystem-level interop (Layer C). Context Protocol extends the Model Context Protocol (MCP) with a memory-oriented vocabulary—observations, entities, topics, knowledge entries, synthesis pages, and vault interop—and establishes the identity, privacy, and versioning contracts that a memory system must satisfy to be called compatible.

---

## 1. Motivation

### 1.1 MCP is about tools; Context Protocol is about state

MCP defines how clients discover and invoke tools on a server. It is transport-agnostic, schema-driven, and deliberately content-neutral. MCP works well when the unit of interaction is a discrete operation: "run this query," "read this file," "call this API."

Memory systems are different. Their value comes not from individual operations but from the accumulated state across many operations: what has been observed, what has been learned, how entities relate to one another, which facts are current. Two MCP servers that each expose a `search` tool are interoperable at the invocation level but may return incompatible result shapes, use different ID schemes, store different resource types, and apply different privacy rules. An agent that switches memory backends mid-session, or that federates across two memory providers, has no standard to rely on.

Context Protocol fills that gap. It defines the resource model, operation semantics, identity scheme, privacy taxonomy, and vault format that memory systems MUST agree on to be genuinely interoperable—not just syntactically compatible.

### 1.2 Why now

Two converging forces make this the right time to publish a v1 spec.

First, Andrej Karpathy's "LLM Wiki" gist (2026-04-04) articulated a now-widely-cited model for LLM memory: raw sources (immutable), wiki pages (LLM-maintained synthesis), and schema (the interop contract). context-mem implements this model at production scale; the vault format it has converged on is described in `docs/llm-wiki-schema.md`. That document specifies the filesystem projection; the present document specifies the protocol surface above it.

Second, the ecosystem of agent frameworks (LangChain, CrewAI, AutoGen, Cursor, Cline, Windsurf, VS Code Copilot) is fragmenting around incompatible memory backends. IDE plugins write to proprietary stores. Agent orchestrators implement bespoke recall patterns. Publishing a minimal, open spec now—before this fragmentation hardens—gives the community a convergence point without requiring framework adoption or a central authority.

### 1.3 Non-goals for v1

- Real-time synchronization between two simultaneously-writing clients (v2+ work; CRDT considerations noted in §12).
- Remote multi-tenant deployment (the protocol is local-first by default; §9).
- A new transport. Context Protocol is layered on top of MCP and HTTP, not a replacement for either.
- Enforcement. This is a community spec; compatibility is claimed voluntarily.

---

## 2. Terminology

**Observation.** The atomic unit of memory. A single piece of content—code, a conversation turn, a decision, a log line, a fact—recorded with a type, a source, a session identifier, and a timestamp. Observations are immutable after creation. An observation has a unique ULID identifier and a `privacy_level`.

**Entity.** A named thing that recurs across observations: a person, a project, a file path, an organization, a software system. Entities are extracted from observations by the pipeline (deterministically, without LLM) and maintained in the entity graph. Each entity has a canonical name, one or more aliases, a type, and a set of relationships to other entities.

**Topic.** A thematic cluster that groups observations sharing a detected concept, domain, or recurring concern. Topics are detected automatically; a single observation may belong to multiple topics. Topic pages aggregate the N most recent observations for that theme.

**Knowledge Entry.** A promoted, explicitly-saved fact or reference. Unlike observations (which are created passively from the stream of context), knowledge entries are created by deliberate tool calls (`save_knowledge`, `promote_knowledge`) and are intended to outlast the session. A knowledge entry has a category, a title, tags, a `valid_from`/`valid_to` temporal window, and a `source_type` (`explicit`, `inferred`, or `observed`).

**Synthesis Page.** A vault Markdown file produced by combining multiple observations or knowledge entries into a narrative. Synthesis pages reside in `answers/` (answer pages from `ask`) or are filed by `search(..., file_as: 'knowledge')`. They are indexed in the knowledge base and linked from `index.md`.

**Vault.** The filesystem projection of the memory store—a directory tree of plain Markdown files organized into `sources/`, `entities/`, `topics/`, `knowledge/`, and `answers/` subdirectories. The vault is the Layer C interop surface and is described in full in `docs/llm-wiki-schema.md`.

**Source (session).** A session-scoped record in `sources/` that holds all observations made during one agent or user session. Session files are immutable after the session ends; they form the ground-truth audit trail from which entity pages and topic pages are derived.

**Event Log.** `log.md` in the vault root—an append-only journal of pipeline events (`ingest`, `entity_update`, `topic_update`, `knowledge_promote`, etc.). Never truncated.

**Privacy Level.** A per-resource classification: `public` (default), `redacted` (content matched by privacy regex is stripped), or `private` (stripped from all derived artifacts including the vault and LLM prompts; deleted at session end). See §6 for the full privacy model.

**Importance Score.** A real number in [0.0, 1.0] assigned to each observation by the importance classifier. Observations scoring below 0.3 are down-weighted by the noise filter but retained. High importance scores indicate decisions, pivots, milestones, or error conditions.

**Compression Tier.** One of `none`, `light`, `heavy`, or `stripped`. Determines how aggressively the pipeline summarizes an observation before storage. Set by the token-economics manager based on session budget utilization.

For the page-level on-disk format of entity, topic, knowledge, session, index, and log pages, refer to `docs/llm-wiki-schema.md` (this repository), which is the normative specification for the vault layer.

---

## 3. Protocol Layers

Context Protocol is organized as three layers. Each layer is independently useful; a compliant implementation may expose only Layers A and B without a vault, or only Layer B, provided it satisfies the minimum tool surface (§8).

```
┌─────────────────────────────────────────────┐
│  Layer C — Vault Interop (filesystem)       │
│     Markdown + wikilinks + schema.md        │
│     .context-mem/vault/                     │
├─────────────────────────────────────────────┤
│  Layer B — MCP Tool Surface (stdio / SSE)   │
│     45+ tools: observe, search, ask, ...    │
│     Protocol: MCP (JSON-RPC 2.0)            │
├─────────────────────────────────────────────┤
│  Layer A — HTTP Bridge (TCP 51894)          │
│     POST /api/observe, GET /api/health      │
│     GET /api — service info + version       │
└─────────────────────────────────────────────┘
```

### 3.1 Layer A — HTTP Bridge

The HTTP bridge is a lightweight ingestion and liveness surface designed for editor hooks, git hooks, CI pipelines, and any process that cannot maintain an MCP stdio connection.

**Transport:** HTTP/1.1, bound to `127.0.0.1` only by default. Port 51894 is the Context Protocol reference port. An implementation MAY use a different port but MUST publish the actual port in the `GET /api` service info response.

**Identity contract:** `GET /api` returns a JSON object with at minimum:

```json
{
  "service": "context-mem HTTP bridge",
  "version": "<bridge_version>",
  "protocol": "context-protocol/1.0",
  "endpoints": { ... },
  "dashboard": "http://127.0.0.1:<dashboard_port>"
}
```

The `protocol` field is the Context Protocol version string. Clients that negotiate compatibility MUST check this field.

**Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/observe` | Queue one observation for ingestion. Body: `{content, type, source?, filePath?}`. Returns `{ok, enqueued}`. |
| `GET` | `/api/health` | Liveness check. Returns `{ok, pid, uptime}`. |
| `GET` | `/api` or `GET /` | Service info. Returns the identity object above. |

The HTTP bridge is stateless across requests; sessions are identified server-side by the kernel's current `session_id`. The bridge does not expose query operations in v1—those are Layer B (MCP tool surface). Extending the HTTP bridge with query endpoints (`GET /api/search`, `GET /api/ask`) is a v1.1 candidate (§12).

### 3.2 Layer B — MCP Tool Surface

The MCP tool surface is the primary interface for interactive agents, IDE plugins, and frameworks capable of managing an MCP connection.

**Transport:** stdio (primary) or SSE. Transport selection is at the process level; the tool schemas and semantics are identical across transports.

**Protocol:** MCP (JSON-RPC 2.0 over stdio or HTTP/SSE). See https://modelcontextprotocol.io for the MCP specification.

**Identity contract:** A compliant implementation MUST expose at minimum the four tools enumerated in §8 with the prescribed input schemas. Additional tools are permitted. The full tool list for context-mem v4.0 is indexed in `src/mcp-server/tools/index.ts`.

**Deprecation:** Legacy tools that have been superseded by the unified `search` tool carry `_meta.deprecated: true`, a `replacement` field, `replacement_params`, and a `removal_planned` version. Clients SHOULD migrate to the replacement tool and MUST NOT assume deprecated tools are present beyond the stated removal version.

### 3.3 Layer C — Vault Interop

The vault is the filesystem representation of memory, enabling any editor, script, grep, or agent to read and write memory without an MCP connection.

**Location:** `.context-mem/vault/` relative to the project root (configurable via `vaultDir`).

**Format:** Plain Markdown (CommonMark) with wiki-link syntax (`[[entities/foo]]`) for cross-references. No YAML frontmatter in v1 (reserved for v1.1).

**Directories:**

| Directory | Contents |
|-----------|----------|
| `sources/` | One session file per agent session—immutable raw observation log. |
| `entities/` | One page per named entity. Auto-generated; human-editable (annotations survive in v1.1+). |
| `topics/` | One page per detected topic. Auto-generated. |
| `knowledge/` | One page per knowledge entry. Created by explicit tool calls. |
| `answers/` | Synthesis pages from `ask` and `search(..., file_as: 'knowledge')`. |

**Root files:** `index.md` (auto-generated table of contents), `log.md` (append-only event journal), `schema.md` (symlink or copy of `docs/llm-wiki-schema.md`).

The full normative spec for the vault layer—page types, `safeName` algorithm, linking conventions, ingest/query/lint operations, and producer/consumer interop contract—is in `docs/llm-wiki-schema.md`.

---

## 4. Resource Model

This section formally defines the seven resource types that a Context Protocol-compliant implementation must support. Each type is described by its JSON shape, creation contract, query contract, and mutation contract.

### 4.1 Observation

The atomic memory unit.

```json
{
  "id": "<ULID>",
  "type": "code | error | log | test | commit | decision | context",
  "content": "<string, original or compressed>",
  "summary": "<string | null>",
  "session_id": "<string>",
  "source": "<string>",
  "indexed_at": "<number, ms since epoch>",
  "importance_score": "<number, 0.0–1.0>",
  "privacy_level": "public | redacted | private",
  "compression_tier": "none | light | heavy | stripped",
  "pinned": "<boolean>",
  "content_hash": "<string, SHA-256 hex>",
  "metadata": "<object>"
}
```

**Creation:** Via `observe` (MCP) or `POST /api/observe` (HTTP). The pipeline assigns `id`, `indexed_at`, `content_hash`, `importance_score`, `compression_tier`, and `privacy_level` automatically. `content_hash` enables idempotent ingest: if the hash matches an existing observation, the existing record is returned and no write occurs.

**Query:** Via `search`, `recall`, `timeline`, or `get` (MCP). Observations with `privacy_level: private` are excluded from all query results and vault pages.

**Mutation:** Observations are immutable after creation. The `access_count` field (internal) is incremented on each retrieval. `pinned` may be set via pipeline configuration.

### 4.2 Entity

A named thing that recurs across observations.

```json
{
  "id": "<ULID>",
  "name": "<string, canonical>",
  "entity_type": "<string: person | project | file | location | ...>",
  "aliases": ["<string>"],
  "created_at": "<number, ms>",
  "updated_at": "<number, ms>",
  "confidence": "<number, 0.0–1.0>",
  "metadata": "<object>"
}
```

**Creation:** Extracted deterministically from observations by the entity-extraction step of the pipeline. Also created explicitly via the knowledge graph tools (`add_relationship` creates entities as a side effect).

**Query:** Via `graph_query`, `graph_neighbors`, `list_people`. Entity pages in the vault are at `entities/<safeName(name)>.md`.

**Mutation:** Entity pages are regenerated by `VaultSync.refreshEntity()` each time the entity record is updated. The `updated_at` field reflects the most recent observation referencing this entity.

### 4.3 Topic

A thematic cluster grouping observations by detected concept.

```json
{
  "id": "<integer>",
  "name": "<string>",
  "observation_count": "<integer>",
  "last_seen": "<number | null, ms>"
}
```

**Creation:** Auto-detected by the topic-detection step of the pipeline. Multiple topics may be associated with a single observation. Topic names are stored in the `topics` table; associations are stored in `observation_topics`.

**Query:** Via `list_topics` or `search(..., scope: 'topics')`. Topic pages are at `topics/<safeName(name)>.md`.

**Mutation:** `VaultSync.refreshTopic()` regenerates the topic page when a new association is stored. `last_seen` is the `indexed_at` of the most recent associated observation.

### 4.4 Knowledge Entry

A promoted, explicitly-saved fact or reference.

```json
{
  "id": "<ULID>",
  "category": "pattern | decision | error | api | component",
  "title": "<string>",
  "content": "<string>",
  "tags": ["<string>"],
  "source_type": "explicit | inferred | observed",
  "shareable": "<boolean>",
  "valid_from": "<number | null, ms>",
  "valid_to": "<number | null, ms>",
  "superseded_by": "<ULID | null>",
  "access_count": "<integer>",
  "created_at": "<number, ms>"
}
```

**Creation:** Via `save_knowledge` (MCP). The tool runs contradiction detection before committing; a `force: true` parameter overrides the block and supersedes conflicting entries. `valid_from` defaults to the creation timestamp.

**Query:** Via `search(..., scope: 'knowledge')`, `search_knowledge` (deprecated), `temporal_query`, or direct vault page read at `knowledge/<safeName(id)>.md`.

**Mutation:** `valid_to` is set when an entry is superseded by a force-overriding save. The `resolve_contradiction` tool also updates `valid_to` and `superseded_by`. `access_count` increments on retrieval.

### 4.5 Synthesis Page

A knowledge entry produced by synthesizing multiple observations or knowledge entries into a narrative.

Synthesis pages share the KnowledgeEntry JSON shape but are distinguished by their category (`summary` for `search(..., file_as: 'knowledge')` or `answer` for `ask(..., save_as_page: true)`) and by their vault location (`answers/<id>.md` instead of `knowledge/<id>.md`).

**Creation:** Via `ask(..., save_as_page: true)` or `search(..., file_as: 'knowledge')`. The synthesis is deterministic in v4.0 (concatenation + trim of top-3 snippets); LLM-generated synthesis is a v4.1 candidate.

**Query:** Identical to KnowledgeEntry. The vault page at `answers/<id>.md` includes the original question, the synthesized answer, and a source list.

**Mutation:** Synthesis pages are not regenerated after creation. A new `ask` call creates a new synthesis page.

### 4.6 Source (Session)

The immutable session record.

```json
{
  "session_id": "<string>",
  "date": "<YYYY-MM-DD>",
  "observation_count": "<integer>",
  "vault_path": "sources/<safeName(session_id)>-<date>.md"
}
```

**Creation:** Implicitly, when the first observation is recorded in a new session. The vault page is written by `VaultSync.refreshSession()`, which callers invoke at session close or on demand.

**Query:** Via `restore_session`, `stats`, or direct vault read at `sources/<id>-<date>.md`.

**Mutation:** The session record is append-stable; the vault file is regenerated (not appended) by `refreshSession()`, but the content reflects all observations in that session and is deterministic given the same observation set.

### 4.7 Answer Page

A persisted natural-language answer, stored as a vault Markdown file and indexed as a knowledge entry.

Answer pages are a subtype of Synthesis Page with an additional structured header: the original question, a `## Answer` section, and a `## Sources` section listing the observation IDs that contributed to the answer. The vault path is `answers/<knowledge_id>.md`.

Answer pages are created by `ask(..., save_as_page: true)` and by `search(..., file_as: 'knowledge')`. In the knowledge base they are queryable with `scope: 'knowledge'`.

---

## 5. Operations

Operations are grouped into three families that mirror the ingest/query/lint model described in `docs/llm-wiki-schema.md` §6.

### 5.1 Ingest

Ingest operations write new information into the memory store.

#### `observe(content, type, source?, filePath?)`

The primary write operation. Records a single observation and triggers the full pipeline:

1. Budget check — reject if session budget is exhausted.
2. Privacy processing — strip `<private>` tags; redact regex-matched patterns; assign `privacy_level`.
3. SHA-256 deduplication — return existing record if `content_hash` matches.
4. Entity extraction (deterministic, zero-LLM).
5. Importance classification (deterministic, zero-LLM).
6. Topic detection (deterministic, zero-LLM).
7. Summarization — LLM if configured, else 14 deterministic pattern summarizers.
8. INSERT into `observations`.
9. Vault event log append (`log.md`).
10. Entity graph update + vault entity page regeneration.
11. Topic association storage + vault topic page regeneration.
12. Embedding (async, non-blocking, 768-dim `nomic-embed-text-v1.5`).

Returns `{ id: ULID, summary: string | undefined, tokens_saved: number }`.

**Idempotency:** Guaranteed via `content_hash`. Calling `observe` twice with identical content yields the same `id` with no write on the second call.

#### `save_knowledge({category, title, content, tags?, source_type?, force?, valid_from?})`

Explicit knowledge write. Runs contradiction detection before committing. When contradictions are found, the save is blocked and the conflicting entries are returned; resubmit with `force: true` to save and supersede the conflicts.

Returns `{ id, category, title, source_type, contradictions }` on success or `{ blocked, contradictions, message }` on a contradiction block.

### 5.2 Query

Query operations retrieve information from the memory store.

#### `search({query, scope?, mode?, filters?, cursor?, limit?, file_as?})`

The unified v4 search tool. Runs in parallel across the requested scope and fuses results by relevance score.

- **scope:** `observations` (default BM25/fusion), `knowledge`, `content` (code-aware content store), `topics`, or `all` (parallel across all four, interleaved by score).
- **mode:** `hybrid` (BM25 + vector fusion, default), `semantic` (bias toward vector + LLM judge when enabled), `verbatim` (BM25 AND-mode + phrase matching), `temporal` (temporal resolver hint, date-sorted fallback).
- **filters:** `since`, `until`, `types`, `category`, `importance_min`, `pinned`, `entity`.
- **cursor:** Accepted but returns `null` in v4.0. Full cursor-based pagination is a v4.1 candidate.
- **file_as:** When set to `'knowledge'`, synthesizes the top-3 public results and persists as a knowledge entry + vault answer page. Returns `_meta.filed_as` with the resulting knowledge ID.

Returns `{ results: UnifiedSearchResult[], cursor: null, _meta: { scope, mode, filters_applied } }`.

#### `ask({question, save_as_page?})`

Natural language query. Searches knowledge, observations, events, and graph entities. When `save_as_page: true`, the answer is persisted as a knowledge entry + vault answer page (`answers/<id>.md`). Returns `_meta.filed_as` and `_meta.vault_path` when persisted.

#### `recall(query, filters?, limit?)`

Verbatim-mode retrieval alias. Returns original `content` (not summaries), filtered by type, time range, importance, and significance flags (`DECISION`, `ORIGIN`, `PIVOT`, `CORE`, `MILESTONE`, `PROBLEM`). Deprecated in v4.0 in favor of `search(..., mode: 'verbatim')`.

#### `timeline({from?, to?, type?, session_id?, limit?, anchor?, verbatim?})`

Chronological view. Returns observations in reverse-chronological order with optional time range, type, and session filters. In anchor mode (`anchor: <id>`), centers the timeline on a specific observation with configurable depth before and after.

### 5.3 Lint

Lint operations surface structural problems in the memory store.

#### `diagnostics({since?, severity?, category?, limit?, mode?})`

Query the internal error log. Shows what subsystems have failed (embedder, entity extraction, topic storage, pipeline, dreamer, etc.). Useful for diagnosing silent failures in the fail-open pipeline.

- **severity:** `info`, `warn`, `error`, `critical`. Omit for all.
- **category:** Subsystem name string (e.g. `embedder`, `entity`, `pipeline`).
- **mode:** `summary` (group by category+message, default) or `list` (raw rows).

#### `merge_suggestions({status?, limit?})`

Returns pending merge suggestions for duplicate global knowledge entries. Suggestions are generated when two promoted entries exceed a cosine similarity threshold.

#### `wiki_lint()` (v4.0 planned, v1.1 spec candidate)

A dedicated tool for vault structural linting: orphan entity detection, stale topic detection, broken wiki-link detection, and cross-reference health. As of v4.0 (2026-05-22 target), lint results are surfaced via `diagnostics` and the dashboard Diagnostics page. A dedicated `wiki_lint` MCP tool returning structured lint results per the categories in `docs/llm-wiki-schema.md` §6.3 is a v4.0 delivery goal and a v1.1 spec candidate if it ships after this RFC is published.

---

## 6. Identity and Addressing

### 6.1 Observation IDs

Observation IDs are ULIDs (Universally Unique Lexicographically Sortable Identifiers). ULIDs embed a millisecond-precision timestamp in their most-significant bits, making them naturally sortable by creation time without a secondary `ORDER BY` clause. The format is a 26-character Crockford Base32 string (e.g. `01HZ4XQNBVT3K8P9WJFM2CRDG`).

Knowledge entry IDs are also ULIDs. Topic IDs are auto-increment integers (internal; not part of the protocol surface).

### 6.2 URI addressing

For cross-system references—such as when one memory system cites a resource from another—Context Protocol defines a URI scheme:

```
cm://<host_or_project>/<resource_type>/<id>
```

Examples:

```
cm://context-mem/observations/01HZ4XQNBVT3K8P9WJFM2CRDG
cm://context-mem/knowledge/01HZ4XQNBVT3K8P9WJFM2CRDG
cm://context-mem/entities/Juba-Kitiashvili
```

For local (single-instance) references, the host may be omitted: `cm:///observations/<ulid>`. URI resolution is not part of the v1 protocol; these URIs are citation handles for logging and vault cross-references, not dereferenceable HTTP URLs. Dereferenceable URI routing is a v1.1 candidate.

### 6.3 Entity addressing

Entity vault pages are addressed by `safeName(entity_name)` per the algorithm in `docs/llm-wiki-schema.md` §5. The `safeName` algorithm is normative and must be implemented identically by all producers to ensure vault link consistency.

### 6.4 Privacy levels

Each resource carries a `privacy_level` field. The three levels form a strict ordering: `public` < `redacted` < `private`.

| Level | Meaning | Vault | LLM prompts | On session end |
|-------|---------|-------|-------------|----------------|
| `public` | Default. No restrictions. | Written. | Included. | Retained. |
| `redacted` | Matched by privacy regex. Sensitive substrings stripped. | Written (with redactions). | Included (redacted). | Retained. |
| `private` | Matched by `<private>` tags or explicit `privacy_level: private`. | NOT written. | NOT included. | Deleted from SQLite. |

Implementations MUST enforce privacy levels before writing vault files and before constructing LLM prompts. The `<private>…</private>` tag syntax triggers automatic `private` classification in the reference implementation.

---

## 7. Versioning and Evolution

### 7.1 Protocol versioning

Context Protocol uses semantic versioning: `MAJOR.MINOR`. Minor bumps are additive (new tools, new optional fields). Major bumps indicate breaking changes to the resource model, operation semantics, or privacy contract.

The current version is `1.0`. The protocol version is published in the HTTP bridge's `GET /api` response as `"protocol": "context-protocol/1.0"` and in the MCP server's metadata.

### 7.2 Vault schema versioning

Vault directories SHOULD contain a `_version` file at the vault root with the LLM Wiki Schema version (e.g. `1.0`). Consumers that encounter an unknown version SHOULD degrade gracefully—reading known page types, ignoring unknown structures—rather than failing.

### 7.3 Deprecation policy

A tool or field that is superseded MUST carry `_meta.deprecated: true` in its response, a `replacement` field naming the canonical replacement, and a `removal_planned` field with the target version. The reference implementation commits to retaining deprecated tools for a minimum of two major versions from the deprecation announcement.

Current deprecations (v4.0):

| Deprecated tool | Replacement | Removal planned |
|-----------------|-------------|-----------------|
| `search` (legacy, pre-v4 schema) | `search` (v4 unified) | v5.0.0 |
| `search_knowledge` | `search` with `scope: 'knowledge'` | v5.0.0 |
| `search_content` | `search` with `scope: 'content'` | v5.0.0 |
| `recall` | `search` with `mode: 'verbatim'` | v5.0.0 |
| `browse` | `search` with `scope: 'topics'` | v5.0.0 |
| `global_search` | `search` with `scope: 'all'` | v5.0.0 |
| `ask` | `search` with `scope: 'all', mode: 'semantic'` | v5.0.0 |

---

## 8. Interop with MCP

Context Protocol is an opinionated layer over MCP. MCP handles transport, tool discovery, schema validation, and invocation. Context Protocol specifies the semantics of the memory tools that ride on MCP.

### 8.1 Minimum required surface

To claim **Context Protocol Core** compliance, an implementation MUST expose the following MCP tools with schemas that accept (at minimum) the described parameters:

| Tool | Minimum required parameters | Purpose |
|------|-----------------------------|---------|
| `observe` | `content: string` | Primary write |
| `search` | `query: string` | Unified query |
| `get` | `id: string` | Point lookup by ULID |
| `timeline` | (none required) | Chronological view |

These four tools constitute the minimum viable memory surface. An agent can write observations, search for relevant context, retrieve individual observations by ID, and view the recent observation stream with only these four tools.

### 8.2 Identity contract

All tools MUST return resource IDs that are globally unique strings. ULID is strongly recommended. Implementations that use other ID schemes MUST ensure the IDs are unique across restarts and across parallel sessions writing to the same store.

### 8.3 Privacy enforcement

The `search`, `get`, `timeline`, and `recall` tools MUST exclude resources with `privacy_level: private` from all responses. The implementation MUST NOT leak private resources to vault files or to LLM prompts, regardless of the calling tool.

### 8.4 Service info

Implementations that expose a Layer A HTTP bridge MUST respond to `GET /api` with the identity object specified in §3.1, including a `protocol` field set to `context-protocol/1.0` (or the actual implemented version).

### 8.5 Compliance levels

| Level | Requirements |
|-------|-------------|
| **Core** | Layer B minimum tool surface (§8.1). |
| **Extended** | Core + Layer A HTTP bridge with identity contract (§3.1, §8.4). |
| **Full** | Extended + Layer C vault with `safeName` algorithm and page types per `docs/llm-wiki-schema.md`. |

context-mem v4.0 is **Full-compliant**. It is the reference implementation for the community.

---

## 9. Security and Privacy

### 9.1 Local-first by default

A Context Protocol implementation MUST NOT make outbound network connections as part of its core memory operations unless an LLM API is explicitly configured by the user. The SQLite store, vault files, BM25 search, entity extraction, topic detection, importance classification, and temporal resolution all operate without network access. The embedding model (`nomic-embed-text-v1.5`) runs locally via `@huggingface/transformers`.

The LLM judge (Haiku-based reranker) and LLM summarizer are optional, gated by `ai_curation.enabled` and an explicit API key configuration.

### 9.2 HTTP bridge binding

The HTTP bridge MUST bind to `127.0.0.1` only by default. Binding to `0.0.0.0` or any non-loopback address requires explicit user opt-in through the configuration file. Implementations that support remote binding MUST document the security implications and SHOULD require authentication for any non-loopback binding.

### 9.3 Vault gitignore

The vault directory (`.context-mem/`) MUST be listed in `.gitignore` by default in the reference implementation. This prevents accidental commit of memory contents, which may include sensitive project context. Implementations MUST generate this gitignore entry on first initialization and SHOULD warn users who have removed it.

### 9.4 Privacy processing in the pipeline

Privacy processing runs before any persistence step:

1. `<private>…</private>` tags: the entire tagged content is stripped and `privacy_level` is set to `private`.
2. Regex-matched patterns (configurable via `privacy.redact_patterns`): matched substrings are replaced with `[REDACTED]` and `privacy_level` is set to `redacted`.
3. Content that survives both steps with no match is classified as `public`.

Private observations are stored in SQLite (for audit/budget accounting) but with an empty or stripped content field. They are never written to vault files and never injected into LLM prompts.

### 9.5 Execute tool opt-in

The `execute` tool (code execution across multiple runtimes) is disabled by default. It MUST be explicitly enabled via `execute_enabled: true` in `.context-mem.json`. The implementation strips environment variables matching `KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL` before passing the environment to the runtime.

---

## 10. Compliance Levels

This section summarizes the three compliance tiers introduced in §8.5.

### 10.1 Core

An implementation claiming **Core** compliance MUST:

- Expose the four required MCP tools (`observe`, `search`, `get`, `timeline`) with schemas accepting the required parameters.
- Return ULIDs (or globally unique strings) as resource IDs.
- Enforce privacy levels: never expose `privacy_level: private` resources in query results.
- Support the `content_hash` deduplication contract: identical content must not create duplicate observations.

An implementation claiming Core compliance MAY omit the HTTP bridge and vault entirely.

### 10.2 Extended

An implementation claiming **Extended** compliance MUST satisfy Core and additionally:

- Expose a Layer A HTTP bridge responding to `POST /api/observe`, `GET /api/health`, and `GET /api`.
- Bind the HTTP bridge to `127.0.0.1` only by default.
- Return `"protocol": "context-protocol/1.0"` in the `GET /api` response.

### 10.3 Full

An implementation claiming **Full** compliance MUST satisfy Extended and additionally:

- Produce a vault at a configurable directory (default `.context-mem/vault/`) conforming to the LLM Wiki Schema spec (`docs/llm-wiki-schema.md`).
- Implement the `safeName` algorithm exactly as specified in §5 of `docs/llm-wiki-schema.md`.
- Create and maintain `index.md`, `log.md`, and the four subdirectories (`sources/`, `entities/`, `topics/`, `knowledge/`).
- Use `[[dir/name]]` wiki-link syntax for all internal vault cross-references.
- Append to `log.md` (never truncate) and auto-generate `.gitignore` for the vault root.

---

## 11. Reference Implementation

context-mem v4.0 is the reference implementation of Context Protocol v1.

**Repository:** https://github.com/JubaKitiashvili/context-mem

**Install:**

```bash
npm install -g context-mem
npx context-mem --mcp       # MCP stdio mode (Layer B)
npx context-mem --http      # HTTP bridge only (Layer A)
npx context-mem             # Dashboard + bridge + MCP
```

**Compliance:** Full (Layers A + B + C).

**Benchmark results (v4.0 target):**

| Benchmark | Score |
|-----------|-------|
| LongMemEval | 100% R@5 (BM25 + Haiku judge); 97.8% LLM-free |
| LoCoMo | 98.1% |
| MemBench | 98.0% |
| ConvoMem | 97.7% |

**Source layout relevant to this spec:**

| Path | Role |
|------|------|
| `src/mcp-server/tools/core.ts` | `observe`, `timeline`, `get`, `stats` |
| `src/mcp-server/tools/search.ts` | `search` (unified v4), `ask`, `recall` |
| `src/mcp-server/tools/knowledge.ts` | `save_knowledge`, `promote_knowledge`, `diagnostics`-adjacent |
| `src/mcp-server/tools/session.ts` | `diagnostics`, `handoff_session`, session tools |
| `src/core/http-bridge.ts` | Layer A implementation |
| `src/core/vault.ts` | Layer C VaultSync |
| `src/core/pipeline.ts` | Ingest pipeline |
| `src/plugins/search/bm25.ts` | BM25 8-strategy retrieval |
| `src/plugins/search/fusion.ts` | Hybrid parallel fusion |
| `docs/llm-wiki-schema.md` | Layer C normative spec |

---

## 12. RFC Evolution

This is v1.0 (Draft). The spec is open for community RFC.

**Discussion:** https://github.com/JubaKitiashvili/context-mem/discussions/categories/protocol-rfc

Tag discussions with `protocol-rfc` and reference the section number being amended.

### 12.1 v1.1 candidates

The following items are in-scope for v1.1 but are deferred from v1.0 to keep the initial surface minimal:

**Bulk-ingest endpoint (NDJSON stream).** `POST /api/observe/bulk` accepting a newline-delimited JSON stream of observation objects. Useful for importing conversation history or file diffs in a single HTTP request. The reference implementation already has `import_conversations` (MCP) and the `ObserveQueue` abstraction; exposing bulk ingest over HTTP requires only a new route.

**Subscription / event-stream for live sync.** A `GET /api/events` SSE endpoint that emits vault events as they occur (ingest, entity_update, topic_update, knowledge_promote). Enables IDE plugins to keep a live panel in sync with the memory state without polling. The reference implementation already has `SSEStream` and `WSServer` infrastructure internally.

**Dereferenceable cm:// URIs.** A routing layer that maps `cm:///observations/<ulid>` to `GET /api/observations/<ulid>`. Enables vault cross-references to be resolved by an HTTP client without an MCP connection.

**YAML frontmatter for vault pages.** Optional structured metadata block at the top of entity, topic, and knowledge pages. Agreed with `docs/llm-wiki-schema.md` §9; deferred jointly to v1.1.

**`wiki_lint` MCP tool.** Structured lint results per `docs/llm-wiki-schema.md` §6.3: orphan entities, stale topics, broken wiki-links, temporal contradictions. Currently surfaced via `diagnostics`; a dedicated tool with a structured response schema improves tooling integration.

**Typed backlinks.** Backlink entries carry a relationship type (`derived-from`, `mentions`, `supersedes`) in addition to the target entity name.

### 12.2 v2+ scope

**CRDT-style vault merging.** When two agents write to the same vault concurrently (e.g., two instances of an IDE plugin on the same project), the vault's Markdown files may diverge. A formalized diff format and merge protocol based on CRDT principles is the v2 scope boundary. v1 treats the vault as single-writer; concurrent writes rely on filesystem-level locking provided by SQLite (WAL mode).

**Remote multi-tenant deployment.** Layer A currently binds to loopback only. Supporting authenticated remote binding—with per-client namespacing, rate limiting, and TLS—is a distinct v2 concern.

---

## 13. Related Work

- **Model Context Protocol (MCP):** https://modelcontextprotocol.io — The transport and tool-invocation layer that Context Protocol layers upon. Context Protocol does not replace MCP; it specifies what the memory tools on MCP should expose.
- **LLM Wiki Schema Spec:** `docs/llm-wiki-schema.md` (this repository) — The normative specification for Context Protocol Layer C. Read this document for page-type definitions, the `safeName` algorithm, producer/consumer requirements, and the full ingest/query/lint operation descriptions.
- **Karpathy, "LLM Wiki" gist (2026-04-04):** https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f — The conceptual framing (raw sources / wiki / schema) that motivates the three-layer architecture.
- **Vannevar Bush, "As We May Think," The Atlantic (1945)** — The original vision for a personal memory device that captures and retrieves knowledge across an individual's lifetime. The memex framing that underlies all modern personal knowledge management.
- **context-mem repository:** https://github.com/JubaKitiashvili/context-mem

---

## Appendix A: Reference Schemas

The following schemas are extracted verbatim from the context-mem v4.0 source. They represent the actual tool input schemas as of the date of this document (2026-04-18). Implementations claiming compatibility MUST accept at minimum the `required` parameters of each tool.

### A.1 `observe`

Source: `src/mcp-server/tools/core.ts`

```json
{
  "type": "object",
  "properties": {
    "content": {
      "type": "string",
      "description": "The content to observe and store"
    },
    "type": {
      "type": "string",
      "enum": ["code", "error", "log", "test", "commit", "decision", "context"],
      "description": "Content type (default: context)"
    },
    "source": {
      "type": "string",
      "description": "Source identifier (default: mcp)"
    },
    "correlation_id": {
      "type": "string",
      "description": "Links related observations (e.g., same debugging session)"
    },
    "files_modified": {
      "type": "array",
      "items": { "type": "string" },
      "description": "File paths modified in this observation"
    }
  },
  "required": ["content"]
}
```

### A.2 `search` (v4 unified)

Source: `src/mcp-server/tools/search.ts`

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Search query"
    },
    "scope": {
      "type": "string",
      "enum": ["observations", "knowledge", "content", "topics", "all"],
      "description": "What to search (default: all)"
    },
    "mode": {
      "type": "string",
      "enum": ["semantic", "verbatim", "temporal", "hybrid"],
      "description": "Search strategy (default: hybrid)"
    },
    "filters": {
      "type": "object",
      "description": "Optional filters",
      "properties": {
        "since":          { "type": "number",  "description": "Only results after this timestamp (ms)" },
        "until":          { "type": "number",  "description": "Only results before this timestamp (ms)" },
        "types":          { "type": "array",   "items": { "type": "string" }, "description": "Observation type filter" },
        "category":       { "type": "array",   "items": { "type": "string" }, "description": "Knowledge category filter" },
        "importance_min": { "type": "number",  "description": "Minimum importance score (0.0-1.0)" },
        "pinned":         { "type": "boolean", "description": "Only pinned observations" },
        "entity":         { "type": "string",  "description": "Filter/boost by entity name" }
      }
    },
    "limit": {
      "type": "number",
      "description": "Max results (default: 10)"
    },
    "cursor": {
      "type": "string",
      "description": "Pagination cursor (stub in v4.0, fully implemented in v4.1)"
    },
    "file_as": {
      "type": "string",
      "enum": ["knowledge"],
      "description": "Synthesize top results and file the synthesis as a knowledge entry + vault page."
    }
  },
  "required": ["query"]
}
```

### A.3 `ask`

Source: `src/mcp-server/tools/search.ts`

```json
{
  "type": "object",
  "properties": {
    "question": {
      "type": "string",
      "description": "Natural language question about the project"
    },
    "limit": {
      "type": "number",
      "description": "Max results to consider (default: 5)"
    },
    "save_as_page": {
      "type": "boolean",
      "default": false,
      "description": "Also file this answer as a knowledge entry + vault page."
    }
  },
  "required": ["question"]
}
```

### A.4 `save_knowledge`

Source: `src/mcp-server/tools/knowledge.ts`

```json
{
  "type": "object",
  "properties": {
    "category": {
      "type": "string",
      "enum": ["pattern", "decision", "error", "api", "component"],
      "description": "Knowledge category"
    },
    "title": {
      "type": "string",
      "description": "Short title"
    },
    "content": {
      "type": "string",
      "description": "Knowledge content"
    },
    "tags": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Tags for categorization"
    },
    "shareable": {
      "type": "boolean",
      "description": "Whether this knowledge can be shared (default: true)"
    },
    "source_type": {
      "type": "string",
      "enum": ["explicit", "inferred", "observed"],
      "description": "How this knowledge was obtained. Default: observed"
    },
    "force": {
      "type": "boolean",
      "description": "Force save even when contradictions exist (default: false)"
    },
    "valid_from": {
      "type": "number",
      "description": "Timestamp (ms) when this fact became true. Default: now"
    }
  },
  "required": ["category", "title", "content"]
}
```

### A.5 `diagnostics`

Source: `src/mcp-server/tools/session.ts`

```json
{
  "type": "object",
  "properties": {
    "since": {
      "type": "number",
      "description": "Unix ms — only include entries at or after. Default: last hour."
    },
    "severity": {
      "type": "string",
      "enum": ["info", "warn", "error", "critical"],
      "description": "Filter by severity. Omit for all severities."
    },
    "category": {
      "type": "string",
      "description": "Filter by category (embedder, entity, topic, summarizer, pipeline, dreamer, knowledge-graph, etc.)."
    },
    "limit": {
      "type": "number",
      "minimum": 1,
      "maximum": 500,
      "description": "Max results. Default 50."
    },
    "mode": {
      "type": "string",
      "enum": ["summary", "list"],
      "description": "summary (default) groups by category+message; list returns raw rows."
    }
  }
}
```

---

## Appendix B: Protocol Draft Changelog

| Version | Date | Notes |
|---------|------|-------|
| v1.0 (draft) | 2026-04-18 | Initial publication. Three-layer architecture. Seven resource types. Core/Extended/Full compliance tiers. Schemas extracted from context-mem v4.0 source. |
