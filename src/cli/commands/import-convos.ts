import fs from 'node:fs';
import path from 'node:path';
import { Kernel } from '../../core/kernel.js';
import { importConversations } from '../../core/conversation-import.js';
import type { ConversationFormat } from '../../core/conversation-parsers/auto-detect.js';

export async function importConvos(args: string[]): Promise<void> {
  const projectDir = process.cwd();
  const dbPath = path.join(projectDir, '.context-mem', 'store.db');

  if (!fs.existsSync(dbPath)) {
    console.error('No database found. Run `context-mem init` first.');
    process.exit(1);
  }

  const filePath = args[0];
  if (!filePath) {
    console.log(`Usage: context-mem import-convos <path> [--format auto|claude-code|claude-ai|chatgpt|slack|plaintext]

Examples:
  context-mem import-convos conversations.json
  context-mem import-convos transcript.jsonl --format claude-code
  context-mem import-convos chat-export.json --format chatgpt`);
    return;
  }

  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    console.error(`File not found: ${absPath}`);
    process.exit(1);
  }

  let format: ConversationFormat = 'auto';
  const fmtIdx = args.indexOf('--format');
  if (fmtIdx !== -1 && args[fmtIdx + 1]) {
    format = args[fmtIdx + 1] as ConversationFormat;
  }

  const content = fs.readFileSync(absPath, 'utf8');
  const kernel = new Kernel(projectDir);
  await kernel.start();

  try {
    const result = await importConversations(content, kernel.pipeline, {
      format,
      filename: path.basename(absPath),
    });

    console.log(`Import complete:
  Format: ${result.format}
  Imported: ${result.imported} exchanges
  Skipped: ${result.skipped} (duplicates)
  Errors: ${result.errors.length}`);

    if (result.errors.length > 0) {
      console.log('\nErrors:');
      for (const err of result.errors.slice(0, 5)) {
        console.log(`  - ${err}`);
      }
    }
  } finally {
    await kernel.stop();
  }
}
