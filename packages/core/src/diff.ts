import type {
  ContextSource,
  Finding,
  FindingChange,
  FindingSeverityChange,
  ReportDiff,
  ReportScopeField,
  ScanReport,
  Severity,
  SourceChange,
} from "@context-ray/schema";

function difference(after: string[], before: string[]): string[] {
  const previous = new Set(before);
  return after.filter((item) => !previous.has(item)).sort();
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameValue(item, right[index]))
    );
  }
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) {
    return false;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) => key === rightKeys[index] && sameValue(leftRecord[key], rightRecord[key]),
    )
  );
}

const SOURCE_CHANGE_FIELDS: Array<Exclude<keyof ContextSource, "id">> = [
  "label",
  "path",
  "kind",
  "agent",
  "status",
  "observability",
  "confidence",
  "reason",
  "tokenEstimate",
  "bytes",
  "lines",
  "contentHash",
  "relevance",
  "order",
  "patterns",
  "serverName",
  "toolName",
  "metadata",
];

const FINDING_CHANGE_FIELDS: Array<Exclude<keyof Finding, "id">> = [
  "ruleId",
  "title",
  "message",
  "severity",
  "confidence",
  "category",
  "evidence",
  "recommendation",
  "estimatedSavings",
];

function changedSources(before: ScanReport, after: ScanReport): SourceChange[] {
  const previous = new Map(before.sources.map((source) => [source.id, source]));
  return after.sources
    .flatMap((source) => {
      const oldSource = previous.get(source.id);
      if (!oldSource) return [];
      const changedFields = SOURCE_CHANGE_FIELDS.filter(
        (field) => !sameValue(oldSource[field], source[field]),
      );
      return changedFields.length > 0
        ? [{ id: source.id, changedFields, before: oldSource, after: source }]
        : [];
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function changedFindings(before: ScanReport, after: ScanReport): FindingChange[] {
  const previous = new Map(before.findings.map((finding) => [finding.id, finding]));
  return after.findings
    .flatMap((finding) => {
      const oldFinding = previous.get(finding.id);
      if (!oldFinding) return [];
      const changedFields = FINDING_CHANGE_FIELDS.filter(
        (field) => !sameValue(oldFinding[field], finding[field]),
      );
      return changedFields.length > 0
        ? [{ id: finding.id, changedFields, before: oldFinding, after: finding }]
        : [];
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function severityRank(severity: Severity): number {
  return severity === "error" ? 3 : severity === "warning" ? 2 : 1;
}

function severityChanges(changes: FindingChange[]): FindingSeverityChange[] {
  return changes.flatMap((change) => {
    if (change.before.severity === change.after.severity) return [];
    return [
      {
        id: change.id,
        ruleId: change.after.ruleId,
        before: change.before.severity,
        after: change.after.severity,
        direction:
          severityRank(change.after.severity) > severityRank(change.before.severity)
            ? "increased"
            : "decreased",
      },
    ];
  });
}

function scopeDifferences(before: ScanReport, after: ScanReport): ReportScopeField[] {
  const differences: ReportScopeField[] = [];
  if (before.scan.agent !== after.scan.agent) differences.push("agent");
  if (before.scan.target !== after.scan.target) differences.push("target");
  if (before.scan.task !== after.scan.task) differences.push("task");
  if (before.scan.mode !== after.scan.mode) differences.push("mode");
  return differences;
}

export function compareReports(before: ScanReport, after: ScanReport): ReportDiff {
  const addedFindingIds = difference(
    after.findings.map((finding) => finding.id),
    before.findings.map((finding) => finding.id),
  );
  const resolvedFindingIds = difference(
    before.findings.map((finding) => finding.id),
    after.findings.map((finding) => finding.id),
  );
  const addedFindingIdSet = new Set(addedFindingIds);
  const resolvedFindingIdSet = new Set(resolvedFindingIds);
  const findingChanges = changedFindings(before, after);
  const differences = scopeDifferences(before, after);
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
    addedFindingIds,
    resolvedFindingIds,
    addedFindings: after.findings
      .filter((finding) => addedFindingIdSet.has(finding.id))
      .sort((left, right) => left.id.localeCompare(right.id)),
    resolvedFindings: before.findings
      .filter((finding) => resolvedFindingIdSet.has(finding.id))
      .sort((left, right) => left.id.localeCompare(right.id)),
    changedSources: changedSources(before, after),
    changedFindings: findingChanges,
    severityChanges: severityChanges(findingChanges),
    comparability: {
      comparable: differences.length === 0,
      scopeDifferences: differences,
    },
  };
}
