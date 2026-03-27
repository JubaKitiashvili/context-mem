import * as fs from 'node:fs';
import * as path from 'node:path';

export async function createSummarizer(args: string[]): Promise<void> {
  const name = args[0];
  if (!name) {
    console.error('Usage: context-mem create-summarizer <name>');
    console.error('Example: context-mem create-summarizer k8s');
    process.exit(1);
  }

  const packageName = name.startsWith('context-mem-summarizer-')
    ? name
    : `context-mem-summarizer-${name}`;

  const dir = path.resolve(packageName);
  if (fs.existsSync(dir)) {
    console.error(`Directory "${packageName}" already exists.`);
    process.exit(1);
  }

  fs.mkdirSync(dir, { recursive: true });

  // package.json
  const pkg = {
    name: packageName,
    version: '1.0.0',
    description: `Custom summarizer plugin for context-mem: ${name}`,
    main: './dist/index.js',
    types: './dist/index.d.ts',
    keywords: ['context-mem-summarizer', 'context-mem', 'mcp'],
    scripts: {
      build: 'tsc',
      prepublishOnly: 'npm run build',
    },
    peerDependencies: {
      'context-mem': '>=1.0.0',
    },
    devDependencies: {
      typescript: '^5.5.0',
    },
    license: 'MIT',
  };
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(pkg, null, 2) + '\n',
  );

  // tsconfig.json
  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'Node16',
      moduleResolution: 'Node16',
      lib: ['ES2022'],
      outDir: './dist',
      rootDir: './src',
      declaration: true,
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
    },
    include: ['src/**/*'],
    exclude: ['node_modules', 'dist'],
  };
  fs.writeFileSync(
    path.join(dir, 'tsconfig.json'),
    JSON.stringify(tsconfig, null, 2) + '\n',
  );

  // src/index.ts
  const srcDir = path.join(dir, 'src');
  fs.mkdirSync(srcDir, { recursive: true });

  const indexTs = `// ${packageName} — Custom summarizer plugin for context-mem
//
// Implement detect() and summarize() to handle your content type.
// Priority: 50 = run before built-ins, 950 = run after built-ins.

export default {
  name: '${packageName}',
  version: '1.0.0',
  type: 'summarizer' as const,
  priority: 50,

  /**
   * Return true if this summarizer should handle this content.
   * Inspect the content string and return true for your target format.
   */
  detect(content: string): boolean {
    // Example: detect Kubernetes log output
    // return content.includes('kubectl') || content.includes('pod/');
    return false;
  },

  /**
   * Return a compressed summary of the content.
   * The summary should preserve key information while reducing token count.
   */
  summarize(content: string): string {
    // Example: extract key fields from K8s output
    return content;
  },

  // Optional lifecycle hooks
  // async init(config: Record<string, unknown>): Promise<void> {},
  // async destroy(): Promise<void> {},
};
`;
  fs.writeFileSync(path.join(srcDir, 'index.ts'), indexTs);

  // README.md
  const readme = `# ${packageName}

Custom summarizer plugin for [context-mem](https://github.com/juba/context-mem).

## Installation

\`\`\`bash
npm install ${packageName}
\`\`\`

## Configuration

Add to your project's \`.context-mem.json\`:

\`\`\`json
{
  "plugins": {
    "external_summarizers": {
      "${packageName}": { "enabled": true, "priority": 50 }
    }
  }
}
\`\`\`

## Development

1. Edit \`src/index.ts\` — implement \`detect()\` and \`summarize()\`
2. Build: \`npm run build\`
3. Test locally: \`npm link\` then \`npm link ${packageName}\` in your project

## Plugin API

- \`detect(content: string): boolean\` — return true if this plugin handles the content
- \`summarize(content: string): string\` — return a compressed summary
- \`priority\` — lower runs first (50 = before built-ins, 950 = after)

## License

MIT
`;
  fs.writeFileSync(path.join(dir, 'README.md'), readme);

  console.log(`Created summarizer plugin scaffold: ${packageName}/`);
  console.log('');
  console.log('Next steps:');
  console.log(`  cd ${packageName}`);
  console.log('  npm install');
  console.log('  # Edit src/index.ts — implement detect() and summarize()');
  console.log('  npm run build');
  console.log('  npm link  # then npm link ' + packageName + ' in your project');
}
