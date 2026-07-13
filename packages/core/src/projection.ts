import type { ContextSource, LoadMode, LoadModeProjection, ScanReport } from "@context-ray/schema";

const STARTUP_STATUSES = new Set<ContextSource["status"]>(["active", "conditional", "truncated"]);

export function loadModeForSource(source: ContextSource): LoadMode {
  if (source.status === "on-demand") return "on-demand";
  if (source.status === "conditional") return "progressive";
  return "eager";
}

function contributionForMode(source: ContextSource, mode: LoadMode): number {
  if (mode === "on-demand") return 0;
  if (mode === "eager") return source.tokenEstimate;
  const retainedRatio = source.kind === "mcp-tool" || source.kind === "skill" ? 0.35 : 0.6;
  return Math.round(source.tokenEstimate * retainedRatio);
}

export function projectLoadMode(
  report: ScanReport,
  sourceId: string,
  requestedMode: LoadMode,
): LoadModeProjection {
  const source = report.sources.find((item) => item.id === sourceId);
  if (!source) throw new Error(`Source not found in report ${report.scan.id}: ${sourceId}`);

  const currentMode = loadModeForSource(source);
  const currentContributionTokens = STARTUP_STATUSES.has(source.status) ? source.tokenEstimate : 0;
  const projectedContributionTokens = contributionForMode(source, requestedMode);
  const deltaTokens = projectedContributionTokens - currentContributionTokens;
  const projectedEffectiveTokens = Math.max(0, report.summary.effectiveTokens + deltaTokens);
  const estimatedSavings = Math.max(0, -deltaTokens);
  const estimatedIncrease = Math.max(0, deltaTokens);
  const explanation =
    requestedMode === currentMode
      ? "The selected scenario matches the source's currently observed load mode."
      : requestedMode === "eager"
        ? "The scenario places the full source in startup context."
        : requestedMode === "progressive"
          ? "The scenario keeps a compact discovery descriptor in startup context and defers the remaining detail."
          : "The scenario removes the source from startup context and loads it only after explicit demand.";

  return {
    reportId: report.scan.id,
    sourceId,
    sourceLabel: source.label,
    currentMode,
    requestedMode,
    currentContributionTokens,
    projectedContributionTokens,
    deltaTokens,
    projectedEffectiveTokens,
    estimatedSavings,
    estimatedIncrease,
    confidence: source.confidence,
    explanation,
    mutatesConfiguration: false,
  };
}
