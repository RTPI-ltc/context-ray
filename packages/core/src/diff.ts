import type { ReportDiff, ScanReport } from "@context-ray/schema";

function difference(after: string[], before: string[]): string[] {
  const previous = new Set(before);
  return after.filter((item) => !previous.has(item)).sort();
}

export function compareReports(before: ScanReport, after: ScanReport): ReportDiff {
  return {
    before: { scan: before.scan, summary: before.summary },
    after: { scan: after.scan, summary: after.summary },
    deltas: {
      effectiveTokens: after.summary.effectiveTokens - before.summary.effectiveTokens,
      toolSchemaTokens: after.summary.toolSchemaTokens - before.summary.toolSchemaTokens,
      conflicts: after.summary.conflicts - before.summary.conflicts,
      highRiskPermissions: after.summary.highRiskPermissions - before.summary.highRiskPermissions,
      sources: after.summary.discoveredSources - before.summary.discoveredSources,
    },
    addedSourceIds: difference(
      after.sources.map((source) => source.id),
      before.sources.map((source) => source.id),
    ),
    removedSourceIds: difference(
      before.sources.map((source) => source.id),
      after.sources.map((source) => source.id),
    ),
    addedFindingIds: difference(
      after.findings.map((finding) => finding.id),
      before.findings.map((finding) => finding.id),
    ),
    resolvedFindingIds: difference(
      before.findings.map((finding) => finding.id),
      after.findings.map((finding) => finding.id),
    ),
  };
}
