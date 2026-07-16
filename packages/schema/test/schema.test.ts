import { readFile } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  REPORT_SCHEMA_VERSION,
  isScanReport,
  validateScanReport,
  type ScanReport,
} from "../src/index.js";

function validReport(): ScanReport {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    tool: { name: "context-ray", version: "0.1.0" },
    scan: {
      id: "scan-1",
      startedAt: "2026-07-13T00:00:00.000Z",
      durationMs: 5,
      root: "/repo",
      target: ".",
      agent: "codex",
      mode: "static",
    },
    summary: {
      effectiveTokens: 10,
      instructionTokens: 10,
      skillTokens: 0,
      toolSchemaTokens: 0,
      potentialWasteTokens: 0,
      conflicts: 0,
      highRiskPermissions: 0,
      activeSources: 1,
      discoveredSources: 1,
      mcpServers: 0,
      mcpTools: 0,
    },
    coverage: [
      { area: "repository", status: "complete", explanation: "Repository files observed." },
    ],
    sources: [
      {
        id: "source-1",
        label: "AGENTS.md",
        path: "AGENTS.md",
        kind: "instruction",
        agent: "codex",
        status: "active",
        observability: "observed",
        confidence: "high",
        reason: "Repository instruction",
        tokenEstimate: 10,
        bytes: 40,
        lines: 2,
        contentHash: "abc123",
        relevance: "high",
        metadata: { loadedBytes: 40, inherited: true, patterns: ["**"] },
      },
    ],
    edges: [],
    findings: [
      {
        id: "finding-1",
        ruleId: "quality/example",
        title: "Example",
        message: "Example finding",
        severity: "note",
        confidence: "high",
        category: "quality",
        evidence: [{ sourceId: "source-1", path: "AGENTS.md", line: 1, excerpt: "Example" }],
        recommendation: "Review the example.",
      },
    ],
    recommendations: [
      {
        id: "recommendation-1",
        title: "Review",
        description: "Review the example.",
        confidence: "medium",
        estimatedTokenSavings: 0,
        sourceIds: ["source-1"],
      },
    ],
  };
}

describe("ScanReport runtime validation", () => {
  it("validates every nested report section and accepts future optional fields", () => {
    const report = validReport() as ScanReport & { futureOptionalField: string };
    report.futureOptionalField = "accepted within schema v1";
    expect(validateScanReport(report)).toEqual({ valid: true, errors: [] });
    expect(isScanReport(report)).toBe(true);
  });

  const structuralInvalidMutations: Array<[string, (report: Record<string, any>) => void]> = [
    ["invalid agent enum", (report: Record<string, any>) => (report.scan.agent = "other")],
    ["missing summary value", (report: Record<string, any>) => delete report.summary.mcpTools],
    [
      "invalid source metadata",
      (report: Record<string, any>) => (report.sources[0].metadata = { nested: {} }),
    ],
    ["evidence-free finding", (report: Record<string, any>) => (report.findings[0].evidence = [])],
    ["negative count", (report: Record<string, any>) => (report.summary.effectiveTokens = -1)],
    [
      "runtime omitted for runtime mode",
      (report: Record<string, any>) => (report.scan.mode = "static+runtime"),
    ],
  ];

  const semanticInvalidMutations: Array<[string, (report: Record<string, any>) => void]> = [
    [
      "dangling evidence",
      (report: Record<string, any>) => (report.findings[0].evidence[0].sourceId = "missing"),
    ],
    [
      "dangling edge",
      (report: Record<string, any>) =>
        report.edges.push({ from: "source-1", to: "missing", kind: "loads", reason: "test" }),
    ],
    [
      "duplicate finding id",
      (report: Record<string, any>) => report.findings.push(structuredClone(report.findings[0])),
    ],
    [
      "duplicate recommendation id",
      (report: Record<string, any>) =>
        report.recommendations.push(structuredClone(report.recommendations[0])),
    ],
    [
      "source agent differs from scan",
      (report: Record<string, any>) => (report.sources[0].agent = "claude"),
    ],
  ];

  const invalidMutations = [...structuralInvalidMutations, ...semanticInvalidMutations];

  it.each(invalidMutations)("rejects %s", (_label, mutate) => {
    const report = structuredClone(validReport()) as unknown as Record<string, any>;
    mutate(report);
    const result = validateScanReport(report);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(isScanReport(report)).toBe(false);
  });

  it("ships a Draft 2020-12 artifact that matches structural runtime validation", async () => {
    const schemaPath = path.resolve("packages/schema/scan-report.schema.json");
    const schema = JSON.parse(await readFile(schemaPath, "utf8")) as Record<string, any>;
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.properties.schemaVersion.const).toBe(REPORT_SCHEMA_VERSION);
    expect(schema.required).toContain("recommendations");
    expect(schema.$defs.finding.properties.evidence.minItems).toBe(1);

    const validateArtifact = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
    expect(validateArtifact(validReport()), validateArtifact.errors ?? []).toBe(true);
    for (const [label, mutate] of structuralInvalidMutations) {
      const report = structuredClone(validReport()) as unknown as Record<string, any>;
      mutate(report);
      expect(validateArtifact(report), `${label}: ${JSON.stringify(validateArtifact.errors)}`).toBe(
        false,
      );
    }
  });
});
