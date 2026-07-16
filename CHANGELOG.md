# Changelog

All notable changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project intends to use semantic versioning after its first public release.

## [Unreleased]

### Added

- Initial five-agent effective-context discovery and precedence simulation.
- Evidence-backed cost, conflict, security, quality, and observability diagnostics.
- Terminal, JSON, SARIF, Markdown, and standalone HTML reports.
- Report comparison and explicit runtime observation.
- Interactive Context Profiler dashboard.
- VS Code extension and GitHub Action entrypoints.
- Strict runtime and Draft 2020-12 report validation, stable baseline regression
  gates, and packaged GitHub Action smoke coverage.
- Findings-first Dashboard navigation, responsive inspector behavior, and
  report push synchronization with the VS Code extension.

### Changed

- Source reads and previews are byte-bounded, with explicit parse and preview
  diagnostics instead of silent fallback.
- VS Code scans use debounced latest-request-wins coordination and preserve the
  active scan scope across file-watcher rescans.

## [0.1.0] - 2026-07-13

- Local pre-release repository baseline.
