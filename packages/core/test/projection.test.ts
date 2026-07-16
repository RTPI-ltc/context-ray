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
    {
      id: "shadowed-1",
      label: "shadowed instructions",
      kind: "instruction",
      status: "shadowed",
      tokenEstimate: 300,
      confidence: "high",
    },
    {
      id: "conditional-1",
      label: "conditional guidance",
      kind: "instruction",
      status: "conditional",
      tokenEstimate: 400,
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

  it("projects excluded sources without pretending they are currently eager", () => {
    expect(projectLoadMode(report, "shadowed-1", "eager")).toMatchObject({
      currentMode: "excluded",
      currentContributionTokens: 0,
      projectedContributionTokens: 300,
      estimatedIncrease: 300,
      projectedEffectiveTokens: 1_800,
    });
    expect(projectLoadMode(report, "shadowed-1", "on-demand")).toMatchObject({
      currentMode: "excluded",
      deltaTokens: 0,
      projectedEffectiveTokens: 1_500,
    });
  });

  it("starts conditional projections from the report's zero current contribution", () => {
    expect(projectLoadMode(report, "conditional-1", "progressive")).toMatchObject({
      currentMode: "conditional",
      currentContributionTokens: 0,
      projectedContributionTokens: 240,
      deltaTokens: 240,
      projectedEffectiveTokens: 1_740,
      estimatedIncrease: 240,
    });
    expect(projectLoadMode(report, "conditional-1", "on-demand")).toMatchObject({
      currentMode: "conditional",
      currentContributionTokens: 0,
      deltaTokens: 0,
      projectedEffectiveTokens: 1_500,
    });
    expect(projectLoadMode(report, "conditional-1", "progressive").explanation).not.toContain(
      "matches",
    );
  });

  it("rejects source ids that are not part of the report", () => {
    expect(() => projectLoadMode(report, "missing", "eager")).toThrow("Source not found");
  });
});
