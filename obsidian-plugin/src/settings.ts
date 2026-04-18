import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type ContextMemPlugin from './main';

export interface ContextMemSettings {
  /** HTTP host of the context-mem bridge. Default: '127.0.0.1' */
  bridgeHost: string;
  /** HTTP port of the context-mem bridge. Default: 51894 */
  bridgePort: number;
  /**
   * When true, the plugin looks for .context-mem/vault/ inside the Obsidian
   * vault root and reads index.md / log.md from there automatically.
   */
  autoDetectVault: boolean;
}

export const DEFAULT_SETTINGS: ContextMemSettings = {
  bridgeHost: '127.0.0.1',
  bridgePort: 51894,
  autoDetectVault: true,
};

export class ContextMemSettingTab extends PluginSettingTab {
  plugin: ContextMemPlugin;

  constructor(app: App, plugin: ContextMemPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Context Mem — Settings' });

    // Bridge host
    new Setting(containerEl)
      .setName('Bridge host')
      .setDesc('Hostname or IP where context-mem HTTP bridge is running.')
      .addText((text) =>
        text
          .setPlaceholder('127.0.0.1')
          .setValue(this.plugin.settings.bridgeHost)
          .onChange(async (value) => {
            this.plugin.settings.bridgeHost = value.trim() || '127.0.0.1';
            await this.plugin.saveSettings();
          })
      );

    // Bridge port
    new Setting(containerEl)
      .setName('Bridge port')
      .setDesc('Port where context-mem HTTP bridge is listening (default: 51894).')
      .addText((text) =>
        text
          .setPlaceholder('51894')
          .setValue(String(this.plugin.settings.bridgePort))
          .onChange(async (value) => {
            const parsed = parseInt(value, 10);
            if (!isNaN(parsed) && parsed > 0 && parsed < 65536) {
              this.plugin.settings.bridgePort = parsed;
              await this.plugin.saveSettings();
            }
          })
      );

    // Auto-detect vault
    new Setting(containerEl)
      .setName('Auto-detect vault')
      .setDesc(
        'When enabled, the plugin looks for .context-mem/vault/ inside the ' +
          'Obsidian vault root and reads vault stats / log from there.'
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoDetectVault)
          .onChange(async (value) => {
            this.plugin.settings.autoDetectVault = value;
            await this.plugin.saveSettings();
          })
      );

    // Test connection button
    new Setting(containerEl)
      .setName('Test connection')
      .setDesc('Ping the context-mem bridge to verify connectivity.')
      .addButton((btn) =>
        btn
          .setButtonText('Test')
          .setCta()
          .onClick(async () => {
            btn.setButtonText('Testing…');
            btn.setDisabled(true);
            try {
              const result = await this.plugin.bridge.health();
              if (result?.ok) {
                new Notice(
                  `context-mem connected — PID ${result.pid}, uptime ${Math.round(result.uptime ?? 0)}s`
                );
              } else {
                new Notice('context-mem: bridge unreachable. Is `context-mem serve` running?');
              }
            } finally {
              btn.setButtonText('Test');
              btn.setDisabled(false);
            }
          })
      );
  }
}
