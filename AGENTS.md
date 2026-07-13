# Context Ray contributor guide

## Project intent

Context Ray is a local-first, deterministic analyzer for the context that coding agents can observe from a repository. Keep observed facts, adapter-derived inference, and unobservable runtime state explicitly separate in code and UI.

## Commands

- Install dependencies with `pnpm install`.
- Run all checks with `pnpm verify`.
- Run the dashboard with `pnpm dev:dashboard`.
- Exercise the CLI from source with `pnpm context-ray scan fixtures/sample-repo --agent codex --target services/payments`.

## Engineering rules

- Do not execute repository-provided commands during a normal static scan.
- Any MCP process launch or runtime wrapper must require an explicit user command.
- Keep the shared report schema backward compatible within a major version.
- Every finding must include evidence and a confidence level.
- Add fixtures and tests when changing an adapter's discovery or precedence rules.
- Preserve the selected dark Context Profiler visual direction in `apps/dashboard`.

## Git

- Keep generated build output out of ordinary commits, except `packages/action/dist`, which GitHub Actions requires for tagged releases.
- Do not push or create a remote unless the user explicitly asks.
