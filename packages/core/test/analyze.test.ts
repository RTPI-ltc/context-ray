import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeContext, compareReports, discoverContext, isScanReport } from "../src/index.js";

const fixture = path.resolve("fixtures/sample-repo");
const target = "services/payments";

describe("Context Ray adapters", () => {
  it("models Codex root-to-target precedence and reports conflicts", async () => {
    const report = await analyzeContext({ root: fixture, target, agent: "codex" });
    const activePaths = report.sources
      .filter((source) => source.status === "active" || source.status === "truncated")
      .map((source) => source.path);

    expect(activePaths).toContain("AGENTS.md");
    expect(activePaths).toContain("services/payments/AGENTS.override.md");
    expect(report.findings.map((finding) => finding.ruleId)).toContain("conflict/package-manager");
    expect(report.findings.map((finding) => finding.ruleId)).toContain("conflict/node-version");
    expect(report.findings.map((finding) => finding.ruleId)).toContain("mcp/unpinned-package");
    expect(report.summary.mcpTools).toBe(2);
    expect(isScanReport(report)).toBe(true);
    expect(
      report.findings
        .filter((finding) => finding.estimatedSavings !== undefined)
        .every((finding) => Number.isInteger(finding.estimatedSavings)),
    ).toBe(true);
    expect(
      report.recommendations.every((recommendation) =>
        Number.isInteger(recommendation.estimatedTokenSavings),
      ),
    ).toBe(true);
    expect(report.coverage.find((item) => item.area === "internal-prompt")?.status).toBe(
      "not-observable",
    );
  });

  it("resolves Claude imports, path rules, and on-demand skills", async () => {
    const discovery = await discoverContext({ root: fixture, target, agent: "claude" });
    expect(discovery.sources.find((source) => source.path === "docs/payments.md")?.status).toBe(
      "active",
    );
    expect(
      discovery.sources.find((source) => source.path === ".claude/rules/payments.md")?.status,
    ).toBe("active");
    expect(
      discovery.sources.find((source) => source.path === ".claude/skills/reconcile/SKILL.md")
        ?.status,
    ).toBe("on-demand");
    expect(discovery.edges.some((edge) => edge.kind === "imports")).toBe(true);
  });

  it.each([
    ["cursor", ".cursor/rules/testing.mdc"],
    ["copilot", ".github/instructions/payments.instructions.md"],
    ["gemini", "GEMINI.md"],
  ] as const)("activates %s target-specific evidence", async (agent, expectedPath) => {
    const report = await analyzeContext({ root: fixture, target, agent });
    expect(report.sources.find((source) => source.path === expectedPath)?.status).toBe("active");
  });
});

describe("report comparison", () => {
  it("returns stable zero deltas for the same repository state", async () => {
    const before = await analyzeContext({ root: fixture, target, agent: "codex" });
    const after = await analyzeContext({ root: fixture, target, agent: "codex" });
    const diff = compareReports(before, after);
    expect(diff.deltas.effectiveTokens).toBe(0);
    expect(diff.addedSourceIds).toEqual([]);
    expect(diff.addedFindingIds).toEqual([]);
  });

  it("keeps scan IDs stable for identical inputs and separates task-specific reports", async () => {
    const first = await analyzeContext({
      root: fixture,
      target,
      agent: "codex",
      task: "review payments",
    });
    const repeated = await analyzeContext({
      root: fixture,
      target,
      agent: "codex",
      task: "review payments",
    });
    const otherTask = await analyzeContext({
      root: fixture,
      target,
      agent: "codex",
      task: "review database access",
    });

    expect(repeated.scan.id).toBe(first.scan.id);
    expect(otherTask.scan.id).not.toBe(first.scan.id);
    expect(first.scan.task).toBe("review payments");
  });

  it("normalizes equivalent target paths for stable baseline comparability", async () => {
    const plain = await analyzeContext({ root: fixture, target, agent: "codex" });
    const dotted = await analyzeContext({ root: fixture, target: `./${target}`, agent: "codex" });

    expect(dotted.scan.target).toBe(target);
    expect(dotted.scan.id).toBe(plain.scan.id);
    expect(compareReports(plain, dotted).comparability).toEqual({
      comparable: true,
      scopeDifferences: [],
    });
  });

  it("rejects targets outside the repository boundary", async () => {
    await expect(analyzeContext({ root: fixture, target: "../", agent: "codex" })).rejects.toThrow(
      "Target must stay inside the repository",
    );
  });
});
