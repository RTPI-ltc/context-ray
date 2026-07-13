import { describe, expect, it } from "vitest";
import type { ScanReport } from "@context-ray/schema";
import { projectLoadMode } from "../src/projection.js";

const report = {
  scan: { id: "report-1" },
  summary: { effectiveTokens: 1_500 },
  sources: [
    {
      id: "tool-1",
      label: "database / query",
      kind: "mcp-tool",
      status: "active",
      tokenEstimate: 1_000,
      confidence: "high",
    },
    {
      id: "skill-1",
      label: "testing",
      kind: "skill",
      status: "on-demand",
      tokenEstimate: 500,
      confidence: "medium",
    },
  ],
} as unknown as ScanReport;

describe("projectLoadMode", () => {
  it("projects eager sources into progressive and on-demand startup cost", () => {
    expect(projectLoadMode(report, "tool-1", "progressive")).toMatchObject({
      currentMode: "eager",
      projectedContributionTokens: 350,
      estimatedSavings: 650,
      projectedEffectiveTokens: 850,
      mutatesConfiguration: false,
    });
    expect(projectLoadMode(report, "tool-1", "on-demand").estimatedSavings).toBe(1_000);
  });

  it("reports the cost of making an on-demand source eager", () => {
    expect(projectLoadMode(report, "skill-1", "eager")).toMatchObject({
      currentMode: "on-demand",
      estimatedIncrease: 500,
      projectedEffectiveTokens: 2_000,
    });
  });

  it("rejects source ids that are not part of the report", () => {
    expect(() => projectLoadMode(report, "missing", "eager")).toThrow("Source not found");
  });
});
