export const AGENTS = ["codex", "claude", "cursor", "copilot", "gemini"];

export function compact(value) {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
}

export function sourceGroup(source) {
  if (source.kind === "mcp-tool" || source.kind === "mcp-server" || source.kind === "mcp-config") {
    return "MCP";
  }
  if (source.kind === "skill") return "Skills";
  if (source.kind === "referenced-file") return "References";
  if (source.kind === "instruction") return "Instructions";
  return "Configuration";
}

export function loadModeForSource(source) {
  if (source.status === "on-demand") return "On-demand";
  if (source.status === "conditional") return "Conditional";
  if (source.status === "active" || source.status === "truncated") return "Eager";
  return "Excluded";
}

export function findingItems(report) {
  return report.findings.map((finding) => {
    const evidence = finding.evidence[0];
    return {
      id: `finding:${finding.id}`,
      itemType: "finding",
      label: finding.title,
      path: evidence?.path ?? finding.ruleId,
      kind: "config",
      status: "active",
      observability: "observed",
      confidence: finding.confidence,
      reason: finding.message,
      tokenEstimate: 0,
      relevance: "unknown",
      finding,
    };
  });
}

export function reportItems(report) {
  return [
    ...report.sources.map((source) => ({ ...source, itemType: "source", source })),
    ...findingItems(report),
  ];
}

const SEVERITY_ORDER = { error: 0, warning: 1, note: 2 };

export function sortedFindings(findings) {
  return [...findings].sort((left, right) => {
    const severity =
      (SEVERITY_ORDER[left.severity] ?? Number.MAX_SAFE_INTEGER) -
      (SEVERITY_ORDER[right.severity] ?? Number.MAX_SAFE_INTEGER);
    if (severity !== 0) return severity;
    const savings = (right.estimatedSavings ?? 0) - (left.estimatedSavings ?? 0);
    if (savings !== 0) return savings;
    return left.title.localeCompare(right.title);
  });
}

export function initialItemId(report) {
  const finding = sortedFindings(report.findings)[0];
  if (finding) return `finding:${finding.id}`;
  const source = [...report.sources].sort(
    (left, right) =>
      right.tokenEstimate - left.tokenEstimate || left.label.localeCompare(right.label),
  )[0];
  return source?.id ?? null;
}

export function findingsForFilter(findings, filter = "all") {
  const sorted = sortedFindings(findings);
  if (filter === "all") return sorted;
  if (filter === "actionable") {
    return sorted.filter(
      (finding) => finding.category === "cost" || (finding.estimatedSavings ?? 0) > 0,
    );
  }
  if (filter === "conflict") {
    return sorted.filter((finding) => finding.category === "conflict");
  }
  return sorted.filter((finding) => finding.severity === filter);
}

export function findingFilterCounts(findings) {
  return {
    all: findings.length,
    error: findings.filter((finding) => finding.severity === "error").length,
    warning: findings.filter((finding) => finding.severity === "warning").length,
    note: findings.filter((finding) => finding.severity === "note").length,
    conflict: findings.filter((finding) => finding.category === "conflict").length,
    actionable: findings.filter(
      (finding) => finding.category === "cost" || (finding.estimatedSavings ?? 0) > 0,
    ).length,
  };
}

export function exportSuccessMessage(result) {
  if (!result?.saved) return null;
  return `Export ready${result.fileName ? ` · ${result.fileName}` : ""}`;
}

export function compositionSegments(items, scaleMax, availableWidth = 980, metadataLaneWidth = 0) {
  const safeScale = Math.max(1, scaleMax);
  const tokenItems = items.filter((item) => item.tokenEstimate > 0);
  const metadataItems = items.filter((item) => item.tokenEstimate <= 0);
  const safeMetadataLaneWidth = Math.min(availableWidth, Math.max(0, metadataLaneWidth));
  const tokenScaleWidth = availableWidth - safeMetadataLaneWidth;
  let cursor = 0;
  const tokens = tokenItems.map((item) => {
    const width = tokenScaleWidth * (item.tokenEstimate / safeScale);
    const segment = { item, x: cursor, width, scale: "tokens" };
    cursor += width;
    return segment;
  });
  const metadataWidth = metadataItems.length ? safeMetadataLaneWidth / metadataItems.length : 0;
  const metadata = metadataItems.map((item, index) => ({
    item,
    x: tokenScaleWidth + index * metadataWidth,
    width: metadataWidth,
    scale: "metadata",
  }));
  return [...tokens, ...metadata];
}

const GROUPS = {
  "source-type": ["Instructions", "Configuration", "Skills", "MCP", "References", "Findings"],
  "load-mode": ["Eager", "Conditional", "On-demand", "Excluded", "Findings"],
  relevance: ["High", "Medium", "Low", "Unknown", "Findings"],
};

function groupName(item, groupBy) {
  if (item.itemType === "finding") return "Findings";
  if (groupBy === "load-mode") return loadModeForSource(item);
  if (groupBy === "relevance") {
    return item.relevance[0].toUpperCase() + item.relevance.slice(1);
  }
  return sourceGroup(item);
}

export function buildBands(report, groupBy = "source-type") {
  const items = reportItems(report);
  const names = GROUPS[groupBy] ?? GROUPS["source-type"];
  return names.map((name) => {
    const grouped = items.filter((item) => groupName(item, groupBy) === name);
    return {
      name,
      items: grouped,
      totalTokens: grouped.reduce((sum, item) => sum + item.tokenEstimate, 0),
      count: grouped.length,
    };
  });
}

export function recommendationForSource(report, sourceId) {
  const recommendation = report.recommendations.find((item) => item.sourceIds.includes(sourceId));
  const findings = report.findings.filter((finding) =>
    finding.evidence.some((evidence) => evidence.sourceId === sourceId),
  );
  if (recommendation) {
    return {
      title: recommendation.title,
      description: recommendation.description,
      savings: recommendation.estimatedTokenSavings,
      confidence: recommendation.confidence,
      findings,
    };
  }
  return {
    title: findings.length > 0 ? findings[0].title : "Keep current loading",
    description:
      findings.length > 0
        ? findings[0].recommendation
        : "No backend recommendation changes this source's current load path.",
    savings: Math.max(0, ...findings.map((finding) => finding.estimatedSavings ?? 0)),
    confidence: findings[0]?.confidence ?? "high",
    findings,
  };
}

export function referencesForItem(report, item) {
  if (item.itemType === "finding") return item.finding.evidence;
  const evidence = report.findings.flatMap((finding) =>
    finding.evidence.filter((entry) => entry.sourceId === item.id),
  );
  const edges = report.edges
    .filter((edge) => edge.from === item.id || edge.to === item.id)
    .map((edge) => ({
      sourceId: item.id,
      path: item.path,
      excerpt: `${edge.kind}: ${edge.reason}`,
    }));
  return [...evidence, ...edges];
}

export function formatScanLabel(report) {
  const date = new Date(report.scan.startedAt);
  if (Number.isNaN(date.getTime())) return `${report.scan.durationMs} ms`;
  return `${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · ${report.scan.durationMs} ms`;
}
