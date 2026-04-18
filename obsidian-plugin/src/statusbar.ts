/**
 * Status-bar indicator for the context-mem bridge.
 *
 * Shows a small coloured dot in Obsidian's bottom status bar:
 *   ● green  — bridge reachable
 *   ● red    — bridge unreachable / context-mem not running
 *
 * Polls every 30 seconds. Tooltip shows port + last-check time.
 */
import type ContextMemPlugin from './main';

const POLL_INTERVAL_MS = 30_000;

export function createStatusBarItem(plugin: ContextMemPlugin): void {
  const item = plugin.addStatusBarItem();
  item.addClass('context-mem-status');

  // Inline styles keep the dot readable without a separate CSS file
  const dot = item.createSpan();
  dot.style.fontSize = '14px';
  dot.style.lineHeight = '1';
  dot.style.verticalAlign = 'middle';

  const label = item.createSpan();
  label.style.fontSize = '11px';
  label.style.marginLeft = '3px';
  label.style.verticalAlign = 'middle';

  function setStatus(reachable: boolean, lastCheck: Date): void {
    dot.setText(reachable ? '●' : '●');
    dot.style.color = reachable ? '#4caf50' : '#f44336';
    label.setText('ctx-mem');
    const time = lastCheck.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    item.title = reachable
      ? `context-mem connected (port ${plugin.settings.bridgePort}) — checked ${time}`
      : `context-mem unreachable (port ${plugin.settings.bridgePort}) — checked ${time}\nRun: context-mem serve`;
  }

  async function poll(): Promise<void> {
    const reachable = await plugin.bridge.isReachable();
    setStatus(reachable, new Date());
  }

  // Initial check
  poll();

  // Recurring poll
  const intervalId = window.setInterval(poll, POLL_INTERVAL_MS);

  // Clean up interval when plugin unloads
  plugin.registerInterval(intervalId);
}
