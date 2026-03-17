import * as vscode from 'vscode';
import { McpManager } from './mcp-manager';

export class DashboardProvider implements vscode.WebviewViewProvider {
  constructor(
    private extensionUri: vscode.Uri,
    private mcpManager: McpManager,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'refresh':
          await this.sendStats(webviewView.webview);
          break;
        case 'start':
          await this.mcpManager.start();
          break;
        case 'stop':
          this.mcpManager.stop();
          break;
        case 'openDashboard':
          vscode.commands.executeCommand('context-mem.openDashboard');
          break;
        case 'search':
          vscode.commands.executeCommand('context-mem.search');
          break;
      }
    });

    this.mcpManager.onStatusChange(() => this.sendStats(webviewView.webview));

    // Auto-refresh every 10s
    const timer = setInterval(() => this.sendStats(webviewView.webview), 10_000);
    webviewView.onDidDispose(() => clearInterval(timer));

    // Initial data
    this.sendStats(webviewView.webview);
  }

  private async sendStats(webview: vscode.Webview): Promise<void> {
    const stats = await this.mcpManager.getStats();
    webview.postMessage({
      command: 'stats',
      running: this.mcpManager.running,
      data: stats,
    });
  }

  private getHtml(webview: vscode.Webview): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
    padding: 12px;
    font-size: 13px;
  }
  h3 { font-size: 14px; margin-bottom: 8px; font-weight: 600; }
  .status {
    display: flex; align-items: center; gap: 6px;
    padding: 8px; margin-bottom: 12px;
    background: var(--vscode-editor-background);
    border-radius: 4px;
  }
  .dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--vscode-testing-iconFailed);
  }
  .dot.running { background: var(--vscode-testing-iconPassed); }
  .metric {
    display: flex; justify-content: space-between;
    padding: 6px 0;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .metric-value { font-weight: 600; }
  .savings-big {
    font-size: 24px; font-weight: 700;
    color: var(--vscode-testing-iconPassed);
    text-align: center; padding: 12px 0;
  }
  .btn-row { display: flex; gap: 6px; margin-top: 12px; flex-wrap: wrap; }
  button {
    flex: 1; padding: 6px 10px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none; border-radius: 3px;
    cursor: pointer; font-size: 12px;
    min-width: 70px;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  .section { margin-bottom: 16px; }
  .empty { color: var(--vscode-descriptionForeground); font-style: italic; padding: 8px 0; }
</style>
</head>
<body>
  <div class="status">
    <span class="dot" id="statusDot"></span>
    <span id="statusText">Checking...</span>
  </div>

  <div class="section">
    <div class="savings-big" id="savings">—</div>
  </div>

  <div class="section">
    <h3>Token Economics</h3>
    <div class="metric"><span>Observations</span><span class="metric-value" id="observations">—</span></div>
    <div class="metric"><span>Raw tokens</span><span class="metric-value" id="rawTokens">—</span></div>
    <div class="metric"><span>Compressed</span><span class="metric-value" id="compressedTokens">—</span></div>
    <div class="metric"><span>Session</span><span class="metric-value" id="sessionId">—</span></div>
  </div>

  <div class="btn-row">
    <button id="btnStart">Start</button>
    <button id="btnStop" class="secondary">Stop</button>
  </div>
  <div class="btn-row">
    <button id="btnDashboard" class="secondary">Dashboard</button>
    <button id="btnSearch" class="secondary">Search</button>
    <button id="btnRefresh" class="secondary">Refresh</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    document.getElementById('btnStart').addEventListener('click', () => vscode.postMessage({ command: 'start' }));
    document.getElementById('btnStop').addEventListener('click', () => vscode.postMessage({ command: 'stop' }));
    document.getElementById('btnDashboard').addEventListener('click', () => vscode.postMessage({ command: 'openDashboard' }));
    document.getElementById('btnSearch').addEventListener('click', () => vscode.postMessage({ command: 'search' }));
    document.getElementById('btnRefresh').addEventListener('click', () => vscode.postMessage({ command: 'refresh' }));

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.command === 'stats') {
        const dot = document.getElementById('statusDot');
        const statusText = document.getElementById('statusText');

        if (msg.running) {
          dot.classList.add('running');
          statusText.textContent = 'Running';
        } else {
          dot.classList.remove('running');
          statusText.textContent = 'Stopped';
        }

        if (msg.data) {
          document.getElementById('savings').textContent = (msg.data.savings ?? 0) + '% saved';
          document.getElementById('observations').textContent = String(msg.data.observations ?? 0);
          document.getElementById('rawTokens').textContent = (msg.data.rawTokens ?? 0).toLocaleString();
          document.getElementById('compressedTokens').textContent = (msg.data.compressedTokens ?? 0).toLocaleString();
          document.getElementById('sessionId').textContent = msg.data.sessionId ?? '—';
        }
      }
    });

    // Initial refresh
    vscode.postMessage({ command: 'refresh' });
  </script>
</body>
</html>`;
  }
}
