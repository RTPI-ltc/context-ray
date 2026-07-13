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
  if (source.status === "conditional") return "Progressive";
  if (source.status === "ignored" || source.status === "shadowed") return "Excluded";
  return "Eager";
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

const GROUPS = {
  "source-type": ["Instructions", "Configuration", "Skills", "MCP", "References", "Findings"],
  "load-mode": ["Eager", "Progressive", "On-demand", "Excluded", "Findings"],
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
