# Aider + context-mem

**Status:** Supported via HTTP bridge (port 51894).
**Difficulty:** Medium — Aider does not support MCP natively; integration uses context-mem's HTTP bridge for ingestion and the Python scripting API for hooks.

## Prerequisites

- context-mem installed globally: `npm install -g context-mem`
- Aider installed: `pip install aider-chat` (or `pipx install aider-chat`)
- Node 18 or later
- Python 3.9 or later (for Aider)
- `curl` available on PATH (for shell-hook ingestion)

## Background

Aider is a terminal-based AI pair-programmer that operates directly on your Git repository. As of this writing, Aider does not support the Model Context Protocol natively — it communicates with LLMs via direct API calls and does not expose an MCP client interface.

Integration with context-mem uses the **HTTP bridge** that context-mem starts alongside its MCP server:

- `POST http://127.0.0.1:51894/api/observe` — ingest a new observation (text/context)
- `GET  http://127.0.0.1:51894/api/search?q=<query>` — retrieve relevant past context
- `GET  http://127.0.0.1:51894/api/health` — liveness check
- Dashboard: `http://127.0.0.1:51893`

The recommended pattern is:
1. Before an Aider session: query context-mem for relevant prior context and prepend it to Aider's system prompt or initial message.
2. After an Aider session: post a summary of what was built to context-mem for future recall.

## Quick Start

### 1. Start context-mem

```bash
context-mem serve
```

Verify the HTTP bridge is up:

```bash
curl -s http://127.0.0.1:51894/api/health
# {"status":"ok"}
```

### 2. Configure Aider

Aider does not have a built-in MCP config file. The integration is done via shell wrappers or Aider's `--message` flag.

**Shell wrapper approach (recommended):**

Create a wrapper script `~/bin/aider-with-memory` (make it executable with `chmod +x`):

```bash
#!/usr/bin/env bash
# Fetch recent context from context-mem before launching Aider
PROJECT=$(basename "$PWD")
CONTEXT=$(curl -s "http://127.0.0.1:51894/api/search?q=recent+context+${PROJECT}" 2>/dev/null | \
  python3 -c "import sys,json; data=json.load(sys.stdin); print('\n'.join(r.get('content','') for r in data.get('results',[])[:3]))" 2>/dev/null)

if [ -n "$CONTEXT" ]; then
  echo "--- context-mem: loaded prior context ---"
  echo "$CONTEXT"
  echo "-----------------------------------------"
  aider --message "Context from previous sessions:\n$CONTEXT\n\nNow: $*" "$@"
else
  aider "$@"
fi
```

Use `aider-with-memory` instead of `aider` to start sessions.

**Post-session ingestion (manual):**

After a coding session, record what was accomplished:

```bash
curl -s -X POST http://127.0.0.1:51894/api/observe \
  -H "Content-Type: application/json" \
  -d '{"content": "Refactored the auth module in project-x to use JWT. Removed legacy cookie session code. Tests all pass.", "project": "project-x"}'
```

**Python scripting API (advanced):**

For tighter integration, use Aider's Python API to run pre/post hooks:

```python
from aider.coders import Coder
from aider.models import Model
import requests, json

# Pre-session: fetch context
resp = requests.get("http://127.0.0.1:51894/api/search", params={"q": "recent context"})
prior_context = "\n".join(r["content"] for r in resp.json().get("results", [])[:3])

model = Model("claude-3-5-sonnet-20241022")
coder = Coder.create(main_model=model, fnames=["src/auth.py"])

if prior_context:
    coder.run(f"Prior context: {prior_context}\n\nNow refactor the auth module to use JWT.")
else:
    coder.run("Refactor the auth module to use JWT.")

# Post-session: ingest summary
requests.post("http://127.0.0.1:51894/api/observe", json={
    "content": "Aider session: refactored auth.py to use JWT. Session complete."
})
```

### 3. Verify

```bash
# Ingest a test observation
curl -s -X POST http://127.0.0.1:51894/api/observe \
  -H "Content-Type: application/json" \
  -d '{"content": "Aider integration test — HTTP bridge working"}'

# Retrieve it
curl -s "http://127.0.0.1:51894/api/search?q=aider+integration+test" | python3 -m json.tool
```

You should see your test observation in the results array.

## Features in this IDE

| Feature | Status |
|---|---|
| Ingest observations via HTTP bridge | Works |
| Search / retrieve past context via HTTP | Works |
| Dashboard at :51893 | Works (open in browser manually) |
| Native MCP tool calling | Not supported (Aider has no MCP client) |
| Automatic context injection into sessions | Via shell wrapper (manual setup required) |

## Troubleshooting

- **`curl` returns connection refused:** context-mem is not running. Start it with `context-mem serve` and keep it running in the background.
- **HTTP bridge on different port:** If port 51894 is in use, context-mem will log the actual port at startup. Update your scripts accordingly.
- **Python JSON parse error in shell wrapper:** Test the API response manually with `curl -s "http://127.0.0.1:51894/api/search?q=test" | python3 -m json.tool` to see the raw structure.
- **Aider Python API changed:** The Aider Python scripting API is explicitly marked experimental and may change between releases. Check `aider --version` and the [Aider changelog](https://aider.chat/HISTORY.html) if scripts break after upgrading.

## Uninstall

Stop any running `context-mem serve` processes, remove your shell wrapper, and optionally:

```bash
npm uninstall -g context-mem
```

## Related

- [Main README](../../README.md)
- [LLM Wiki Schema](../llm-wiki-schema.md)
- [All integrations](./README.md)
