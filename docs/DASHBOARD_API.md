# Dashboard runtime contract

The Dashboard is one report renderer with three explicit runtime modes. It never invents a repository or falls back to sample metrics.

| Mode     | Report source                                | Rescan         | Projection     | Source preview | Export              |
| -------- | -------------------------------------------- | -------------- | -------------- | -------------- | ------------------- |
| `server` | `@context-ray/core` through the loopback API | API            | API            | API            | API download        |
| `vscode` | `@context-ray/core` in the extension host    | webview bridge | webview bridge | webview bridge | VS Code save dialog |
| `static` | embedded schema v1 report                    | unavailable    | unavailable    | unavailable    | embedded JSON       |

## Loopback endpoints

- `GET /api/health`: server and initial-report identity;
- `GET /api/session`: root label, supported agents, discovered targets, and capability flags;
- `POST /api/scan`: validated agent, repository-contained target, and optional bounded task text;
- `POST /api/project`: deterministic load-mode scenario for one source in a retained report;
- `GET /api/source-preview`: bounded excerpt for a source already present in that report;
- `GET /api/export`: JSON, SARIF, Markdown, or portable static HTML.

The charts, metrics, source table, findings, recommendations, references, and coverage labels are derived from the returned schema v1 report. Grouping, compact/list view, inspector selection, and estimate visibility are client-side presentations of that report; they do not claim to mutate backend configuration.

The scenario endpoint is analytical only. Its response includes `mutatesConfiguration: false`, current and requested load modes, contribution delta, projected startup tokens, confidence, and an explanation. Configuration editing remains out of scope for version 0.1.
