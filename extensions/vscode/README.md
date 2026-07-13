# Context Ray for VS Code

Context Ray adds repository-context diagnostics to VS Code:

- `Context Ray: Scan Workspace` analyzes the active file's target path;
- Findings and Context Sources appear in Explorer;
- evidence is published as file diagnostics;
- supported instruction/config changes can trigger a rescan;
- `Context Ray: Open HTML Report` opens the interactive profiler in a webview.

Configuration:

- `contextRay.agent`: Codex, Claude, Cursor, Copilot, or Gemini;
- `contextRay.scanOnSave`: rescan supported context files after changes.

Build the entire workspace before packaging so `media/dashboard.html` is present.
