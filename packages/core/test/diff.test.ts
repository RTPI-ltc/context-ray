import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeContext, compareReports, evaluateBaselineGate } from "../src/index.js";

const fixture = path.resolve("fixtures/sample-repo");

describe("report regression diff", () => {
  it("returns finding payloads, source changes, and severity transitions", async () => {
    const before = await analyzeContext({
      root: fixture,
      target: "services/payments",
      agent: "codex",
    });
    const after = structuredClone(before);
    const changedSource = after.sources[0];
    const escalatedFinding = after.findings.find((finding) => finding.severity === "warning");
    const resolvedFinding = after.findings.find((finding) => finding.id !== escalatedFinding?.id);
    expect(changedSource).toBeDefined();
    expect(escalatedFinding).toBeDefined();
    expect(resolvedFinding).toBeDefined();
    if (!changedSource || !escalatedFinding || !resolvedFinding) return;

    changedSource.tokenEstimate += 7;
    changedSource.contentHash = "changed-content";
    escalatedFinding.severity = "error";
    after.findings = after.findings.filter((finding) => finding.id !== resolvedFinding.id);
    after.findings.push({
      ...structuredClone(escalatedFinding),
      id: "new-finding",
      ruleId: "quality/new-regression",
      severity: "warning",
    });

    const diff = compareReports(before, after);
    expect(diff.comparability).toEqual({ comparable: true, scopeDifferences: [] });
    expect(diff.changedSources[0]).toMatchObject({
      id: changedSource.id,
      changedFields: expect.arrayContaining(["tokenEstimate", "contentHash"]),
    });
    expect(diff.addedFindingIds).toContain("new-finding");
    expect(diff.addedFindings.map((finding) => finding.id)).toContain("new-finding");
    expect(diff.resolvedFindingIds).toContain(resolvedFinding.id);
    expect(diff.resolvedFindings.map((finding) => finding.id)).toContain(resolvedFinding.id);
    expect(diff.severityChanges).toContainEqual({
      id: escalatedFinding.id,
      ruleId: escalatedFinding.ruleId,
      before: "warning",
      after: "error",
      direction: "increased",
    });
  });

  it("marks different scan scopes as non-comparable", async () => {
    const before = await analyzeContext({ root: fixture, target: ".", agent: "codex" });
    const after = await analyzeContext({
      root: fixture,
      target: "services/payments",
      agent: "claude",
      task: "review payments",
    });
    expect(compareReports(before, after).comparability).toEqual({
      comparable: false,
      scopeDifferences: ["agent", "target", "task"],
    });
  });

  it("gates only added findings and severity increases at the selected threshold", async () => {
    const before = await analyzeContext({
      root: fixture,
      target: "services/payments",
      agent: "codex",
    });
    const after = structuredClone(before);
    const existing = after.findings.find((finding) => finding.severity === "warning");
    expect(existing).toBeDefined();
    if (!existing) return;
    existing.severity = "error";
    after.findings.push({
      ...structuredClone(existing),
      id: "new-note",
      ruleId: "quality/new-note",
      severity: "note",
    });

    const diff = compareReports(before, after);
    expect(evaluateBaselineGate(diff, "error")).toMatchObject({
      failed: true,
      addedFindings: [],
      severityRegressions: [{ id: existing.id, after: "error" }],
    });
    expect(evaluateBaselineGate(diff, "none").failed).toBe(false);

    const onlyExisting = compareReports(before, structuredClone(before));
    expect(evaluateBaselineGate(onlyExisting, "note").failed).toBe(false);
  });
});
