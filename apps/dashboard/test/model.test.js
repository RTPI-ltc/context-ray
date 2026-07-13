import { describe, expect, it } from "vitest";
import {
  buildBands,
  formatScanLabel,
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
    expect(recommendationForSource(report, "b")).toMatchObject({
      title: "Defer tool",
      savings: 150,
      confidence: "medium",
    });
  });

  it("formats the real scan duration", () => {
    expect(formatScanLabel(report)).toContain("42 ms");
  });
});
