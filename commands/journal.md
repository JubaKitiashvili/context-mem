---
name: journal
description: Show the activity journal — recent file edits, commands, and actions from this and previous sessions
allowed-tools: Read
---

Display the activity journal that tracks all actions performed across sessions.

1. Read the journal file:
   ```
   .context-mem/journal.md
   ```

2. If the file doesn't exist, tell the user:
   "No activity journal yet. The journal starts recording after your first tool use (edit, read, bash command)."

3. If the file exists, present its contents organized by session:
   - Show the most recent 30 entries by default
   - Highlight EDIT entries (these show what code changed)
   - Group by time blocks if entries span multiple sessions
   - Show summary stats: total entries, files touched, edits made

4. If the user asks for a specific filter (e.g., "show only edits" or "show bash commands"), filter accordingly.
