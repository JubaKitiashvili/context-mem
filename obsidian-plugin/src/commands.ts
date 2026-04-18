/**
 * Command palette entries for the Context Mem plugin.
 *
 * Commands registered:
 *  - context-mem-observe-selection  : POST selected text to bridge
 *  - context-mem-observe-file       : POST entire current file to bridge
 *  - context-mem-open-dashboard     : Open the dashboard in an external browser
 *  - context-mem-refresh-sidebar    : Re-read vault stats + log tail
 */
import { Notice, Modal, App, Setting } from 'obsidian';
import type ContextMemPlugin from './main';
import { OBSERVATION_TYPES, type ObservationType } from './bridge';
import { VIEW_TYPE_CONTEXT_MEM, ContextMemSidebar } from './sidebar';

/** Code-file extensions that should default to type 'code'. */
const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift',
  'c', 'cpp', 'h', 'hpp', 'cs',
  'sh', 'bash', 'zsh', 'fish',
  'sql', 'graphql', 'gql',
  'html', 'css', 'scss', 'less',
  'json', 'yaml', 'yml', 'toml',
]);

function guessType(fileName: string): ObservationType {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return CODE_EXTENSIONS.has(ext) ? 'code' : 'log';
}

// ── Type-picker modal ──────────────────────────────────────────────────────────

class TypePickerModal extends Modal {
  private onSubmit: (type: ObservationType) => void;
  private selectedType: ObservationType;

  constructor(app: App, defaultType: ObservationType, onSubmit: (type: ObservationType) => void) {
    super(app);
    this.onSubmit = onSubmit;
    this.selectedType = defaultType;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: 'Choose observation type' });

    new Setting(contentEl)
      .setName('Type')
      .addDropdown((dd) => {
        for (const t of OBSERVATION_TYPES) dd.addOption(t, t);
        dd.setValue(this.selectedType);
        dd.onChange((v) => {
          this.selectedType = v as ObservationType;
        });
      });

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText('Observe')
        .setCta()
        .onClick(() => {
          this.close();
          this.onSubmit(this.selectedType);
        })
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

// ── Command registration ───────────────────────────────────────────────────────

export function registerCommands(plugin: ContextMemPlugin): void {
  // 1. Observe selected text
  plugin.addCommand({
    id: 'context-mem-observe-selection',
    name: 'Observe selected text',
    editorCallback: (editor) => {
      const selection = editor.getSelection();
      if (!selection.trim()) {
        new Notice('No text selected.');
        return;
      }

      new TypePickerModal(plugin.app, 'note', async (type) => {
        const res = await plugin.bridge.observe(
          selection,
          type,
          'obsidian-selection',
        );
        if (res.ok) {
          new Notice(`Observed ${type} (${selection.length} chars).`);
        } else {
          new Notice(`Observe failed: ${res.error ?? 'bridge unreachable'}`);
        }
      }).open();
    },
  });

  // 2. Observe this file
  plugin.addCommand({
    id: 'context-mem-observe-file',
    name: 'Observe this file',
    editorCallback: async (editor, view) => {
      const file = view.file;
      if (!file) {
        new Notice('No active file.');
        return;
      }

      const content = editor.getValue();
      if (!content.trim()) {
        new Notice('File is empty.');
        return;
      }

      const defaultType = guessType(file.name);

      new TypePickerModal(plugin.app, defaultType, async (type) => {
        const res = await plugin.bridge.observe(
          content,
          type,
          'obsidian-file',
          file.path,
        );
        if (res.ok) {
          new Notice(`Observed "${file.name}" as ${type}.`);
        } else {
          new Notice(`Observe failed: ${res.error ?? 'bridge unreachable'}`);
        }
      }).open();
    },
  });

  // 3. Open dashboard
  plugin.addCommand({
    id: 'context-mem-open-dashboard',
    name: 'Open dashboard',
    callback: async () => {
      const info = await plugin.bridge.serviceInfo();
      if (info?.dashboard) {
        window.open(info.dashboard, '_blank');
      } else {
        new Notice('context-mem bridge unreachable. Run `context-mem serve` first.');
      }
    },
  });

  // 4. Refresh sidebar
  plugin.addCommand({
    id: 'context-mem-refresh-sidebar',
    name: 'Refresh sidebar',
    callback: async () => {
      const leaves = plugin.app.workspace.getLeavesOfType(VIEW_TYPE_CONTEXT_MEM);
      if (leaves.length === 0) {
        new Notice('context-mem sidebar is not open.');
        return;
      }
      for (const leaf of leaves) {
        const view = leaf.view;
        if (view instanceof ContextMemSidebar) {
          await view.refresh();
        }
      }
      new Notice('Sidebar refreshed.');
    },
  });
}
