import type { Finding, FindingSeverityChange, ReportDiff, Severity } from "@context-ray/schema";

export type FailureThreshold = "none" | Severity;

export interface BaselineGateResult {
  failed: boolean;
  addedFindings: Finding[];
  severityRegressions: FindingSeverityChange[];
}

export function severityRank(severity: Severity): number {
  return severity === "error" ? 3 : severity === "warning" ? 2 : 1;
}

/** Evaluate only newly introduced findings and severity increases. */
export function evaluateBaselineGate(
  diff: ReportDiff,
  failOnNew: FailureThreshold,
): BaselineGateResult {
  if (failOnNew === "none") {
    return { failed: false, addedFindings: [], severityRegressions: [] };
  }
  const threshold = severityRank(failOnNew);
  const addedFindings = diff.addedFindings.filter(
    (finding) => severityRank(finding.severity) >= threshold,
  );
  const severityRegressions = diff.severityChanges.filter(
    (change) => change.direction === "increased" && severityRank(change.after) >= threshold,
  );
  return {
    failed: addedFindings.length > 0 || severityRegressions.length > 0,
    addedFindings,
    severityRegressions,
  };
}
