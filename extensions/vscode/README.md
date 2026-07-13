# Context Ray for VS Code

Context Ray adds repository-context diagnostics to VS Code:

- `Context Ray: Scan Workspace` analyzes the active file's target path;
- Findings and Context Sources appear in Explorer;
- evidence is published as file diagnostics;
- supported instruction/config changes can trigger a rescan;
- `Context Ray: Open HTML Report` opens the interactive profiler in a webview;
- agent, target, task, and **Run scan** are routed to the extension-host analyzer;
- load-mode scenarios run through the core projection model without rewriting configuration;
- source excerpts are read only from report sources contained by the workspace;
- JSON, SARIF, Markdown, and HTML exports use VS Code's save dialog.

Configuration:

- `contextRay.agent`: Codex, Claude, Cursor, Copilot, or Gemini;
- `contextRay.scanOnSave`: rescan supported context files after changes.

Build the entire workspace before packaging so `media/dashboard.html` is present. The webview has no demo-report fallback; if no report can be produced, the command reports the scan/build error instead of showing synthetic data.
