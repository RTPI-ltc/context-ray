# Context Ray

Context Ray is a local-first profiler for the effective repository context of coding agents. It explains which instruction files, path rules, skills, hooks, MCP servers, and tool schemas are visible for a chosen agent and target—then reports conflicts, avoidable token cost, security risks, and what cannot be observed.

> Context Ray reports repository evidence and adapter-derived inference. It does **not** claim access to provider system prompts, prompt rewriting, caching, or the final serialized request.

## Why

Coding-agent context now lives across `AGENTS.md`, `CLAUDE.md`, `.cursor/rules`, Copilot instruction files, `GEMINI.md`, skills, hooks, and MCP configuration. A file can be valid in isolation while the combined context is expensive, contradictory, overly broad, or unsafe. Context Ray turns that combined state into one versioned report that can be consumed from the terminal, a standalone dashboard, VS Code, or CI.

## What works

| Surface         | Capability                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------- |
| CLI             | Static scan, terminal/JSON/SARIF/Markdown/HTML output, baselines, report diff, severity gates  |
| Dashboard       | Real loopback scan API, report-driven charts, scenario projection, source preview, and exports |
| VS Code         | Trees, diagnostics, rescan-on-save, and a Dashboard bridged to the extension host              |
| GitHub Action   | JSON, SARIF, job summary, annotations, configurable failure threshold                          |
| Runtime wrapper | Explicitly runs a user-supplied command and records process metadata alongside a static scan   |
| Agent adapters  | Codex, Claude Code, Cursor, GitHub Copilot, Gemini CLI                                         |

Normal scans never execute repository code or start an MCP server. Runtime observation is a separate explicit command.

## Quick start from this repository

Requirements: Node.js 20.19 or newer and pnpm 11.

```bash
corepack enable
pnpm install
pnpm context-ray scan fixtures/sample-repo --agent codex --target services/payments
```

Run the interactive Dashboard against the same analyzer:

```bash
pnpm build
node packages/cli/dist/index.js serve fixtures/sample-repo --agent codex --target services/payments
```

Open `http://127.0.0.1:4173/`. Changing agent, target, or task and pressing **Run scan** calls the local analyzer; it is not a browser-only simulation. Exported HTML files intentionally remain portable, read-only snapshots. Their filters and inspector are local views over the embedded report, while rescanning, source preview, and scenario projection require `serve` or the VS Code extension host.

Export the same scan in different formats:

```bash
pnpm context-ray scan . --agent claude --target packages/core --format json --output .context-ray/report.json
pnpm context-ray scan . --agent codex --format sarif --output .context-ray/report.sarif
pnpm build:dashboard
pnpm context-ray scan . --agent codex --format html --output .context-ray/report.html
```

Compare two reports:

```bash
pnpm context-ray compare before.json after.json
```

Gate only regressions introduced since a comparable baseline (new findings or
severity increases), while leaving the existing all-current-findings gate
available:

```bash
pnpm context-ray scan . --format json --output current.json \
  --baseline before.json --fail-on-new warning
```

Run a command only when runtime metadata is intentionally required:

```bash
pnpm context-ray trace --root . --agent codex -- node --version
```

The wrapper records command, duration, exit status, signal, and I/O byte counts. It does not parse output as hidden prompt truth.

## CLI contract

```text
context-ray scan [root]
  --agent codex|claude|cursor|copilot|gemini
  --target <file-or-directory>
  --task <description>
  --format terminal|json|sarif|markdown|html
  --output <file>
  --mcp-snapshot <file>
  --baseline <report.json>
  --fail-on none|note|warning|error
  --fail-on-new none|note|warning|error

context-ray compare <before.json> <after.json> [--json]
context-ray trace --root <path> [options] -- <command...>
context-ray doctor
context-ray serve [root] [--agent <agent>] [--target <path>] [--host 127.0.0.1] [--port 4173] [--open]
```

Exit code `2` means a configured diagnostic threshold was reached.
`--fail-on` evaluates every current finding; `--fail-on-new` requires
`--baseline` and evaluates only added findings and severity increases. Baselines
whose agent, target, task, or scan mode differ are reported as non-comparable
and cannot be used for a new-regression gate. Other non-zero exits indicate a
CLI or runtime error.

## Effective-context model

Every source records:

- status: active, conditional, on-demand, shadowed, ignored, truncated, or unavailable;
- observability: observed, inferred, or unobservable;
- confidence and the reason it is considered visible;
- deterministic token estimate, bytes, lines, content hash, and target relevance;
- provenance edges such as loads, imports, overrides, declares, and observes.

Every finding includes evidence, confidence, a remediation, and optional estimated savings. See [report schema](docs/REPORT_SCHEMA.md) and [adapter behavior](docs/ADAPTERS.md).

## Safety and privacy

- Static scans stay inside the resolved repository root and reject symlinks that escape it.
- The interactive API binds only to loopback and rejects non-loopback `Host` headers.
- Secret-like evidence is redacted in findings.
- Project commands and MCP processes are never launched during a static scan.
- Exact provider prompts and provider-side transforms are reported as not observable.
- HTML reports embed data locally and make no network requests.

Read the [threat model](docs/THREAT_MODEL.md) before using Context Ray on untrusted repositories or in privileged CI.

## Development

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify
```

The sample repository intentionally contains conflicting guidance so adapter and diagnostic behavior is testable.

## Repository map

```text
apps/dashboard       React + Visx single-file profiler
extensions/vscode   VS Code extension
packages/schema      Versioned report types
packages/core        Discovery, adapters, diagnostics, diff, runtime observation
packages/reporters   Terminal, JSON, Markdown, SARIF, HTML
packages/server      Loopback-only Dashboard API and session state
packages/cli         context-ray executable
packages/action      Bundled GitHub Action
fixtures             Cross-agent test repositories
docs                 Product, architecture, adapters, schema, security, roadmap
```

## Design and product rationale

- [Product brief and audience research](docs/PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Open-source component review](docs/OPEN_SOURCE_REVIEW.md)
- [Roadmap](docs/ROADMAP.md)
- [中文说明](docs/README.zh-CN.md)

## Project status

This is a source-available pre-release at version `0.1.0`. The repository is hosted at [RTPI-ltc/context-ray](https://github.com/RTPI-ltc/context-ray); npm, VS Code Marketplace, and tagged GitHub Action releases are not published yet. Package names, publisher identity, and distribution coordinates must be rechecked before the first tagged release.

## License

[MIT](LICENSE) © 2026 Context Ray contributors.
