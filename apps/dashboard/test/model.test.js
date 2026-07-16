import { describe, expect, it } from "vitest";
import {
  buildBands,
  compositionSegments,
  exportSuccessMessage,
  findingFilterCounts,
  findingsForFilter,
  formatScanLabel,
  initialItemId,
  loadModeForSource,
  recommendationForSource,
} from "../src/model.js";

const report = {
  scan: { startedAt: "2026-07-13T06:32:00.000Z", durationMs: 42 },
  sources: [
    { id: "a", kind: "instruction", status: "active", relevance: "high", tokenEstimate: 100 },
    { id: "b", kind: "mcp-tool", status: "on-demand", relevance: "low", tokenEstimate: 200 },
    { id: "c", kind: "config", status: "active", relevance: "medium", tokenEstimate: 0 },
  ],
  findings: [
    {
      id: "f",
      title: "Conflict",
      message: "conflict",
      confidence: "high",
      recommendation: "fix",
      evidence: [{ sourceId: "a", path: "AGENTS.md", excerpt: "text" }],
    },
  ],
  recommendations: [
    {
      title: "Defer tool",
      description: "Load later",
      confidence: "medium",
      estimatedTokenSavings: 150,
      sourceIds: ["b"],
    },
  ],
  edges: [],
};

describe("dashboard model", () => {
  it("builds every grouping from report data", () => {
    expect(buildBands(report, "source-type").map((band) => band.count)).toEqual([1, 1, 0, 1, 0, 1]);
    expect(buildBands(report, "load-mode").map((band) => band.count)).toEqual([2, 0, 1, 0, 1]);
    expect(buildBands(report, "relevance").map((band) => band.count)).toEqual([1, 1, 1, 0, 1]);
  });

  it("derives observed load mode and backend recommendation without demo fallbacks", () => {
    expect(loadModeForSource(report.sources[1])).toBe("On-demand");
    expect(loadModeForSource({ ...report.sources[0], status: "conditional" })).toBe("Conditional");
    expect(loadModeForSource({ ...report.sources[0], status: "unavailable" })).toBe("Excluded");
    expect(recommendationForSource(report, "b")).toMatchObject({
      title: "Defer tool",
      savings: 150,
      confidence: "medium",
    });
  });

  it("formats the real scan duration", () => {
    expect(formatScanLabel(report)).toContain("42 ms");
  });

  it("selects the highest-severity finding before the largest source", () => {
    const withSeverities = {
      ...report,
      findings: [
        { ...report.findings[0], id: "warning", severity: "warning" },
        { ...report.findings[0], id: "error", severity: "error" },
      ],
    };
    expect(initialItemId(withSeverities)).toBe("finding:error");
    expect(initialItemId({ ...report, findings: [] })).toBe("b");
  });

  it("sorts and filters the real finding queue", () => {
    const findings = [
      { ...report.findings[0], id: "warning", severity: "warning", category: "conflict" },
      {
        ...report.findings[0],
        id: "cost",
        severity: "note",
        category: "cost",
        estimatedSavings: 80,
      },
      { ...report.findings[0], id: "error", severity: "error", category: "quality" },
    ];
    expect(findingsForFilter(findings).map((finding) => finding.id)).toEqual([
      "error",
      "warning",
      "cost",
    ]);
    expect(findingsForFilter(findings, "conflict").map((finding) => finding.id)).toEqual([
      "warning",
    ]);
    expect(findingsForFilter(findings, "actionable").map((finding) => finding.id)).toEqual([
      "cost",
    ]);
    expect(findingFilterCounts(findings)).toMatchObject({
      all: 3,
      error: 1,
      warning: 1,
      note: 1,
      conflict: 1,
      actionable: 1,
    });
  });

  it("uses a linear global token scale and keeps zero-token records visible", () => {
    const segments = compositionSegments(report.sources, 400, 400, 56);
    const sourceA = segments.find((segment) => segment.item.id === "a");
    const sourceB = segments.find((segment) => segment.item.id === "b");
    const sourceC = segments.find((segment) => segment.item.id === "c");
    expect(sourceB.width / sourceA.width).toBe(2);
    expect(sourceC).toMatchObject({ x: 344, width: 56, scale: "metadata" });
    expect(segments).toHaveLength(report.sources.length);
  });

  it("does not describe a cancelled export as successful", () => {
    expect(exportSuccessMessage({ saved: false })).toBeNull();
    expect(exportSuccessMessage({ saved: true, fileName: "report.sarif" })).toBe(
      "Export ready · report.sarif",
    );
  });
});
