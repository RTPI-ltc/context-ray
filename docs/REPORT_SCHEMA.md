# Report schema v1

`ScanReport` is the stable boundary between collection and presentation.

## Top-level fields

| Field             | Meaning                                                                 |
| ----------------- | ----------------------------------------------------------------------- |
| `schemaVersion`   | Integer schema version; currently `1`                                   |
| `tool`            | Producer name and version                                               |
| `scan`            | Stable id, start time, duration, root, target, agent, task, mode        |
| `summary`         | Effective/source/tool totals and diagnostic counts                      |
| `coverage`        | Repository, global, runtime, internal-prompt, and MCP visibility        |
| `sources`         | Context source inventory with state, provenance metadata, and estimates |
| `edges`           | Loads/imports/overrides/declares/observes relationships                 |
| `findings`        | Evidence-backed diagnostics                                             |
| `recommendations` | Prioritized token-saving actions                                        |
| `runtime`         | Optional explicit process observation                                   |

## Stability rules

- IDs are content/location-derived and do not include timestamps.
- New optional fields may be added within schema v1.
- Existing enum meanings must not change within a schema version.
- Removing or renaming fields requires a new schema version.
- Consumers must check `schemaVersion` before processing.

The authoritative TypeScript definition is [`packages/schema/src/index.ts`](../packages/schema/src/index.ts).
