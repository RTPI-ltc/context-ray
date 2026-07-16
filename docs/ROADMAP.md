# Roadmap

## 0.1 — local pre-release (implemented)

- Five repository adapters.
- Source states, provenance edges, coverage, findings, recommendations, and comparable report diff.
- Complete runtime report validation, published JSON Schema, and an added-regression baseline gate.
- Terminal, JSON, Markdown, SARIF, and standalone HTML.
- Loopback-backed interactive Dashboard with real rescans, projection, source preview, and export.
- VS Code extension with host-bridged Dashboard, diagnostics, trees, rescan-on-save, and save-dialog export.
- GitHub Action with JSON/SARIF/Markdown artifacts, annotations, job summary,
  current-report and baseline-regression gates, plus packaged-bundle smoke coverage.
- Explicit runtime process observation.

## 0.2 — adapter hardening

- Snapshot fixtures from each supported agent version.
- Repository-local config file for shared scan profiles.
- Cross-version JSON Schema compatibility corpus.
- More conflict families: test commands, formatter, generated files, edit boundaries, package roots.
- Better structured relevance with zero network dependency.
- Windows path and shell fixtures.

## 0.3 — explicit MCP probe

- Separate opt-in command based on the stable official MCP SDK.
- Stdio and HTTP transports with timeout, command allowlist, environment redaction, and no automatic credential forwarding.
- Live tool/resource inventory diffed against local snapshots.
- Progressive-discovery policy suggestions grounded in observed usage data supplied by the user.

## 0.4 — review workflow

- Baseline policy file and per-rule configuration.
- GitHub pull-request summary with source and token deltas.
- VS Code CodeActions that propose patches but never rewrite without review.
- Signed report artifact and provenance metadata.

## 1.0 criteria

- Public compatibility policy and stable schema.
- Documented support matrix against released agent versions.
- Cross-platform CLI/extension packages.
- Independent security review of path containment, report embedding, runtime wrapper, and Action permissions.
- Reproducible release process and complete third-party notices.

The roadmap intentionally keeps automatic instruction rewriting and hosted telemetry out of the critical path.
