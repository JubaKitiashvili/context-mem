import * as vscode from 'vscode';
import { ChildProcess, spawn } from 'node:child_process';
import { join } from 'node:path';

export interface StatsResult {
  observations: number;
  rawTokens: number;
  compressedTokens: number;
  savings: number;
  sessionId: string;
}

export interface SearchResult {
  id: number;
  summary: string;
  type: string;
}

export interface ObservationResult {
  id: number;
  content: string;
  summary: string;
  type: string;
}

export class McpManager implements vscode.Disposable {
  private process: ChildProcess | null = null;
  private outputChannel: vscode.OutputChannel;
  private statusEmitter = new vscode.EventEmitter<'started' | 'stopped'>();
  readonly onStatusChange = this.statusEmitter.event;
  private _running = false;

  constructor(private context: vscode.ExtensionContext) {
    this.outputChannel = vscode.window.createOutputChannel('context-mem');
  }

  get running(): boolean {
    return this._running;
  }

  private get port(): number {
    return vscode.workspace.getConfiguration('context-mem').get<number>('port', 51893);
  }

  private get workDir(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  async start(): Promise<void> {
    if (this._running) {
      vscode.window.showInformationMessage('context-mem server is already running.');
      return;
    }

    const cwd = this.workDir;
    if (!cwd) {
      vscode.window.showWarningMessage('No workspace folder open. context-mem needs a project directory.');
      return;
    }

    try {
      this.process = spawn('npx', ['-y', 'context-mem', 'serve', '--port', String(this.port)], {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'production' },
        shell: true,
      });

      this.process.stdout?.on('data', (data: Buffer) => {
        this.outputChannel.append(data.toString());
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        this.outputChannel.append(data.toString());
      });

      this.process.on('exit', (code) => {
        this._running = false;
        this.statusEmitter.fire('stopped');
        if (code !== 0 && code !== null) {
          this.outputChannel.appendLine(`context-mem exited with code ${code}`);
        }
      });

      this.process.on('error', (err) => {
        this._running = false;
        this.statusEmitter.fire('stopped');
        vscode.window.showErrorMessage(`context-mem failed to start: ${err.message}`);
      });

      this._running = true;
      this.statusEmitter.fire('started');
      this.outputChannel.appendLine(`context-mem started (port ${this.port}, cwd: ${cwd})`);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to start context-mem: ${err.message}`);
    }
  }

  stop(): void {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
    this._running = false;
    this.statusEmitter.fire('stopped');
    this.outputChannel.appendLine('context-mem stopped.');
  }

  async restart(): Promise<void> {
    this.stop();
    await new Promise((r) => setTimeout(r, 500));
    await this.start();
  }

  async getStats(): Promise<StatsResult | null> {
    return this.httpGet<StatsResult>('/api/stats');
  }

  async search(query: string): Promise<SearchResult[] | null> {
    return this.httpGet<SearchResult[]>(`/api/search?q=${encodeURIComponent(query)}`);
  }

  async get(id: number): Promise<ObservationResult | null> {
    return this.httpGet<ObservationResult>(`/api/observations/${id}`);
  }

  private async httpGet<T>(path: string): Promise<T | null> {
    if (!this._running) return null;
    try {
      const url = `http://localhost:${this.port}${path}`;
      const response = await fetch(url);
      if (!response.ok) return null;
      return (await response.json()) as T;
    } catch {
      return null;
    }
  }

  dispose(): void {
    this.stop();
    this.outputChannel.dispose();
    this.statusEmitter.dispose();
  }
}
