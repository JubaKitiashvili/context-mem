import * as vscode from 'vscode';
import { McpManager } from './mcp-manager';
import { StatusBarManager } from './status-bar';
import { DashboardProvider } from './dashboard-provider';

let mcpManager: McpManager;
let statusBar: StatusBarManager;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('context-mem');

  mcpManager = new McpManager(context);
  statusBar = new StatusBarManager(config);

  const dashboardProvider = new DashboardProvider(context.extensionUri, mcpManager);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('context-mem.dashboard', dashboardProvider),

    vscode.commands.registerCommand('context-mem.start', () => mcpManager.start()),
    vscode.commands.registerCommand('context-mem.stop', () => mcpManager.stop()),
    vscode.commands.registerCommand('context-mem.restart', () => mcpManager.restart()),

    vscode.commands.registerCommand('context-mem.openDashboard', () => {
      const port = config.get<number>('port', 51893);
      vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${port}`));
    }),

    vscode.commands.registerCommand('context-mem.showStats', () => showStats()),
    vscode.commands.registerCommand('context-mem.search', () => searchObservations()),
    vscode.commands.registerCommand('context-mem.init', () => initWorkspace()),

    mcpManager,
    statusBar,
  );

  if (config.get<boolean>('autoStart', true)) {
    await mcpManager.start();
  }

  if (config.get<boolean>('showStatusBar', true)) {
    statusBar.show();
    statusBar.startPolling(mcpManager, config.get<number>('statusBarRefreshInterval', 10));
  }
}

export function deactivate(): void {
  mcpManager?.stop();
  statusBar?.dispose();
}

async function showStats(): Promise<void> {
  const stats = await mcpManager.getStats();
  if (!stats) {
    vscode.window.showWarningMessage('context-mem server is not running.');
    return;
  }
  const panel = vscode.window.createWebviewPanel(
    'context-mem.stats',
    'context-mem Stats',
    vscode.ViewColumn.Beside,
    {},
  );
  panel.webview.html = `<!DOCTYPE html>
<html><head><style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--vscode-panel-border); }
  .big { font-size: 2em; font-weight: bold; }
  .savings { color: #4ec9b0; }
</style></head><body>
  <h2>Token Economics</h2>
  <p class="big savings">${stats.savings ?? '—'}% saved</p>
  <table>
    <tr><th>Metric</th><th>Value</th></tr>
    <tr><td>Observations</td><td>${stats.observations ?? 0}</td></tr>
    <tr><td>Raw tokens</td><td>${(stats.rawTokens ?? 0).toLocaleString()}</td></tr>
    <tr><td>Compressed tokens</td><td>${(stats.compressedTokens ?? 0).toLocaleString()}</td></tr>
    <tr><td>Session</td><td>${stats.sessionId ?? '—'}</td></tr>
  </table>
</body></html>`;
}

async function searchObservations(): Promise<void> {
  const query = await vscode.window.showInputBox({
    prompt: 'Search context-mem observations',
    placeHolder: 'e.g. error handling, API response, test failure...',
  });
  if (!query) return;

  const results = await mcpManager.search(query);
  if (!results || results.length === 0) {
    vscode.window.showInformationMessage(`No results for "${query}"`);
    return;
  }

  const items = results.map((r: any) => ({
    label: r.summary?.substring(0, 80) ?? `Observation #${r.id}`,
    description: r.type,
    detail: r.summary,
    id: r.id,
  }));

  const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select observation' });
  if (picked) {
    const full = await mcpManager.get(picked.id);
    if (full) {
      const doc = await vscode.workspace.openTextDocument({ content: full.content, language: 'text' });
      await vscode.window.showTextDocument(doc, { preview: true });
    }
  }
}

async function initWorkspace(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('No workspace folder open.');
    return;
  }

  const terminal = vscode.window.createTerminal('context-mem');
  terminal.show();
  terminal.sendText(`cd "${workspaceFolders[0].uri.fsPath}" && npx -y context-mem init`);
}
