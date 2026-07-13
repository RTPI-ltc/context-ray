# Contributing

Thank you for improving Context Ray.

## Before opening a change

1. Search existing issues when a remote issue tracker becomes available.
2. Keep adapter behavior grounded in the official agent documentation.
3. Preserve the distinction between observed evidence, adapter-derived inference, and unobservable provider state.
4. Never make static scans execute repository code.

## Local workflow

```bash
corepack enable
pnpm install
pnpm verify
```

Use a focused branch and add tests for discovery, precedence, parsing, diagnostics, or reporter changes. Adapter changes must include a fixture that demonstrates the relevant active, conditional, shadowed, or on-demand state.

## Commits and pull requests

- Use concise imperative commit subjects.
- Explain the user-visible behavior and trust-boundary impact.
- Include verification commands and results.
- Call out schema compatibility and generated Action bundle changes.
- Do not commit ordinary build output. `packages/action/dist` is the release exception required by GitHub Actions.

## Adding an adapter

An adapter is ready only when it has:

- official documentation references;
- deterministic discovery and precedence rules;
- explicit confidence/observability labels;
- path-scoped and shadowing fixtures;
- coverage wording for unavailable or private state;
- tests across root and nested targets.

By participating, contributors agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
