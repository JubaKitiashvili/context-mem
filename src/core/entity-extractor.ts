/**
 * Entity Extractor — zero-LLM deterministic entity extraction from text.
 *
 * Detects: technologies, file paths, CamelCase components, ALL_CAPS constants,
 * person names, issue references, and version numbers.
 * Includes alias resolution for 100+ common technology aliases.
 */

import type { EntityType } from './types.js';

export interface ExtractedEntity {
  name: string;
  type: EntityType;
  confidence: number;
  aliases: string[];
}

// ---------------------------------------------------------------------------
// Technology alias map (canonical → aliases)
// ---------------------------------------------------------------------------

const TECH_ALIASES: Record<string, string[]> = {
  'React': ['React.js', 'ReactJS', 'react', 'react.js'],
  'Next.js': ['NextJS', 'Nextjs', 'next.js', 'next'],
  'Vue': ['Vue.js', 'VueJS', 'vue.js', 'vue'],
  'Angular': ['AngularJS', 'angular', 'ng'],
  'Svelte': ['SvelteKit', 'svelte'],
  'Node.js': ['NodeJS', 'node.js', 'node', 'nodejs'],
  'Express': ['Express.js', 'express.js', 'express'],
  'TypeScript': ['TS', 'typescript', 'ts'],
  'JavaScript': ['JS', 'javascript', 'js'],
  'Python': ['python', 'py'],
  'Ruby': ['ruby', 'rb'],
  'Rust': ['rust', 'rs'],
  'Go': ['Golang', 'golang'],
  'Java': ['java'],
  'PostgreSQL': ['Postgres', 'postgres', 'pg', 'psql', 'postgresql'],
  'MySQL': ['mysql', 'MariaDB', 'mariadb'],
  'MongoDB': ['mongo', 'mongodb'],
  'Redis': ['redis'],
  'SQLite': ['sqlite', 'sqlite3'],
  'Docker': ['docker', 'dockerfile'],
  'Kubernetes': ['k8s', 'K8s', 'kubernetes', 'kube'],
  'AWS': ['aws', 'Amazon Web Services'],
  'GCP': ['gcp', 'Google Cloud', 'google cloud'],
  'Azure': ['azure', 'Microsoft Azure'],
  'Terraform': ['terraform', 'tf'],
  'GraphQL': ['graphql', 'gql'],
  'REST': ['rest', 'RESTful', 'restful'],
  'gRPC': ['grpc', 'GRPC'],
  'Webpack': ['webpack'],
  'Vite': ['vite'],
  'ESLint': ['eslint'],
  'Prettier': ['prettier'],
  'Jest': ['jest'],
  'Vitest': ['vitest'],
  'Mocha': ['mocha'],
  'Cypress': ['cypress'],
  'Playwright': ['playwright'],
  'Tailwind CSS': ['tailwind', 'tailwindcss', 'Tailwind'],
  'Bootstrap': ['bootstrap'],
  'Sass': ['sass', 'scss', 'SCSS'],
  'Git': ['git'],
  'GitHub': ['github', 'Github'],
  'GitLab': ['gitlab', 'Gitlab'],
  'Linux': ['linux'],
  'macOS': ['macos', 'MacOS', 'OSX', 'osx'],
  'Windows': ['windows', 'win32'],
  'Nginx': ['nginx', 'NGINX'],
  'Apache': ['apache', 'httpd'],
  'Prisma': ['prisma'],
  'Drizzle': ['drizzle'],
  'Sequelize': ['sequelize'],
  'Mongoose': ['mongoose'],
  'Flask': ['flask'],
  'Django': ['django'],
  'FastAPI': ['fastapi'],
  'Spring': ['spring', 'Spring Boot', 'spring-boot'],
  'Rails': ['rails', 'Ruby on Rails'],
  'Laravel': ['laravel'],
  'Supabase': ['supabase'],
  'Firebase': ['firebase'],
  'Stripe': ['stripe'],
  'Auth0': ['auth0'],
  'JWT': ['jwt', 'JSON Web Token'],
  'OAuth': ['oauth', 'OAuth2', 'oauth2'],
  'CORS': ['cors'],
  'WebSocket': ['websocket', 'ws', 'WebSockets'],
  'RabbitMQ': ['rabbitmq'],
  'Kafka': ['kafka'],
  'Elasticsearch': ['elasticsearch', 'elastic'],
  'Prometheus': ['prometheus'],
  'Grafana': ['grafana'],
  'Sentry': ['sentry'],
  'Datadog': ['datadog'],
  'Vercel': ['vercel'],
  'Netlify': ['netlify'],
  'Heroku': ['heroku'],
  'Cloudflare': ['cloudflare', 'CF'],
  'npm': ['NPM'],
  'Yarn': ['yarn'],
  'pnpm': ['PNPM'],
  'Bun': ['bun'],
  'Deno': ['deno'],
  'Remix': ['remix'],
  'Astro': ['astro'],
  'Nuxt': ['nuxt', 'Nuxt.js'],
  'Gatsby': ['gatsby'],
  'Electron': ['electron'],
  'Tauri': ['tauri'],
  'React Native': ['react-native', 'RN'],
  'Flutter': ['flutter'],
  'Swift': ['swift'],
  'Kotlin': ['kotlin'],
  'C++': ['cpp', 'c++'],
  'C#': ['csharp', 'c#'],
  'PHP': ['php'],
  'Elixir': ['elixir'],
  'Haskell': ['haskell'],
  'Scala': ['scala'],
  'Clojure': ['clojure'],
};

// Build reverse lookup: alias → canonical name
const ALIAS_TO_CANONICAL = new Map<string, string>();
const CANONICAL_SET = new Set<string>();
for (const [canonical, aliases] of Object.entries(TECH_ALIASES)) {
  CANONICAL_SET.add(canonical.toLowerCase());
  ALIAS_TO_CANONICAL.set(canonical.toLowerCase(), canonical);
  for (const alias of aliases) {
    ALIAS_TO_CANONICAL.set(alias.toLowerCase(), canonical);
  }
}

// ---------------------------------------------------------------------------
// Detection patterns
// ---------------------------------------------------------------------------

// CamelCase: starts with uppercase, has at least one lowercase after
const CAMEL_CASE = /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g;

// ALL_CAPS_WITH_UNDERSCORES (at least 2 chars, no lowercase)
const ALL_CAPS = /\b([A-Z][A-Z0-9_]{2,})\b/g;

// File paths: at least one slash with extension or multiple segments
const FILE_PATH = /(?:^|\s)((?:\.?\.?\/)?(?:[\w\-.]+\/)+[\w\-.]+(?:\.\w+)?)/g;

// Issue references: #123 or issue-123
const ISSUE_REF = /(?:#(\d+)|(?:issue|bug|ticket)[-\s]?(\d+))/gi;

// Version patterns: v1.2.3 or 1.2.3
const VERSION_REF = /\bv?(\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?)\b/g;

// Person names: capitalized multi-word (2+ words, each capitalized, in conversational context)
const PERSON_NAME = /\b([A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)\b/g;

// Common words that look like CamelCase but aren't entities
const CAMEL_CASE_SKIP = new Set([
  'JavaScript', 'TypeScript', 'GraphQL', 'WebSocket', 'GitHub', 'GitLab',
  'MongoDB', 'PostgreSQL', 'RabbitMQ', 'FastAPI', 'ElasticSearch',
]);

// Common ALL_CAPS that are not config constants
const ALL_CAPS_SKIP = new Set([
  'TODO', 'FIXME', 'NOTE', 'HACK', 'XXX', 'API', 'URL', 'HTTP', 'HTTPS',
  'HTML', 'CSS', 'SQL', 'JSON', 'XML', 'YAML', 'TOML', 'CLI', 'GUI',
  'NPM', 'JWT', 'SSH', 'SSL', 'TLS', 'DNS', 'CDN', 'EOF', 'NULL',
  'TRUE', 'FALSE', 'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD',
]);

/**
 * Extract entities from text content. Zero-LLM, deterministic.
 */
export function extractEntities(
  content: string,
  _knownEntities?: Array<{ name: string; entity_type: string }>,
): ExtractedEntity[] {
  if (!content || !content.trim()) return [];

  const seen = new Map<string, ExtractedEntity>();

  // 1. Technology detection (highest priority — check against alias map)
  detectTechnologies(content, seen);

  // 2. File path detection
  detectFilePaths(content, seen);

  // 3. CamelCase components
  detectCamelCase(content, seen);

  // 4. ALL_CAPS constants
  detectAllCaps(content, seen);

  // 5. Issue references
  detectIssues(content, seen);

  // 6. Version references
  detectVersions(content, seen);

  // 7. Person names (lowest confidence — check last to avoid overriding)
  detectPersonNames(content, seen);

  return Array.from(seen.values());
}

/**
 * Resolve an entity name to its canonical form.
 */
export function resolveAlias(name: string): { canonical: string; isAlias: boolean } {
  const canonical = ALIAS_TO_CANONICAL.get(name.toLowerCase());
  if (canonical) {
    return { canonical, isAlias: canonical.toLowerCase() !== name.toLowerCase() };
  }
  return { canonical: name, isAlias: false };
}

// ---------------------------------------------------------------------------
// Detection functions
// ---------------------------------------------------------------------------

function detectTechnologies(content: string, seen: Map<string, ExtractedEntity>): void {
  // Split into word-like tokens and check against alias map
  const tokens = content.split(/[\s,;:()[\]{}"'`]+/).filter(t => t.length >= 2);
  for (const token of tokens) {
    const canonical = ALIAS_TO_CANONICAL.get(token.toLowerCase());
    if (canonical && !seen.has(canonical.toLowerCase())) {
      seen.set(canonical.toLowerCase(), {
        name: canonical,
        type: 'library',
        confidence: 0.95,
        aliases: TECH_ALIASES[canonical] || [],
      });
    }
  }
}

function detectFilePaths(content: string, seen: Map<string, ExtractedEntity>): void {
  let match;
  FILE_PATH.lastIndex = 0;
  while ((match = FILE_PATH.exec(content)) !== null) {
    const p = match[1].trim();
    if (p.length < 4 || !p.includes('/')) continue;
    const key = p.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, { name: p, type: 'file', confidence: 0.9, aliases: [] });
    }
  }
}

function detectCamelCase(content: string, seen: Map<string, ExtractedEntity>): void {
  let match;
  CAMEL_CASE.lastIndex = 0;
  while ((match = CAMEL_CASE.exec(content)) !== null) {
    const name = match[1];
    const key = name.toLowerCase();
    // Skip if already detected as technology or if it's a known skip word
    if (seen.has(key) || CAMEL_CASE_SKIP.has(name) || ALIAS_TO_CANONICAL.has(key)) continue;
    seen.set(key, { name, type: 'module', confidence: 0.8, aliases: [] });
  }
}

function detectAllCaps(content: string, seen: Map<string, ExtractedEntity>): void {
  let match;
  ALL_CAPS.lastIndex = 0;
  while ((match = ALL_CAPS.exec(content)) !== null) {
    const name = match[1];
    if (ALL_CAPS_SKIP.has(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key) || ALIAS_TO_CANONICAL.has(key)) continue;
    seen.set(key, { name, type: 'config', confidence: 0.7, aliases: [] });
  }
}

function detectIssues(content: string, seen: Map<string, ExtractedEntity>): void {
  let match;
  ISSUE_REF.lastIndex = 0;
  while ((match = ISSUE_REF.exec(content)) !== null) {
    const num = match[1] || match[2];
    const name = `#${num}`;
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, { name, type: 'bug', confidence: 0.9, aliases: [] });
    }
  }
}

function detectVersions(content: string, seen: Map<string, ExtractedEntity>): void {
  let match;
  VERSION_REF.lastIndex = 0;
  while ((match = VERSION_REF.exec(content)) !== null) {
    const ver = `v${match[1]}`;
    const key = ver.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, { name: ver, type: 'service', confidence: 0.9, aliases: [] });
    }
  }
}

function detectPersonNames(content: string, seen: Map<string, ExtractedEntity>): void {
  let match;
  PERSON_NAME.lastIndex = 0;
  while ((match = PERSON_NAME.exec(content)) !== null) {
    const name = match[1];
    const key = name.toLowerCase();
    // Skip if already detected as something else or if it's a known technology
    if (seen.has(key) || ALIAS_TO_CANONICAL.has(key)) continue;
    // Skip if it looks like a class/component name
    if (name.split(' ').some(w => /^[A-Z][A-Z]/.test(w))) continue;
    seen.set(key, { name, type: 'person', confidence: 0.6, aliases: [] });
  }
}
