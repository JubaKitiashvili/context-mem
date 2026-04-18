/**
 * Context Mem Obsidian Plugin — main entry point.
 *
 * Wires together:
 *  - ContextMemBridge     (HTTP client for the context-mem bridge)
 *  - ContextMemSidebar    (right-panel view)
 *  - registerCommands     (command palette entries)
 *  - createStatusBarItem  (bottom-bar connectivity indicator)
 *  - ContextMemSettingTab (settings UI)
 */
import { App, Plugin, WorkspaceLeaf } from 'obsidian';
import { ContextMemBridge } from './bridge';
import { ContextMemSidebar, VIEW_TYPE_CONTEXT_MEM } from './sidebar';
import { registerCommands } from './commands';
import { createStatusBarItem } from './statusbar';
import {
  ContextMemSettings,
  DEFAULT_SETTINGS,
  ContextMemSettingTab,
} from './settings';

export default class ContextMemPlugin extends Plugin {
  settings!: ContextMemSettings;
  bridge!: ContextMemBridge;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Initialise HTTP bridge client
    this.bridge = new ContextMemBridge(this.settings);

    // Register the sidebar view
    this.registerView(
      VIEW_TYPE_CONTEXT_MEM,
      (leaf: WorkspaceLeaf) => new ContextMemSidebar(leaf, this)
    );

    // Ribbon icon — opens the sidebar
    this.addRibbonIcon('brain-circuit', 'Open context-mem sidebar', async () => {
      await this.activateSidebar();
    });

    // Command palette entries
    registerCommands(this);

    // Status-bar indicator
    createStatusBarItem(this);

    // Settings tab
    this.addSettingTab(new ContextMemSettingTab(this.app, this));

    console.log('context-mem plugin loaded.');
  }

  async onunload(): Promise<void> {
    // Obsidian automatically detaches registered views.
    // The bridge holds no persistent connections, so nothing else to clean up.
    console.log('context-mem plugin unloaded.');
  }

  /** Open (or reveal) the sidebar in the right workspace split. */
  async activateSidebar(): Promise<void> {
    const { workspace } = this.app;

    // If the view is already open somewhere, just reveal it
    const existing = workspace.getLeavesOfType(VIEW_TYPE_CONTEXT_MEM);
    if (existing.length > 0) {
      workspace.revealLeaf(existing[0]);
      return;
    }

    // Otherwise open a new leaf in the right sidebar
    const leaf = workspace.getRightLeaf(false);
    if (!leaf) return;

    await leaf.setViewState({ type: VIEW_TYPE_CONTEXT_MEM, active: true });
    workspace.revealLeaf(leaf);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    // Keep the bridge in sync with updated settings
    this.bridge.updateSettings(this.settings);
  }
}
