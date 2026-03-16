import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CodeSummarizer } from '../../../plugins/summarizers/code-summarizer.js';

// Helper: build a string with N extra filler lines so it crosses the 20-line threshold
function padLines(core: string, total = 25): string {
  const lines = core.split('\n');
  while (lines.length < total) {
    lines.push('// padding');
  }
  return lines.join('\n');
}

describe('CodeSummarizer', () => {
  let summarizer: CodeSummarizer;

  it('detects TypeScript/JavaScript code', () => {
    summarizer = new CodeSummarizer();
    const content = padLines(
      [
        'import { foo } from "bar";',
        'export const VALUE = 42;',
        'function greet(name: string): string {',
        '  return `Hello ${name}`;',
        '}',
        'class MyService {',
        '  private name: string;',
        '}',
      ].join('\n'),
    );
    assert.equal(summarizer.detect(content), true);
  });

  it('detects Python code', () => {
    summarizer = new CodeSummarizer();
    const content = padLines(
      [
        'import os',
        'from pathlib import Path',
        'def greet(name: str) -> str:',
        '    return f"Hello {name}"',
        'class MyService:',
        '    def __init__(self):',
        '        self.name = "test"',
      ].join('\n'),
    );
    assert.equal(summarizer.detect(content), true);
  });

  it('does not detect plain text', () => {
    summarizer = new CodeSummarizer();
    const content = padLines(
      [
        'This is a regular paragraph with some prose.',
        'It talks about various topics.',
        'There are no code constructs here.',
        'Just sentences and words.',
        'Nothing special going on.',
      ].join('\n'),
    );
    assert.equal(summarizer.detect(content), false);
  });

  it('summarizes JS/TS functions and classes', async () => {
    summarizer = new CodeSummarizer();
    const content = [
      'import { Injectable } from "@angular/core";',
      'import { HttpClient } from "@angular/common/http";',
      '',
      'export const BASE_URL = "https://api.example.com";',
      '',
      'export class UserService {',
      '  private users: string[] = [];',
      '',
      '  constructor(private http: HttpClient) {',
      '    this.users = [];',
      '    console.log("init");',
      '  }',
      '',
      '  function getUser(id: string): string {',
      '    const result = this.users.find(u => u === id);',
      '    return result ?? "unknown";',
      '  }',
      '',
      '  function saveUser(user: string): void {',
      '    this.users.push(user);',
      '    console.log("saved");',
      '  }',
      '}',
      '',
      'export function formatName(first: string, last: string): string {',
      '  return `${first} ${last}`.trim();',
      '}',
    ].join('\n');

    const result = await summarizer.summarize(content, {});

    // Should include signatures / export lines
    assert.ok(result.summary.includes('UserService'), 'should include class name');
    assert.ok(result.summary.includes('BASE_URL'), 'should include exported const');
    assert.ok(result.summary.includes('import'), 'should include import lines');

    // Should NOT include body details
    assert.ok(!result.summary.includes('this.users.push'), 'should strip function bodies');
    assert.ok(!result.summary.includes('console.log'), 'should strip console.log body lines');
  });

  it('summarizes Python functions', async () => {
    summarizer = new CodeSummarizer();
    const content = [
      'import os',
      'import sys',
      'from pathlib import Path',
      'from typing import List, Optional',
      '',
      'BASE_DIR = Path(__file__).parent',
      '',
      'class FileProcessor:',
      '    """Processes files in a directory."""',
      '',
      '    def __init__(self, directory: str) -> None:',
      '        self.directory = directory',
      '        self._files: List[str] = []',
      '        self._load()',
      '',
      '    def _load(self) -> None:',
      '        for f in os.listdir(self.directory):',
      '            self._files.append(f)',
      '',
      '    def process(self, name: str) -> Optional[str]:',
      '        if name in self._files:',
      '            return os.path.join(self.directory, name)',
      '        return None',
      '',
      'def main() -> None:',
      '    processor = FileProcessor(".")',
      '    result = processor.process("test.txt")',
      '    print(result)',
    ].join('\n');

    const result = await summarizer.summarize(content, {});

    // Should include signatures
    assert.ok(result.summary.includes('def __init__'), 'should include __init__ signature');
    assert.ok(result.summary.includes('def process'), 'should include process signature');
    assert.ok(result.summary.includes('class FileProcessor'), 'should include class name');
    assert.ok(result.summary.includes('import os'), 'should include import lines');

    // Should NOT include body details
    assert.ok(!result.summary.includes('os.listdir'), 'should strip loop body');
    assert.ok(!result.summary.includes('self._files.append'), 'should strip append call');
  });

  it('passes through short code', async () => {
    summarizer = new CodeSummarizer();
    const short = [
      'function add(a: number, b: number): number {',
      '  return a + b;',
      '}',
    ].join('\n');

    const result = await summarizer.summarize(short, {});
    assert.equal(result.summary, short);
    assert.equal(result.savings_pct, 0);
  });
});
