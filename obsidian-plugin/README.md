# Context Mem — Obsidian Plugin

Bridge [context-mem](https://github.com/JubaKitiashvili/context-mem) to your Obsidian vault. Observe notes and code selections, view your AI memory synthesis pages, and query your memory vault without leaving the editor.

## What is context-mem?

context-mem is a local-first AI memory engine that continuously ingests your code, decisions, and conversations into a searchable, synthesis-ready knowledge vault. It follows the **LLM Wiki** pattern: instead of retrieving raw fragments at query time, it pre-synthesises durable wiki-style pages (`entities/`, `topics/`, `knowledge/`) that any LLM can consume directly — zero extra latency, zero API calls per lookup.

When you open the `.context-mem/vault/` directory in Obsidian, you get:

- Native graph view over all synthesised entities and topics
- Wikilink navigation (`[[entities/Postgres]]`, `[[topics/architecture]]`)
- Instant full-text search across your AI memory
- This plugin adds live bridge status, quick observation, and log-tail visibility on top of that.

## Features

1. **Bridge status panel** — see whether `context-mem serve` is running, with port + PID.
2. **Quick observe** — paste any content + pick a type → POSTs directly to the bridge. No CLI needed.
3. **Observe selected text** — command palette: highlight code or prose, observe it in one keystroke.
4. **Observe this file** — command palette: ingest the entire current file (auto-detects `code` vs `log` from extension).
5. **Recent observations** — live tail of the last 10 entries from `log.md`.
6. **Dashboard link** — open the context-mem web dashboard from the sidebar.
7. **Status-bar indicator** — green/red dot in the bottom bar; polls every 30 s.

## Install

### Manual (until community store submission)

1. Download the latest release ZIP from the [Releases](https://github.com/JubaKitiashvili/context-mem/releases) page.
2. Extract it; you'll get `main.js`, `manifest.json`, and `styles.css` (if any).
3. Copy those three files into `<your-vault>/.obsidian/plugins/context-mem/`.
4. In Obsidian → Settings → Community plugins → enable **Context Mem**.

### Build from source

```bash
git clone https://github.com/JubaKitiashvili/context-mem
cd context-mem/obsidian-plugin
npm install
npm run build
# main.js is now at obsidian-plugin/main.js
```

Copy `main.js`, `manifest.json`, and `versions.json` into your vault's plugin directory as described above.

## Pairing with context-mem CLI

1. **Install context-mem** globally (see main repo README):
   ```bash
   npm install -g context-mem
   ```

2. **Start the bridge** in your project directory:
   ```bash
   context-mem serve
   ```
   By default this starts the HTTP bridge on port **51894** and the dashboard on **51893**.

3. **Open the vault in Obsidian** — point Obsidian at the generated vault directory:
   ```
   <your-project>/.context-mem/vault/
   ```

4. **Install this plugin** as described above and enable it.

5. The status bar should show a green dot once the bridge is running. Open the sidebar via the ribbon brain icon or the command palette.

## Settings

| Setting | Default | Description |
|---|---|---|
| Bridge host | `127.0.0.1` | Hostname where the bridge runs |
| Bridge port | `51894` | Port for the HTTP bridge |
| Auto-detect vault | `true` | Read vault stats/log from `.context-mem/vault/` automatically |

## Commands

| Command | Description |
|---|---|
| Context Mem: Observe selected text | POST current selection to bridge (prompts for type) |
| Context Mem: Observe this file | POST entire file to bridge (type auto-detected from extension) |
| Context Mem: Open dashboard | Open the context-mem web dashboard in your browser |
| Context Mem: Refresh sidebar | Re-read vault stats and log tail |

## Screenshots

_(Screenshots will be added in the first public release.)_

## License

MIT — see [LICENSE](../LICENSE).
