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

The local `uses: ./` form is suitable for this repository's own workflow. External consumers should use a commit SHA or tagged release reference after the first release is published.

To gate only regressions against a committed report, set `baseline` and
`fail-on-new`. That mode replaces the default full-report `fail-on: error`
gate, so unchanged existing findings do not fail the job. Keep the baseline at
a different path from `<output-directory>/report.json`.

```yaml
- uses: ./
  with:
    target: services/payments
    baseline: .context-ray/baseline.json
    fail-on-new: warning
    output-directory: .context-ray/current
```
