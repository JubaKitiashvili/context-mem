/**
 * Context Mem sidebar panel (right leaf view).
 *
 * Sections:
 *  1. Bridge status + refresh button
 *  2. Quick observe — textarea + type picker + submit
 *  3. Dashboard link
 *  4. Vault stats (from .context-mem/vault/index.md)
 *  5. Recent observations (last 10 entries from log.md)
 */
import { ItemView, WorkspaceLeaf, Notice, DropdownComponent } from 'obsidian';
import type ContextMemPlugin from './main';
import { OBSERVATION_TYPES, type ObservationType } from './bridge';

export const VIEW_TYPE_CONTEXT_MEM = 'context-mem-sidebar';

// Matches lines like: ## [2026-04-18T10:30:00.000Z] observe | some summary text
const LOG_ENTRY_RE = /^##\s+\[([^\]]+)\]\s+(\w+)\s*\|\s*(.*)$/;

export class ContextMemSidebar extends ItemView {
  plugin: ContextMemPlugin;

  // DOM refs updated on refresh
  private statusEl!: HTMLElement;
  private statsEl!: HTMLElement;
  private logEl!: HTMLElement;
  private observeTextarea!: HTMLTextAreaElement;
  private observeTypeDropdown!: DropdownComponent;
  private dashboardBtn!: HTMLButtonElement;

  constructor(leaf: WorkspaceLeaf, plugin: ContextMemPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_CONTEXT_MEM;
  }

  getDisplayText(): string {
    return 'Context Mem';
  }

  getIcon(): string {
    // 'brain-circuit' is available in Obsidian 1.4+; falls back to 'brain' on older builds
    return 'brain-circuit';
  }

  async onOpen(): Promise<void> {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.style.padding = '12px';
    root.style.overflowY = 'auto';

    // ── Section: Bridge status ────────────────────────────────────────────────
    const statusSection = root.createDiv({ cls: 'cm-section' });
    statusSection.createEl('h4', { text: 'Bridge status' });
    this.statusEl = statusSection.createDiv({ cls: 'cm-status-text' });
    this.statusEl.style.fontFamily = 'var(--font-monospace)';
    this.statusEl.style.fontSize = '12px';
    this.statusEl.style.marginBottom = '6px';

    const refreshBtn = statusSection.createEl('button', { text: 'Refresh' });
    refreshBtn.style.marginBottom = '12px';
    refreshBtn.onclick = () => this.refresh();

    // ── Section: Quick observe ────────────────────────────────────────────────
    const observeSection = root.createDiv({ cls: 'cm-section' });
    observeSection.createEl('h4', { text: 'Quick observe' });

    this.observeTextarea = observeSection.createEl('textarea');
    this.observeTextarea.placeholder = 'Paste content to observe…';
    this.observeTextarea.rows = 4;
    this.observeTextarea.style.width = '100%';
    this.observeTextarea.style.resize = 'vertical';
    this.observeTextarea.style.marginBottom = '6px';
    this.observeTextarea.style.boxSizing = 'border-box';

    // Type dropdown
    const typeRow = observeSection.createDiv();
    typeRow.style.display = 'flex';
    typeRow.style.gap = '8px';
    typeRow.style.marginBottom = '8px';
    typeRow.style.alignItems = 'center';

    typeRow.createSpan({ text: 'Type:' });
    const selectEl = typeRow.createEl('select');
    selectEl.style.flex = '1';
    for (const t of OBSERVATION_TYPES) {
      const opt = selectEl.createEl('option', { value: t, text: t });
      if (t === 'note') opt.selected = true;
    }
    // Wrap in DropdownComponent-like accessor (we use the raw <select> directly)
    // Note: DropdownComponent requires a containerEl; using the raw select is simpler here.

    const observeBtn = observeSection.createEl('button', { text: 'Observe' });
    observeBtn.style.width = '100%';
    observeBtn.setCssProps({ '--button-radius': '4px' });
    observeBtn.onclick = async () => {
      const content = this.observeTextarea.value.trim();
      if (!content) {
        new Notice('Nothing to observe — paste some content first.');
        return;
      }
      const type = selectEl.value as ObservationType;
      observeBtn.textContent = 'Sending…';
      observeBtn.disabled = true;
      try {
        const res = await this.plugin.bridge.observe(content, type, 'obsidian-sidebar');
        if (res.ok) {
          new Notice('Observed successfully.');
          this.observeTextarea.value = '';
          // Refresh log after a short delay to let bridge flush
          setTimeout(() => this.refreshLog(), 1500);
        } else {
          new Notice(`Observe failed: ${res.error ?? 'unknown error'}`);
        }
      } finally {
        observeBtn.textContent = 'Observe';
        observeBtn.disabled = false;
      }
    };

    // ── Section: Dashboard ────────────────────────────────────────────────────
    const dashSection = root.createDiv({ cls: 'cm-section' });
    dashSection.style.marginTop = '12px';
    this.dashboardBtn = dashSection.createEl('button', { text: 'Open dashboard' });
    this.dashboardBtn.style.width = '100%';
    this.dashboardBtn.disabled = true;
    this.dashboardBtn.onclick = async () => {
      const info = await this.plugin.bridge.serviceInfo();
      if (info?.dashboard) {
        window.open(info.dashboard, '_blank');
      } else {
        new Notice('Cannot reach bridge — start context-mem first.');
      }
    };

    // ── Section: Vault stats ──────────────────────────────────────────────────
    const statsSection = root.createDiv({ cls: 'cm-section' });
    statsSection.style.marginTop = '12px';
    statsSection.createEl('h4', { text: 'Vault stats' });
    this.statsEl = statsSection.createDiv({ cls: 'cm-stats' });
    this.statsEl.style.fontFamily = 'var(--font-monospace)';
    this.statsEl.style.fontSize = '12px';
    this.statsEl.style.whiteSpace = 'pre-wrap';

    // ── Section: Recent observations ─────────────────────────────────────────
    const logSection = root.createDiv({ cls: 'cm-section' });
    logSection.style.marginTop = '12px';
    logSection.createEl('h4', { text: 'Recent observations' });
    this.logEl = logSection.createDiv({ cls: 'cm-log' });
    this.logEl.style.fontFamily = 'var(--font-monospace)';
    this.logEl.style.fontSize = '11px';

    await this.refresh();
  }

  async onClose(): Promise<void> {
    // No cleanup needed — no persistent connections in v1
  }

  // ── Refresh helpers ──────────────────────────────────────────────────────────

  async refresh(): Promise<void> {
    await Promise.all([this.refreshStatus(), this.refreshStats(), this.refreshLog()]);
  }

  private async refreshStatus(): Promise<void> {
    const health = await this.plugin.bridge.health();
    if (health?.ok) {
      this.statusEl.textContent = `Connected — :${this.plugin.settings.bridgePort} (pid ${health.pid})`;
      this.statusEl.style.color = 'var(--color-green)';
      this.dashboardBtn.disabled = false;
    } else {
      this.statusEl.textContent = `Not connected — port ${this.plugin.settings.bridgePort}`;
      this.statusEl.style.color = 'var(--color-red)';
      this.dashboardBtn.disabled = true;
    }
  }

  private async refreshStats(): Promise<void> {
    if (!this.plugin.settings.autoDetectVault) {
      this.statsEl.textContent = '(auto-detect disabled in settings)';
      return;
    }

    const indexPath = '.context-mem/vault/index.md';
    try {
      const file = this.app.vault.getAbstractFileByPath(indexPath);
      if (!file) {
        this.statsEl.textContent = 'No vault found.\nOpen the .context-mem/vault/ folder in Obsidian.';
        return;
      }
      // file is TAbstractFile; we need TFile to read it
      const { TFile } = await import('obsidian');
      if (!(file instanceof TFile)) {
        this.statsEl.textContent = 'index.md is a folder (unexpected).';
        return;
      }
      const content = await this.app.vault.read(file);
      // Parse simple "Key: value" lines from the index header
      const lines = content.split('\n').slice(0, 30);
      const stats: string[] = [];
      for (const line of lines) {
        const m = line.match(/^[-*]?\s*\*\*([^*]+)\*\*[:\s]+(.+)$/);
        if (m) stats.push(`${m[1]}: ${m[2].trim()}`);
        // Also match plain "Key: value" lines
        const m2 = line.match(/^([A-Z][^:]{2,30}):\s+(.+)$/);
        if (m2 && !m) stats.push(`${m2[1]}: ${m2[2].trim()}`);
      }
      this.statsEl.textContent = stats.length > 0 ? stats.join('\n') : '(no stats found in index.md)';
    } catch {
      this.statsEl.textContent = '(could not read vault index)';
    }
  }

  private async refreshLog(): Promise<void> {
    if (!this.plugin.settings.autoDetectVault) {
      this.logEl.empty();
      this.logEl.createSpan({ text: '(auto-detect disabled)' });
      return;
    }

    const logPath = '.context-mem/vault/log.md';
    try {
      const file = this.app.vault.getAbstractFileByPath(logPath);
      if (!file) {
        this.logEl.empty();
        this.logEl.createSpan({ text: 'No log.md found yet.' });
        return;
      }
      const { TFile } = await import('obsidian');
      if (!(file instanceof TFile)) return;

      const content = await this.app.vault.read(file);
      const entries: Array<{ ts: string; event: string; summary: string }> = [];
      for (const line of content.split('\n')) {
        const m = line.match(LOG_ENTRY_RE);
        if (m) {
          entries.push({ ts: m[1], event: m[2], summary: m[3].trim() });
        }
      }

      const recent = entries.slice(-10).reverse();
      this.logEl.empty();

      if (recent.length === 0) {
        this.logEl.createSpan({ text: 'No log entries yet.' });
        return;
      }

      for (const entry of recent) {
        const row = this.logEl.createDiv({ cls: 'cm-log-entry' });
        row.style.borderBottom = '1px solid var(--background-modifier-border)';
        row.style.paddingBottom = '4px';
        row.style.marginBottom = '4px';

        const dateStr = (() => {
          try {
            return new Date(entry.ts).toLocaleString([], {
              month: 'short', day: 'numeric',
              hour: '2-digit', minute: '2-digit',
            });
          } catch {
            return entry.ts;
          }
        })();

        row.createEl('small', { text: `${dateStr} · ${entry.event}` });
        row.createEl('small').style.color = 'var(--text-muted)';
        row.createDiv({ text: entry.summary, cls: 'cm-log-summary' });
      }
    } catch {
      this.logEl.empty();
      this.logEl.createSpan({ text: '(could not read log.md)' });
    }
  }
}
