import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

export async function dashboard(args: string[]): Promise<void> {
  const projectDir = process.cwd();
  const dbPath = path.join(projectDir, '.context-mem', 'store.db');

  if (!fs.existsSync(dbPath)) {
    console.error('No database found. Run `context-mem init` first.');
    process.exit(1);
  }

  const serverScript = path.join(__dirname, '..', '..', '..', 'dashboard', 'server.js');
  if (!fs.existsSync(serverScript)) {
    console.error('Dashboard server not found at:', serverScript);
    process.exit(1);
  }

  const port = args.includes('--port') ? args[args.indexOf('--port') + 1] : '51893';
  const background = args.includes('--bg') || args.includes('--background');
  const noOpen = args.includes('--no-open');

  const spawnArgs = [serverScript, '--port', port, '--db', dbPath, '--project', projectDir];
  if (noOpen) spawnArgs.push('--no-open');

  if (background) {
    // Detached background process
    const child = spawn('node', spawnArgs, {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    });
    child.unref();

    // Write PID for later cleanup
    const pidFile = path.join(projectDir, '.context-mem', 'dashboard.pid');
    fs.writeFileSync(pidFile, String(child.pid));

    console.log(`context-mem dashboard started (pid: ${child.pid}, port: ${port})`);
    console.log(`  URL: http://127.0.0.1:${port}`);
    console.log(`  PID: ${pidFile}`);
  } else {
    // Foreground — blocks until ctrl-c
    const child = spawn('node', spawnArgs, {
      stdio: 'inherit',
      env: { ...process.env },
    });

    child.on('exit', (code) => process.exit(code ?? 0));

    // Forward signals
    process.on('SIGTERM', () => child.kill('SIGTERM'));
    process.on('SIGINT', () => child.kill('SIGINT'));
  }
}
