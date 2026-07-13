import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeContext } from "@context-ray/core";
import { formatMarkdown, formatSarif, formatTerminal, renderHtml } from "../src/index.js";

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
  });
});
