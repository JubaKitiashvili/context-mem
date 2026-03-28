---
name: context-mem-handoff
description: Generate a session handoff — saves current state and creates a continuation prompt for a new session
allowed-tools: Bash
---

Generate a session handoff prompt that captures the current session state.

1. Call the `handoff_session` MCP tool to generate the handoff:

Use the `handoff_session` MCP tool with the reason "Manual handoff via /context-mem-handoff command".

2. Present the continuation prompt to the user in a clean format.

3. Tell the user: "Copy this prompt and paste it at the start of your next session to continue where you left off."

4. If the user provides a reason as an argument, pass it as the `reason` parameter to the tool.
