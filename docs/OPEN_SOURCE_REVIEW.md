# Open-source component review

Context Ray reuses focused, permissively licensed components when they provide a mature implementation of a commodity concern. Agent-specific precedence, provenance, observability, and diagnostics remain project code because those behaviors are the product boundary.

## Runtime components

| Component                          | Role                                 | License                                                         | Decision                                                     |
| ---------------------------------- | ------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------ |
| Commander                          | CLI parsing/help                     | MIT                                                             | Reuse; stable option and subcommand behavior                 |
| fast-glob                          | Bounded repository discovery         | MIT                                                             | Reuse; do not reimplement cross-platform glob traversal      |
| YAML / `@iarna/toml` / gray-matter | Agent config and frontmatter parsing | ISC / ISC / MIT                                                 | Reuse parsers; keep adapter semantics in Context Ray         |
| minimatch                          | Path-scoped instruction matching     | ISC                                                             | Reuse; configure explicit target semantics                   |
| gpt-tokenizer                      | Deterministic token estimate         | MIT                                                             | Reuse; label output as an estimate rather than billing truth |
| React / Vite                       | Dashboard runtime/build              | MIT                                                             | Reuse                                                        |
| Visx                               | Token composition SVG                | MIT                                                             | Reuse real data-visualization primitives                     |
| Tabler Icons                       | UI icon system                       | MIT                                                             | Reuse; avoid handcrafted SVG substitutes                     |
| Fontsource Inter / IBM Plex Mono   | Local font packaging                 | MIT package code; font files under their upstream font licenses | Reuse; no runtime font CDN                                   |
| `@actions/core`                    | GitHub Action APIs                   | MIT                                                             | Reuse                                                        |
| `open`                             | Explicit local HTML opening          | MIT                                                             | Reuse                                                        |

Development tooling includes TypeScript (Apache-2.0), ESLint, Prettier, Vitest, and tsup (permissive licenses).

## Components intentionally not reused

### Another instruction linter as the core

Existing linters and rule synchronizers address file-level quality or cross-agent duplication. Context Ray's core requirement is target-specific effective-context simulation with token attribution, provenance edges, MCP schema cost, and explicit observability. Wrapping a file linter would preserve the wrong abstraction, so these parts are implemented directly.

### Live MCP SDK in normal scans

The official MCP SDK is appropriate for an explicit probe feature, but normal scans must not start repository-declared processes. V1 consumes declarations and user-supplied schema snapshots instead. A future live probe should be a separate opt-in command with process, network, timeout, and secret controls.

### Hosted telemetry or database

V1 does not need a service, account, analytics SDK, or database. Reports remain local and portable.

## Release checks

Before publishing:

1. Generate a complete production dependency license inventory from the final lockfile.
2. Include required font notices in release artifacts.
3. Recheck package names, version ranges, vulnerabilities, and transitive licenses.
4. Verify the bundled GitHub Action contains no dependency with an incompatible license.
5. Record the audit date and attach the generated inventory to the release.

This review covers direct dependency choices as of 2026-07-13. It is not a legal opinion.
