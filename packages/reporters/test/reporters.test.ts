import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeContext, compareReports } from "@context-ray/core";
import {
  formatDiff,
  formatMarkdown,
  formatSarif,
  formatTerminal,
  renderHtml,
} from "../src/index.js";

describe("reporters", () => {
  it("emits terminal, Markdown, SARIF, and safe standalone HTML", async () => {
    const report = await analyzeContext({
      root: path.resolve("fixtures/sample-repo"),
      target: "services/payments",
      agent: "codex",
    });
    expect(formatTerminal(report, { color: false })).toContain("CONTEXT RAY");
    expect(formatMarkdown(report)).toContain("## Observability coverage");
    expect(JSON.parse(formatSarif(report)).version).toBe("2.1.0");
    const html = renderHtml(
      { ...report, scan: { ...report.scan, task: "</script><script>unsafe()</script>" } },
      "<!doctype html><script>window.__CONTEXT_RAY_REPORT__ = null;</script>",
    );
    expect(html).toContain(`"schemaVersion":1`);
    expect(html).toContain("\\u003c/script>");
    expect(html).not.toContain("</script><script>unsafe()");
    expect(html).not.toContain("window.__CONTEXT_RAY_REPORT__ = null;");

    const interactiveHtml = renderHtml(
      report,
      "<!doctype html><script>window.__CONTEXT_RAY_REPORT__ = null;window.__CONTEXT_RAY_RUNTIME__ = null;</script>",
      {
        mode: "server",
        root: report.scan.root,
        repoLabel: "sample-repo",
        agents: ["codex"],
        targets: [report.scan.target],
        supports: { scan: true, projection: true, sourcePreview: true, export: true },
      },
    );
    expect(interactiveHtml).toContain('"mode":"server"');
    expect(interactiveHtml).not.toContain("window.__CONTEXT_RAY_RUNTIME__ = null;");
  });

  it("shows scope comparability and changed report details", async () => {
    const before = await analyzeContext({
      root: path.resolve("fixtures/sample-repo"),
      target: "services/payments",
      agent: "codex",
    });
    const after = structuredClone(before);
    const source = after.sources[0];
    const finding = after.findings.find((item) => item.severity === "warning");
    expect(source).toBeDefined();
    expect(finding).toBeDefined();
    if (!source || !finding) return;
    source.tokenEstimate += 1;
    finding.severity = "error";
    const output = formatDiff(compareReports(before, after), false);
    expect(output).toContain("comparable scope");
    expect(output).toContain("1 changed");
    expect(output).toContain("1 severity increased");
  });
});
