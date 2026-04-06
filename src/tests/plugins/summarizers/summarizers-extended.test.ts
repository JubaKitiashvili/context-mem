import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BinarySummarizer } from '../../../plugins/summarizers/binary-summarizer.js';
import { BuildOutputSummarizer } from '../../../plugins/summarizers/build-output-summarizer.js';
import { CsvSummarizer } from '../../../plugins/summarizers/csv-summarizer.js';
import { GitLogSummarizer } from '../../../plugins/summarizers/git-log-summarizer.js';
import { HtmlSummarizer } from '../../../plugins/summarizers/html-summarizer.js';
import { MarkdownSummarizer } from '../../../plugins/summarizers/markdown-summarizer.js';
import { NetworkSummarizer } from '../../../plugins/summarizers/network-summarizer.js';
import { TestOutputSummarizer } from '../../../plugins/summarizers/test-output-summarizer.js';
import { TypescriptErrorSummarizer } from '../../../plugins/summarizers/typescript-error-summarizer.js';

// ─── BinarySummarizer ────────────────────────────────────────────────────────

describe('BinarySummarizer', () => {
  const summarizer = new BinarySummarizer();

  it('detects binary content with high non-printable ratio', () => {
    // Build a string with >10% non-printable bytes
    const binary = '\x00\x01\x02\x03\x04\x05\x06\x07\x08\x0e\x0f\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1a\x1b\x1c\x1d\x1e\x1f' +
      'some printable text here to fill space';
    assert.equal(summarizer.detect(binary), true);
  });

  it('does not detect plain text (all printable)', () => {
    const text = 'This is a completely normal plain text string.\nNo binary here at all.';
    assert.equal(summarizer.detect(text), false);
  });

  it('does not detect empty content', () => {
    assert.equal(summarizer.detect(''), false);
  });

  it('does not detect content with just tabs/newlines/CR (printable control chars)', () => {
    const text = 'line1\nline2\tindented\r\nline3\n';
    assert.equal(summarizer.detect(text), false);
  });

  it('summarizes binary content with sha256 and byte size', async () => {
    const binary = '\x00\x01\x02\x03\x04\x05\x06\x07\x08\x0e\x0f\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1a\x1b\x1c\x1d\x1e\x1f' +
      'padding text to make it bigger than the summary itself for savings';
    const result = await summarizer.summarize(binary, {});
    assert.ok(result.summary.includes('[binary content]'), `Expected [binary content] in: ${result.summary}`);
    assert.ok(result.summary.includes('sha256:'), `Expected sha256: in: ${result.summary}`);
    assert.ok(result.summary.includes('bytes'), `Expected bytes in: ${result.summary}`);
    assert.equal(result.content_type, 'binary');
    // sha256 hex is 64 chars
    const hexMatch = result.summary.match(/sha256:([a-f0-9]+)/);
    assert.ok(hexMatch, 'Expected sha256 hash');
    assert.equal(hexMatch![1].length, 64, 'Expected 64-char sha256 hex');
  });

  it('summarizes large binary and achieves positive savings', async () => {
    // Create content much larger than the summary line
    const binaryPad = '\x00\x01\x02\x03\x04\x05\x06\x07'.repeat(100);
    const result = await summarizer.summarize(binaryPad, {});
    assert.ok(result.savings_pct > 0, `Expected positive savings, got ${result.savings_pct}`);
    assert.ok(result.tokens_original > result.tokens_summarized);
  });

  it('returns consistent hash for same input', async () => {
    const binary = '\x00\x01\x02\x03hello\x1f\x1e';
    const r1 = await summarizer.summarize(binary, {});
    const r2 = await summarizer.summarize(binary, {});
    assert.equal(r1.summary, r2.summary);
  });
});

// ─── BuildOutputSummarizer ──────────────────────────────────────────────────

const WEBPACK_BUILD = `
> myapp@1.0.0 build
> webpack --mode production

webpack 5.88.0 compiled successfully
Bundling modules...

Route /                       2.3 kB
Route /about                  1.1 kB
Route /api/users              4.5 kB

asset main.js - 145.2 kB
asset vendor.js - 892.4 kB
asset styles.css - 22.1 kB

WARNING in ./src/utils/deprecated.js
  DeprecationWarning: old API used

WARNING in ./src/components/Icon.tsx
  Module not found: peer dependency missing

Built in 4.3s
`;

const NEXT_BUILD = `
> next build
info  - Compiling...
info  - Creating an optimized production build...
info  - Compiled successfully

Route (app)                           Size    First Load JS
┌ ○ /                               5.23 kB         94.2 kB
├ ○ /dashboard                      12.3 kB          101 kB
├ ○ /settings                       3.12 kB         92.1 kB
└ ○ /api/health                       143 B         63.1 kB

○  (Static)   prerendered as static content

compiled in 8.2s
`;

describe('BuildOutputSummarizer', () => {
  const summarizer = new BuildOutputSummarizer();

  it('detects webpack build output', () => {
    assert.equal(summarizer.detect(WEBPACK_BUILD), true);
  });

  it('detects Next.js build output', () => {
    assert.equal(summarizer.detect(NEXT_BUILD), true);
  });

  it('detects output with "Bundling" keyword', () => {
    assert.equal(summarizer.detect('Bundling application...'), true);
  });

  it('does not detect plain log content', () => {
    const log = 'Server started\nConnecting to database\nListening on port 3000';
    assert.equal(summarizer.detect(log), false);
  });

  it('summarizes webpack build — extracts routes and bundle sizes', async () => {
    const result = await summarizer.summarize(WEBPACK_BUILD, {});
    assert.equal(result.content_type, 'build-output');
    assert.ok(result.summary.includes('Build Output Summary'), `Missing heading in: ${result.summary}`);
    assert.ok(result.summary.includes('Routes found'), `Missing routes section: ${result.summary}`);
    assert.ok(result.summary.includes('Bundle sizes'), `Missing bundle sizes section: ${result.summary}`);
    assert.ok(result.summary.includes('Warnings:'), `Missing warnings count: ${result.summary}`);
  });

  it('summarizes webpack build — captures warning count', async () => {
    const result = await summarizer.summarize(WEBPACK_BUILD, {});
    assert.ok(result.summary.includes('Warnings: 2'), `Expected 2 warnings in: ${result.summary}`);
  });

  it('summarizes webpack build — extracts build time', async () => {
    const result = await summarizer.summarize(WEBPACK_BUILD, {});
    assert.ok(result.summary.includes('4.3s') || result.summary.includes('Build time'), `Expected build time in: ${result.summary}`);
  });

  it('summarizes Next.js build — includes routes section and build time', async () => {
    const result = await summarizer.summarize(NEXT_BUILD, {});
    assert.ok(result.summary.includes('Routes found'), `Expected routes section: ${result.summary}`);
    assert.ok(result.summary.includes('Build time'), `Expected build time section: ${result.summary}`);
    assert.ok(result.summary.includes('8.2s'), `Expected 8.2s build time: ${result.summary}`);
  });

  it('summary is shorter than original for large build output', async () => {
    const result = await summarizer.summarize(WEBPACK_BUILD, {});
    assert.ok(result.summary.length < WEBPACK_BUILD.length, 'Summary should be shorter than input');
  });
});

// ─── CsvSummarizer ──────────────────────────────────────────────────────────

const CSV_EMPLOYEES = `id,name,department,salary,start_date
1,Alice Johnson,Engineering,95000,2020-03-15
2,Bob Smith,Marketing,72000,2019-07-01
3,Carol White,Engineering,105000,2018-11-20
4,David Brown,HR,68000,2021-05-10
5,Eve Davis,Engineering,98000,2022-01-30
6,Frank Miller,Marketing,75000,2020-09-14
7,Grace Wilson,Finance,88000,2017-04-22
8,Henry Taylor,Engineering,112000,2016-08-05
9,Iris Anderson,HR,65000,2023-02-18
10,Jack Thomas,Finance,91000,2019-12-01
`;

const CSV_SALES = `date,product,quantity,unit_price,total
2024-01-01,Widget A,10,9.99,99.90
2024-01-01,Widget B,5,19.99,99.95
2024-01-02,Widget A,3,9.99,29.97
2024-01-02,Widget C,8,14.99,119.92
2024-01-03,Widget B,12,19.99,239.88
2024-01-03,Widget A,7,9.99,69.93
`;

describe('CsvSummarizer', () => {
  it('detects well-formed CSV with consistent comma counts', () => {
    const summarizer = new CsvSummarizer();
    assert.equal(summarizer.detect(CSV_EMPLOYEES), true);
  });

  it('detects sales CSV data', () => {
    const summarizer = new CsvSummarizer();
    assert.equal(summarizer.detect(CSV_SALES), true);
  });

  it('does not detect CSV with fewer than 5 lines', () => {
    const summarizer = new CsvSummarizer();
    const short = 'a,b,c\n1,2,3\n4,5,6';
    assert.equal(summarizer.detect(short), false);
  });

  it('does not detect plain text (no commas)', () => {
    const summarizer = new CsvSummarizer();
    const text = [
      'line one of text here',
      'line two of text here',
      'line three of text here',
      'line four of text here',
      'line five of text here',
    ].join('\n');
    assert.equal(summarizer.detect(text), false);
  });

  it('does not detect inconsistent comma counts', () => {
    const summarizer = new CsvSummarizer();
    const irregular = [
      'a,b,c',
      '1,2,3',
      '4,5',
      '6,7,8,9',
      '10,11,12',
    ].join('\n');
    assert.equal(summarizer.detect(irregular), false);
  });

  it('summarizes CSV — extracts dimensions, headers, sample rows', async () => {
    const summarizer = new CsvSummarizer();
    summarizer.detect(CSV_EMPLOYEES); // prime cache
    const result = await summarizer.summarize(CSV_EMPLOYEES, {});
    assert.equal(result.content_type, 'csv');
    assert.ok(result.summary.includes('CSV Summary'), `Missing heading: ${result.summary}`);
    assert.ok(result.summary.includes('Dimensions:'), `Missing dimensions: ${result.summary}`);
    assert.ok(result.summary.includes('Headers'), `Missing headers section: ${result.summary}`);
    assert.ok(result.summary.includes('Sample rows'), `Missing sample rows: ${result.summary}`);
  });

  it('summarizes CSV — correct column count', async () => {
    const summarizer = new CsvSummarizer();
    summarizer.detect(CSV_EMPLOYEES);
    const result = await summarizer.summarize(CSV_EMPLOYEES, {});
    // 5 columns: id, name, department, salary, start_date
    assert.ok(result.summary.includes('5 columns') || result.summary.includes('x 5'), `Expected 5 columns: ${result.summary}`);
  });

  it('summarizes CSV — includes header names', async () => {
    const summarizer = new CsvSummarizer();
    summarizer.detect(CSV_EMPLOYEES);
    const result = await summarizer.summarize(CSV_EMPLOYEES, {});
    assert.ok(result.summary.includes('name'), `Missing column name: ${result.summary}`);
    assert.ok(result.summary.includes('department'), `Missing column department: ${result.summary}`);
  });

  it('summarizes CSV — includes at most 3 sample data rows', async () => {
    const summarizer = new CsvSummarizer();
    summarizer.detect(CSV_EMPLOYEES);
    const result = await summarizer.summarize(CSV_EMPLOYEES, {});
    // Sample rows labeled [1], [2], [3]
    assert.ok(result.summary.includes('[1]'), `Expected [1] sample row: ${result.summary}`);
    assert.ok(!result.summary.includes('[4]'), `Should not include [4]: ${result.summary}`);
  });

  it('summary is shorter than original for large CSV', async () => {
    const summarizer = new CsvSummarizer();
    summarizer.detect(CSV_EMPLOYEES);
    const result = await summarizer.summarize(CSV_EMPLOYEES, {});
    assert.ok(result.summary.length < CSV_EMPLOYEES.length, 'Summary should be shorter than input');
  });

  it('works without detect() being called first (no cache)', async () => {
    const summarizer = new CsvSummarizer();
    // Do NOT call detect() — summarize should still work
    const result = await summarizer.summarize(CSV_SALES, {});
    assert.equal(result.content_type, 'csv');
    assert.ok(result.summary.includes('CSV Summary'));
  });
});

// ─── GitLogSummarizer ────────────────────────────────────────────────────────

const GIT_LOG_FULL = `commit a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2
Author: Alice Johnson <alice@example.com>
Date:   Mon Apr 1 10:00:00 2024 +0000

    feat: add user authentication module

commit b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3
Author: Bob Smith <bob@example.com>
Date:   Sun Mar 31 15:30:00 2024 +0000

    fix: resolve null pointer in session handler

commit c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4
Author: Alice Johnson <alice@example.com>
Date:   Sat Mar 30 09:15:00 2024 +0000

    refactor: extract token validation into separate service

commit d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5
Author: Carol White <carol@example.com>
Date:   Fri Mar 29 14:00:00 2024 +0000

    test: add unit tests for auth service

commit e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6
Author: Bob Smith <bob@example.com>
Date:   Thu Mar 28 11:45:00 2024 +0000

    docs: update API documentation
`;

const GIT_LOG_ONELINE = `a1b2c3d feat: add user authentication
b2c3d4e fix: resolve login bug
c3d4e5f chore: update dependencies
d4e5f6a test: add integration tests
e5f6a1b perf: optimize database queries
`;

describe('GitLogSummarizer', () => {
  const summarizer = new GitLogSummarizer();

  it('detects full git log format (40-char commit hash)', () => {
    assert.equal(summarizer.detect(GIT_LOG_FULL), true);
  });

  it('detects one-line git log format (short hash)', () => {
    assert.equal(summarizer.detect(GIT_LOG_ONELINE), true);
  });

  it('does not detect regular text without commit hashes', () => {
    const text = 'This is a plain text document.\nIt has multiple lines.\nBut no git commits.';
    assert.equal(summarizer.detect(text), false);
  });

  it('summarizes full git log — commit count', async () => {
    const result = await summarizer.summarize(GIT_LOG_FULL, {});
    assert.equal(result.content_type, 'git-log');
    assert.ok(result.summary.includes('Commits: 5'), `Expected 5 commits in: ${result.summary}`);
  });

  it('summarizes full git log — unique authors', async () => {
    const result = await summarizer.summarize(GIT_LOG_FULL, {});
    assert.ok(result.summary.includes('Authors: 3'), `Expected 3 authors in: ${result.summary}`);
    assert.ok(result.summary.includes('Alice Johnson'), `Missing Alice: ${result.summary}`);
    assert.ok(result.summary.includes('Bob Smith'), `Missing Bob: ${result.summary}`);
  });

  it('summarizes full git log — commit type distribution', async () => {
    const result = await summarizer.summarize(GIT_LOG_FULL, {});
    assert.ok(result.summary.includes('Commit types'), `Missing commit types: ${result.summary}`);
    assert.ok(result.summary.includes('feat'), `Missing feat type: ${result.summary}`);
    assert.ok(result.summary.includes('fix'), `Missing fix type: ${result.summary}`);
  });

  it('summarizes full git log — date range', async () => {
    const result = await summarizer.summarize(GIT_LOG_FULL, {});
    assert.ok(result.summary.includes('Date range'), `Missing date range: ${result.summary}`);
  });

  it('summarizes one-line git log format', async () => {
    const result = await summarizer.summarize(GIT_LOG_ONELINE, {});
    assert.equal(result.content_type, 'git-log');
    assert.ok(result.summary.includes('Git Log Summary'), `Missing heading: ${result.summary}`);
  });

  it('summary is shorter than original for full git log', async () => {
    const result = await summarizer.summarize(GIT_LOG_FULL, {});
    assert.ok(result.summary.length < GIT_LOG_FULL.length, 'Summary should be shorter than input');
    assert.ok(result.savings_pct > 0, `Expected positive savings: ${result.savings_pct}`);
  });

  it('includes Git Log Summary heading', async () => {
    const result = await summarizer.summarize(GIT_LOG_FULL, {});
    assert.ok(result.summary.includes('# Git Log Summary'), `Missing heading: ${result.summary}`);
  });
});

// ─── HtmlSummarizer ─────────────────────────────────────────────────────────

const HTML_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>My Awesome App</title>
</head>
<body>
  <nav>
    <a href="/">Home</a>
    <a href="/about">About</a>
    <a href="/contact">Contact</a>
  </nav>
  <main>
    <h1>Welcome to My App</h1>
    <p>This is the hero section with some introductory text that is quite long.</p>
    <h2>Features</h2>
    <p>Lots of great features here in this paragraph about various things.</p>
    <h2>Getting Started</h2>
    <p>Steps to get started with the application go here.</p>
    <h3>Installation</h3>
    <p>Install via npm install myapp.</p>
    <form action="/subscribe" method="post">
      <input type="email" name="email" placeholder="Your email">
      <button type="submit">Subscribe</button>
    </form>
    <form action="/login" method="post">
      <input type="text" name="username">
      <input type="password" name="password">
      <button type="submit">Login</button>
    </form>
  </main>
</body>
</html>`;

const HTML_FRAGMENT = `<html><head><title>Test</title></head><body><h1>Hello</h1></body></html>`;

describe('HtmlSummarizer', () => {
  const summarizer = new HtmlSummarizer();

  it('detects full HTML document', () => {
    assert.equal(summarizer.detect(HTML_PAGE), true);
  });

  it('detects HTML with DOCTYPE', () => {
    assert.equal(summarizer.detect('<!DOCTYPE html><html></html>'), true);
  });

  it('detects minimal html tag', () => {
    assert.equal(summarizer.detect('<html><body>hello</body></html>'), true);
  });

  it('detects <head> tag', () => {
    assert.equal(summarizer.detect('<head><title>x</title></head>'), true);
  });

  it('does not detect plain text without HTML tags', () => {
    const text = 'This is just plain text\nWith no HTML at all\nJust prose';
    assert.equal(summarizer.detect(text), false);
  });

  it('does not detect Markdown (no HTML tags)', () => {
    const md = '# Heading\n\n## Section\n\nSome paragraph text here.\n';
    assert.equal(summarizer.detect(md), false);
  });

  it('summarizes HTML — extracts title', async () => {
    const result = await summarizer.summarize(HTML_PAGE, {});
    assert.equal(result.content_type, 'html');
    assert.ok(result.summary.includes('My Awesome App'), `Expected title in: ${result.summary}`);
  });

  it('summarizes HTML — extracts headings', async () => {
    const result = await summarizer.summarize(HTML_PAGE, {});
    assert.ok(result.summary.includes('Headings'), `Missing headings section: ${result.summary}`);
    assert.ok(result.summary.includes('Welcome to My App'), `Missing h1: ${result.summary}`);
    assert.ok(result.summary.includes('Features'), `Missing h2 Features: ${result.summary}`);
    assert.ok(result.summary.includes('Installation'), `Missing h3 Installation: ${result.summary}`);
  });

  it('summarizes HTML — counts forms correctly', async () => {
    const result = await summarizer.summarize(HTML_PAGE, {});
    assert.ok(result.summary.includes('Forms: 2'), `Expected 2 forms in: ${result.summary}`);
  });

  it('summarizes HTML — counts navigation sections', async () => {
    const result = await summarizer.summarize(HTML_PAGE, {});
    assert.ok(result.summary.includes('Navigation sections: 1'), `Expected 1 nav: ${result.summary}`);
  });

  it('summarizes HTML — includes size', async () => {
    const result = await summarizer.summarize(HTML_PAGE, {});
    assert.ok(result.summary.includes('Size:'), `Missing size: ${result.summary}`);
  });

  it('summary is shorter than original for full HTML page', async () => {
    const result = await summarizer.summarize(HTML_PAGE, {});
    assert.ok(result.summary.length < HTML_PAGE.length, 'Summary should be shorter than input');
  });

  it('summarizes minimal HTML fragment', async () => {
    const result = await summarizer.summarize(HTML_FRAGMENT, {});
    assert.equal(result.content_type, 'html');
    assert.ok(result.summary.includes('Test'), `Expected title Test: ${result.summary}`);
    assert.ok(result.summary.includes('Hello'), `Expected h1 Hello: ${result.summary}`);
  });
});

// ─── MarkdownSummarizer ──────────────────────────────────────────────────────

const MARKDOWN_DOC = `# Context Memory

A powerful context management library for AI applications.

## Installation

\`\`\`bash
npm install context-mem
\`\`\`

## Usage

Import the library and create a client:

\`\`\`typescript
import { ContextMemClient } from 'context-mem';
const client = new ContextMemClient();
\`\`\`

## Configuration

### Basic Options

- **maxTokens**: Maximum tokens to store
- **summarize**: Enable automatic summarization

### Advanced Options

More advanced configuration options are available in the [full docs](https://docs.example.com).

## API Reference

### Methods

Check the [API docs](https://api.example.com) for the full reference.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.
`;

const MARKDOWN_SHORT = `# Title\nSome content here.`;

describe('MarkdownSummarizer', () => {
  const summarizer = new MarkdownSummarizer();

  it('detects Markdown with multiple headings', () => {
    assert.equal(summarizer.detect(MARKDOWN_DOC), true);
  });

  it('detects Markdown with exactly 2 headings', () => {
    const twoHeadings = '# Heading One\n\nContent.\n\n## Heading Two\n\nMore content here.\n';
    assert.equal(summarizer.detect(twoHeadings), true);
  });

  it('does not detect plain text without headings', () => {
    const text = 'Just a plain paragraph.\nAnother line.\nNo markdown structure.';
    assert.equal(summarizer.detect(text), false);
  });

  it('does not detect Markdown with only 1 heading', () => {
    assert.equal(summarizer.detect(MARKDOWN_SHORT), false);
  });

  it('does not detect HTML (no # headings)', () => {
    assert.equal(summarizer.detect(HTML_PAGE), false);
  });

  it('summarizes Markdown — extracts title', async () => {
    const result = await summarizer.summarize(MARKDOWN_DOC, {});
    assert.equal(result.content_type, 'markdown');
    assert.ok(result.summary.includes('Context Memory'), `Expected title: ${result.summary}`);
  });

  it('summarizes Markdown — lists all headings in structure', async () => {
    const result = await summarizer.summarize(MARKDOWN_DOC, {});
    assert.ok(result.summary.includes('Structure'), `Missing structure section: ${result.summary}`);
    assert.ok(result.summary.includes('Installation'), `Missing Installation heading: ${result.summary}`);
    assert.ok(result.summary.includes('Usage'), `Missing Usage heading: ${result.summary}`);
    assert.ok(result.summary.includes('Configuration'), `Missing Configuration heading: ${result.summary}`);
  });

  it('summarizes Markdown — counts code blocks', async () => {
    const result = await summarizer.summarize(MARKDOWN_DOC, {});
    assert.ok(result.summary.includes('Code blocks: 2'), `Expected 2 code blocks: ${result.summary}`);
  });

  it('summarizes Markdown — counts links', async () => {
    const result = await summarizer.summarize(MARKDOWN_DOC, {});
    assert.ok(result.summary.includes('Links:'), `Missing links count: ${result.summary}`);
    // There are 3 links: full docs, api docs, CONTRIBUTING.md
    assert.ok(result.summary.includes('Links: 3'), `Expected 3 links: ${result.summary}`);
  });

  it('summarizes Markdown — includes line count', async () => {
    const result = await summarizer.summarize(MARKDOWN_DOC, {});
    assert.ok(result.summary.includes('Lines:'), `Missing line count: ${result.summary}`);
  });

  it('summary is shorter than original for large Markdown doc', async () => {
    const result = await summarizer.summarize(MARKDOWN_DOC, {});
    assert.ok(result.summary.length < MARKDOWN_DOC.length, 'Summary should be shorter than input');
  });
});

// ─── NetworkSummarizer ───────────────────────────────────────────────────────

const NETWORK_LOG = `
GET /api/users 200 45ms
POST /api/users 201 120ms
GET /api/users/1 200 23ms
GET /api/users/2 200 18ms
PUT /api/users/1 200 95ms
DELETE /api/users/3 404 12ms
GET /api/products 200 67ms
POST /api/products 422 88ms
GET /api/products/5 200 31ms
GET /api/orders 500 2100ms
GET /api/orders/10 200 45ms
POST /api/auth/login 200 340ms
POST /api/auth/logout 200 15ms
GET /api/health 200 5ms
PATCH /api/users/1 200 77ms
GET /api/users 304 12ms
GET /api/products 200 55ms
DELETE /api/orders/7 200 44ms
GET /api/stats 200 234ms
POST /api/webhooks 200 18ms
`;

describe('NetworkSummarizer', () => {
  const summarizer = new NetworkSummarizer();

  it('detects network traffic with HTTP methods and status codes', () => {
    assert.equal(summarizer.detect(NETWORK_LOG), true);
  });

  it('does not detect content under 10 lines', () => {
    const short = 'GET /api/users 200\nPOST /api/users 201\nGET /api/orders 500';
    assert.equal(summarizer.detect(short), false);
  });

  it('does not detect content without HTTP methods', () => {
    const noMethods = Array.from({ length: 15 }, (_, i) =>
      `/api/endpoint/${i} responded with 200 OK`
    ).join('\n');
    assert.equal(summarizer.detect(noMethods), false);
  });

  it('does not detect content without status codes', () => {
    const noStatus = Array.from({ length: 15 }, (_, i) =>
      `GET /api/endpoint/${i} completed successfully`
    ).join('\n');
    assert.equal(summarizer.detect(noStatus), false);
  });

  it('summarizes network log — method distribution', async () => {
    const result = await summarizer.summarize(NETWORK_LOG, {});
    assert.equal(result.content_type, 'network');
    assert.ok(result.summary.includes('Methods'), `Missing methods section: ${result.summary}`);
    assert.ok(result.summary.includes('GET'), `Missing GET method: ${result.summary}`);
    assert.ok(result.summary.includes('POST'), `Missing POST method: ${result.summary}`);
  });

  it('summarizes network log — status code distribution', async () => {
    const result = await summarizer.summarize(NETWORK_LOG, {});
    assert.ok(result.summary.includes('Status codes'), `Missing status codes: ${result.summary}`);
    assert.ok(result.summary.includes('2xx'), `Missing 2xx category: ${result.summary}`);
    assert.ok(result.summary.includes('5xx') || result.summary.includes('4xx'), `Missing error codes: ${result.summary}`);
  });

  it('summarizes network log — unique endpoints', async () => {
    const result = await summarizer.summarize(NETWORK_LOG, {});
    assert.ok(result.summary.includes('Unique endpoints'), `Missing endpoints: ${result.summary}`);
    assert.ok(result.summary.includes('/api/users'), `Missing /api/users endpoint: ${result.summary}`);
  });

  it('summary is shorter than original for large network log', async () => {
    const result = await summarizer.summarize(NETWORK_LOG, {});
    assert.ok(result.summary.length < NETWORK_LOG.length, 'Summary should be shorter than input');
  });

  it('includes Network Summary heading', async () => {
    const result = await summarizer.summarize(NETWORK_LOG, {});
    assert.ok(result.summary.includes('# Network Summary'), `Missing heading: ${result.summary}`);
  });
});

// ─── TestOutputSummarizer ────────────────────────────────────────────────────

const JEST_OUTPUT_PASSING = `
 PASS  src/tests/auth.test.ts
 PASS  src/tests/user.test.ts
 PASS  src/tests/product.test.ts

Test Suites: 3 passed, 3 total
Tests:       47 passed, 47 total
Snapshots:   0 total
Time:        2.3s
Ran all test suites.
`;

const JEST_OUTPUT_WITH_FAILURES = `
 FAIL  src/tests/payment.test.ts
  ● PaymentService › processPayment › should charge correctly

    expect(received).toBe(expected)
    Expected: 100
    Received: 0

  ● PaymentService › refund › should refund partial amount

    TypeError: Cannot read property 'amount' of undefined

 PASS  src/tests/user.test.ts
 PASS  src/tests/auth.test.ts

Test Suites: 1 failed, 2 passed, 3 total
Tests:       2 failed, 35 passed, 37 total
Snapshots:   0 total
Time:        4.1s
`;

describe('TestOutputSummarizer', () => {
  const summarizer = new TestOutputSummarizer();

  it('detects Jest test output with "Tests: N total" pattern', () => {
    assert.equal(summarizer.detect(JEST_OUTPUT_PASSING), true);
  });

  it('detects Jest output with FAIL prefix', () => {
    assert.equal(summarizer.detect(JEST_OUTPUT_WITH_FAILURES), true);
  });

  it('detects output with PASS prefix', () => {
    assert.equal(summarizer.detect('PASS src/tests/something.test.ts'), true);
  });

  it('detects output with "test suites" keyword', () => {
    assert.equal(summarizer.detect('3 test suites ran successfully'), true);
  });

  it('does not detect regular log output', () => {
    const log = 'Server started on port 3000\nConnected to database\nReady to accept connections';
    assert.equal(summarizer.detect(log), false);
  });

  it('summarizes passing Jest output — correct counts', async () => {
    const result = await summarizer.summarize(JEST_OUTPUT_PASSING, {});
    assert.equal(result.content_type, 'test-output');
    assert.ok(result.summary.includes('Passed: 47'), `Expected Passed: 47 in: ${result.summary}`);
    assert.ok(result.summary.includes('Failed: 0'), `Expected Failed: 0 in: ${result.summary}`);
    assert.ok(result.summary.includes('Total: 47'), `Expected Total: 47 in: ${result.summary}`);
  });

  it('summarizes passing Jest output — duration', async () => {
    const result = await summarizer.summarize(JEST_OUTPUT_PASSING, {});
    assert.ok(result.summary.includes('2.3s') || result.summary.includes('Duration'), `Expected duration: ${result.summary}`);
  });

  it('summarizes failing Jest output — failure counts', async () => {
    const result = await summarizer.summarize(JEST_OUTPUT_WITH_FAILURES, {});
    assert.ok(result.summary.includes('Failed: 2'), `Expected Failed: 2 in: ${result.summary}`);
    assert.ok(result.summary.includes('Passed: 35'), `Expected Passed: 35 in: ${result.summary}`);
  });

  it('summarizes failing Jest output — includes Test Results heading', async () => {
    const result = await summarizer.summarize(JEST_OUTPUT_WITH_FAILURES, {});
    assert.ok(result.summary.includes('# Test Results'), `Missing heading: ${result.summary}`);
  });

  it('summarizes failing Jest output — lists failed test files', async () => {
    const result = await summarizer.summarize(JEST_OUTPUT_WITH_FAILURES, {});
    assert.ok(
      result.summary.includes('Failed tests') || result.summary.includes('FAIL'),
      `Expected failed test section: ${result.summary}`
    );
  });

  it('summary is shorter than original for verbose test output', async () => {
    const result = await summarizer.summarize(JEST_OUTPUT_WITH_FAILURES, {});
    assert.ok(result.summary.length < JEST_OUTPUT_WITH_FAILURES.length, 'Summary should be shorter');
  });

  it('suite count extracted correctly', async () => {
    const result = await summarizer.summarize(JEST_OUTPUT_PASSING, {});
    assert.ok(result.summary.includes('Suites: 3'), `Expected Suites: 3 in: ${result.summary}`);
  });
});

// ─── TypescriptErrorSummarizer ───────────────────────────────────────────────

const TS_ERRORS = `src/services/auth.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.
src/services/auth.ts(45,10): error TS2339: Property 'token' does not exist on type 'User'.
src/components/Button.tsx(8,3): error TS2322: Type 'string' is not assignable to type 'number'.
src/components/Button.tsx(22,15): error TS7006: Parameter 'event' implicitly has an 'any' type.
src/components/Modal.tsx(5,1): error TS2307: Cannot find module './utils' or its corresponding type declarations.
src/utils/helpers.ts(33,8): error TS2339: Property 'foo' does not exist on type 'Config'.
src/utils/helpers.ts(67,12): error TS2322: Type 'undefined' is not assignable to type 'string'.
src/models/user.ts(14,5): error TS1005: ';' expected.
`;

const TS_ERRORS_SINGLE = `src/index.ts(1,1): error TS2307: Cannot find module 'missing-package' or its corresponding type declarations.`;

describe('TypescriptErrorSummarizer', () => {
  const summarizer = new TypescriptErrorSummarizer();

  it('detects TypeScript error output', () => {
    assert.equal(summarizer.detect(TS_ERRORS), true);
  });

  it('detects single TS error', () => {
    assert.equal(summarizer.detect(TS_ERRORS_SINGLE), true);
  });

  it('does not detect regular text', () => {
    const text = 'Everything is working fine.\nNo issues detected.\nAll good.';
    assert.equal(summarizer.detect(text), false);
  });

  it('does not detect build output without TS errors', () => {
    const build = 'Compiling...\nBuild successful.\nDone in 3.2s';
    assert.equal(summarizer.detect(build), false);
  });

  it('summarizes TS errors — total error count', async () => {
    const result = await summarizer.summarize(TS_ERRORS, {});
    assert.equal(result.content_type, 'typescript-error');
    assert.ok(result.summary.includes('TypeScript Errors: 8 total'), `Expected 8 total errors: ${result.summary}`);
  });

  it('summarizes TS errors — errors per file', async () => {
    const result = await summarizer.summarize(TS_ERRORS, {});
    assert.ok(result.summary.includes('Errors per file'), `Missing errors per file: ${result.summary}`);
    // auth.ts has 2, Button.tsx has 2, helpers.ts has 2, Modal.tsx has 1, user.ts has 1
    assert.ok(result.summary.includes('src/services/auth.ts'), `Missing auth.ts: ${result.summary}`);
    assert.ok(result.summary.includes('src/components/Button.tsx'), `Missing Button.tsx: ${result.summary}`);
  });

  it('summarizes TS errors — error code distribution', async () => {
    const result = await summarizer.summarize(TS_ERRORS, {});
    assert.ok(result.summary.includes('Error codes'), `Missing error codes section: ${result.summary}`);
    // TS2322 appears 3 times
    assert.ok(result.summary.includes('TS2322'), `Missing TS2322: ${result.summary}`);
    assert.ok(result.summary.includes('3 occurrences'), `Expected TS2322 x3: ${result.summary}`);
  });

  it('summarizes TS errors — first errors preview (up to 3)', async () => {
    const result = await summarizer.summarize(TS_ERRORS, {});
    assert.ok(result.summary.includes('First errors'), `Missing first errors section: ${result.summary}`);
    // Should include first error message
    assert.ok(result.summary.includes('TS2322'), `Expected first error TS2322: ${result.summary}`);
  });

  it('summarizes TS errors — does not exceed 3 first errors', async () => {
    const result = await summarizer.summarize(TS_ERRORS, {});
    // Count "- TS" entries in the "First errors" section
    const firstErrorsSection = result.summary.split('## First errors')[1] ?? '';
    const errorLines = firstErrorsSection.split('\n').filter(l => l.trim().startsWith('-'));
    assert.ok(errorLines.length <= 3, `Expected at most 3 first errors, got ${errorLines.length}`);
  });

  it('summary is shorter than original for large TS error output', async () => {
    // Generate large TS error output
    const bigErrors = Array.from({ length: 50 }, (_, i) =>
      `src/file${i}.ts(${i + 1},1): error TS2322: Type 'string' is not assignable to type 'number'.`
    ).join('\n');
    const result = await summarizer.summarize(bigErrors, {});
    assert.ok(result.summary.length < bigErrors.length, 'Summary should be shorter than input');
    assert.ok(result.savings_pct > 0, `Expected positive savings: ${result.savings_pct}`);
  });

  it('summarizes single TS error', async () => {
    const result = await summarizer.summarize(TS_ERRORS_SINGLE, {});
    assert.equal(result.content_type, 'typescript-error');
    assert.ok(result.summary.includes('TypeScript Errors: 1 total'), `Expected 1 error: ${result.summary}`);
    assert.ok(result.summary.includes('TS2307'), `Missing TS2307: ${result.summary}`);
  });
});
