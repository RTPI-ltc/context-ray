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

- Report IDs are content-derived. Source IDs use stable adapter/path identity,
  and finding IDs use rule plus evidence-source identity, so a line-only shift
  does not look like a newly introduced finding.
- Source, finding, and recommendation IDs must be unique within a report.
- `static+runtime` scans require a runtime observation; `static` scans omit it.
- Every source agent must match the scan agent.
- New optional fields may be added within schema v1.
- Existing enum meanings must not change within a schema version.
- Removing or renaming fields requires a new schema version.
- Consumers must check `schemaVersion` before processing.

The authoritative TypeScript definition is [`packages/schema/src/index.ts`](../packages/schema/src/index.ts).
The package also publishes a Draft 2020-12 JSON Schema at
`@context-ray/schema/scan-report.schema.json`. Runtime consumers can use
`validateScanReport` for detailed structural and source-reference errors, or
`isScanReport` as a type guard. Unknown object fields remain accepted so new
optional schema v1 fields do not break older consumers.

## Report diff and baseline semantics

`compareReports` preserves the original id lists and summary deltas, and also
returns full added/resolved finding payloads, changed source/finding payloads,
explicit severity transitions, and a `comparability` result. Reports are
comparable when agent, target, task, and static/runtime mode match. Repository
root is deliberately excluded so the same checkout can be compared across CI
machines.

The shared `evaluateBaselineGate` helper evaluates only newly added findings
and existing findings whose severity increased. Unchanged pre-existing findings
do not fail this regression gate.

Baseline and current output files must use different paths so comparison input
cannot be overwritten before the gate runs.
