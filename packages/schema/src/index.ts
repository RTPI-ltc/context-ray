export const REPORT_SCHEMA_VERSION = 1 as const;

export type AgentId = "codex" | "claude" | "cursor" | "copilot" | "gemini";

export type SourceKind =
  | "instruction"
  | "config"
  | "skill"
  | "mcp-config"
  | "mcp-server"
  | "mcp-tool"
  | "hook"
  | "referenced-file"
  | "runtime";

export type SourceStatus =
  "active" | "conditional" | "on-demand" | "shadowed" | "ignored" | "truncated" | "unavailable";

export type Observability = "observed" | "inferred" | "unobservable";
export type Confidence = "high" | "medium" | "low";
export type Severity = "error" | "warning" | "note";
export type Relevance = "high" | "medium" | "low" | "unknown";

export interface SourceLocation {
  path: string;
  line?: number;
  column?: number;
}

export interface Evidence extends SourceLocation {
  sourceId: string;
  excerpt: string;
}

export interface ContextSource {
  id: string;
  label: string;
  path: string;
  kind: SourceKind;
  agent: AgentId;
  status: SourceStatus;
  observability: Observability;
  confidence: Confidence;
  reason: string;
  tokenEstimate: number;
  bytes: number;
  lines: number;
  contentHash: string;
  relevance: Relevance;
  order?: number;
  patterns?: string[];
  serverName?: string;
  toolName?: string;
  metadata?: Record<string, string | number | boolean | string[]>;
}

export type EdgeKind = "loads" | "imports" | "overrides" | "declares" | "observes";

export interface ContextEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  reason: string;
}

export interface Finding {
  id: string;
  ruleId: string;
  title: string;
  message: string;
  severity: Severity;
  confidence: Confidence;
  category: "conflict" | "cost" | "security" | "quality" | "observability";
  evidence: Evidence[];
  recommendation: string;
  estimatedSavings?: number;
}

export interface CoverageItem {
  area: "repository" | "global-config" | "runtime" | "internal-prompt" | "mcp-tools";
  status: "complete" | "partial" | "not-observable" | "not-requested";
  explanation: string;
}

export interface Recommendation {
  id: string;
  title: string;
  description: string;
  confidence: Confidence;
  estimatedTokenSavings: number;
  sourceIds: string[];
}

export interface ScanSummary {
  effectiveTokens: number;
  instructionTokens: number;
  skillTokens: number;
  toolSchemaTokens: number;
  potentialWasteTokens: number;
  conflicts: number;
  highRiskPermissions: number;
  activeSources: number;
  discoveredSources: number;
  mcpServers: number;
  mcpTools: number;
}

export interface RuntimeObservation {
  command: string[];
  startedAt: string;
  durationMs: number;
  exitCode: number | null;
  signal: string | null;
  stdoutBytes: number;
  stderrBytes: number;
  note: string;
}

export interface ScanReport {
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  tool: {
    name: "context-ray";
    version: string;
  };
  scan: {
    id: string;
    startedAt: string;
    durationMs: number;
    root: string;
    target: string;
    agent: AgentId;
    task?: string;
    mode: "static" | "static+runtime";
  };
  summary: ScanSummary;
  coverage: CoverageItem[];
  sources: ContextSource[];
  edges: ContextEdge[];
  findings: Finding[];
  recommendations: Recommendation[];
  runtime?: RuntimeObservation;
}

export interface ScanOptions {
  root: string;
  target?: string;
  agent: AgentId;
  task?: string;
  includeGlobal?: boolean;
  maxFileBytes?: number;
  mcpSnapshotPaths?: string[];
  runtime?: RuntimeObservation;
}

export interface ReportDiff {
  before: Pick<ScanReport, "scan" | "summary">;
  after: Pick<ScanReport, "scan" | "summary">;
  deltas: {
    effectiveTokens: number;
    toolSchemaTokens: number;
    conflicts: number;
    highRiskPermissions: number;
    sources: number;
  };
  addedSourceIds: string[];
  removedSourceIds: string[];
  addedFindingIds: string[];
  resolvedFindingIds: string[];
}

export function isScanReport(value: unknown): value is ScanReport {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ScanReport>;
  return (
    candidate.schemaVersion === REPORT_SCHEMA_VERSION &&
    candidate.tool?.name === "context-ray" &&
    typeof candidate.scan?.root === "string" &&
    Array.isArray(candidate.sources) &&
    Array.isArray(candidate.findings)
  );
}
