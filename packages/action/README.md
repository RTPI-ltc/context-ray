# Context Ray GitHub Action

The Action scans repository-scoped coding-agent context and writes JSON, SARIF, and Markdown reports.

```yaml
permissions:
  contents: read
  security-events: write

steps:
  - uses: actions/checkout@v4
  - uses: ./
    with:
      agent: codex
      target: services/payments
      fail-on: error
  - uses: github/codeql-action/upload-sarif@v3
    with:
      sarif_file: .context-ray/report.sarif
```

The local `uses: ./` form is suitable for this repository's own workflow. Replace it with a pinned release reference only after a remote and release process exist.
