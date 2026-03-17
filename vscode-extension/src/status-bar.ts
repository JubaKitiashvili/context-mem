import * as vscode from 'vscode';
import { McpManager } from './mcp-manager';

export class StatusBarManager implements vscode.Disposable {
  private item: vscode.StatusBarItem;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(config: vscode.WorkspaceConfiguration) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'context-mem.showStats';
    this.item.tooltip = 'context-mem — click for token stats';
    this.setIdle();
  }

  show(): void {
    this.item.show();
  }

  hide(): void {
    this.item.hide();
  }

  startPolling(manager: McpManager, intervalSeconds: number): void {
    this.stopPolling();

    manager.onStatusChange((status) => {
      if (status === 'stopped') this.setIdle();
    });

    this.timer = setInterval(async () => {
      if (!manager.running) {
        this.setIdle();
        return;
      }

      const stats = await manager.getStats();
      if (stats) {
        this.setSavings(stats.savings, stats.observations);
      } else {
        this.setRunning();
      }
    }, intervalSeconds * 1000);

    // Initial fetch
    if (manager.running) {
      this.setRunning();
      manager.getStats().then((stats) => {
        if (stats) this.setSavings(stats.savings, stats.observations);
      });
    }
  }

  stopPolling(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private setIdle(): void {
    this.item.text = '$(database) ctx-mem';
    this.item.backgroundColor = undefined;
  }

  private setRunning(): void {
    this.item.text = '$(sync~spin) ctx-mem';
    this.item.backgroundColor = undefined;
  }

  private setSavings(savings: number, observations: number): void {
    this.item.text = `$(database) ctx-mem: ${savings}% saved (${observations})`;
    this.item.backgroundColor = undefined;
  }

  dispose(): void {
    this.stopPolling();
    this.item.dispose();
  }
}
