import type {
  ContextSource,
  LoadMode,
  LoadModeProjection,
  ObservedLoadMode,
  ScanReport,
} from "@context-ray/schema";

const EFFECTIVE_STATUSES = new Set<ContextSource["status"]>(["active", "truncated"]);

export function loadModeForSource(source: ContextSource): ObservedLoadMode {
  if (source.status === "on-demand") return "on-demand";
  if (source.status === "conditional") return "conditional";
  if (EFFECTIVE_STATUSES.has(source.status)) return "eager";
  return "excluded";
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
  const currentContributionTokens = EFFECTIVE_STATUSES.has(source.status)
    ? source.tokenEstimate
    : 0;
  const projectedContributionTokens = contributionForMode(source, requestedMode);
  const deltaTokens = projectedContributionTokens - currentContributionTokens;
  const projectedEffectiveTokens = Math.max(0, report.summary.effectiveTokens + deltaTokens);
  const estimatedSavings = Math.max(0, -deltaTokens);
  const estimatedIncrease = Math.max(0, deltaTokens);
  const explanation =
    requestedMode === currentMode
      ? "The selected scenario matches the source's currently observed load mode."
      : currentMode === "conditional" && requestedMode === "on-demand"
        ? "The source is currently conditional and contributes no startup tokens for this target; this scenario makes loading explicitly on-demand."
        : currentMode === "excluded" && requestedMode === "on-demand"
          ? "The source stays out of startup context but becomes available after explicit demand."
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
