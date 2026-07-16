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
export type LoadMode = "eager" | "progressive" | "on-demand";
export type ObservedLoadMode = LoadMode | "conditional" | "excluded";

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
  /** Full finding payloads for consumers that need to gate or render regressions. */
  addedFindings: Finding[];
  resolvedFindings: Finding[];
  /** Sources whose stable id remained the same but whose observed payload changed. */
  changedSources: SourceChange[];
  /** Findings whose stable id remained the same but whose payload changed. */
  changedFindings: FindingChange[];
  /** Explicit severity transitions, including both regressions and improvements. */
  severityChanges: FindingSeverityChange[];
  comparability: ReportComparability;
}

export type ReportScopeField = "agent" | "target" | "task" | "mode";

export interface ReportComparability {
  comparable: boolean;
  scopeDifferences: ReportScopeField[];
}

export interface SourceChange {
  id: string;
  changedFields: Array<Exclude<keyof ContextSource, "id">>;
  before: ContextSource;
  after: ContextSource;
}

export interface FindingChange {
  id: string;
  changedFields: Array<Exclude<keyof Finding, "id">>;
  before: Finding;
  after: Finding;
}

export interface FindingSeverityChange {
  id: string;
  ruleId: string;
  before: Severity;
  after: Severity;
  direction: "increased" | "decreased";
}

export interface LoadModeProjection {
  reportId: string;
  sourceId: string;
  sourceLabel: string;
  currentMode: ObservedLoadMode;
  requestedMode: LoadMode;
  currentContributionTokens: number;
  projectedContributionTokens: number;
  deltaTokens: number;
  projectedEffectiveTokens: number;
  estimatedSavings: number;
  estimatedIncrease: number;
  confidence: Confidence;
  explanation: string;
  mutatesConfiguration: false;
}

export interface DashboardRuntime {
  mode: "static" | "server" | "vscode";
  root: string;
  repoLabel: string;
  agents: AgentId[];
  targets: string[];
  supports: {
    scan: boolean;
    projection: boolean;
    sourcePreview: boolean;
    export: boolean;
  };
}

export interface ScanReportValidationResult {
  valid: boolean;
  errors: string[];
}

type UnknownRecord = Record<string, unknown>;

const AGENT_IDS: readonly AgentId[] = ["codex", "claude", "cursor", "copilot", "gemini"];
const SOURCE_KINDS: readonly SourceKind[] = [
  "instruction",
  "config",
  "skill",
  "mcp-config",
  "mcp-server",
  "mcp-tool",
  "hook",
  "referenced-file",
  "runtime",
];
const SOURCE_STATUSES: readonly SourceStatus[] = [
  "active",
  "conditional",
  "on-demand",
  "shadowed",
  "ignored",
  "truncated",
  "unavailable",
];
const OBSERVABILITY_VALUES: readonly Observability[] = ["observed", "inferred", "unobservable"];
const CONFIDENCE_VALUES: readonly Confidence[] = ["high", "medium", "low"];
const SEVERITY_VALUES: readonly Severity[] = ["error", "warning", "note"];
const RELEVANCE_VALUES: readonly Relevance[] = ["high", "medium", "low", "unknown"];
const EDGE_KINDS: readonly EdgeKind[] = ["loads", "imports", "overrides", "declares", "observes"];
const FINDING_CATEGORIES: readonly Finding["category"][] = [
  "conflict",
  "cost",
  "security",
  "quality",
  "observability",
];
const COVERAGE_AREAS: readonly CoverageItem["area"][] = [
  "repository",
  "global-config",
  "runtime",
  "internal-prompt",
  "mcp-tools",
];
const COVERAGE_STATUSES: readonly CoverageItem["status"][] = [
  "complete",
  "partial",
  "not-observable",
  "not-requested",
];

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 1;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isEnum<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function optional(value: unknown, predicate: (item: unknown) => boolean): boolean {
  return value === undefined || predicate(value);
}

function requireRecord(value: unknown, at: string, errors: string[]): UnknownRecord | undefined {
  if (isRecord(value)) return value;
  errors.push(`${at} must be an object`);
  return undefined;
}

function requireString(value: unknown, at: string, errors: string[]): boolean {
  if (typeof value === "string") return true;
  errors.push(`${at} must be a string`);
  return false;
}

function requireNonNegativeInteger(value: unknown, at: string, errors: string[]): boolean {
  if (isNonNegativeInteger(value)) return true;
  errors.push(`${at} must be a non-negative integer`);
  return false;
}

function requireEnum<T extends string>(
  value: unknown,
  values: readonly T[],
  at: string,
  errors: string[],
): boolean {
  if (isEnum(value, values)) return true;
  errors.push(`${at} must be one of: ${values.join(", ")}`);
  return false;
}

function validateMetadata(value: unknown, at: string, errors: string[]): boolean {
  const record = requireRecord(value, at, errors);
  if (!record) return false;
  let valid = true;
  for (const [key, item] of Object.entries(record)) {
    const itemValid =
      typeof item === "string" ||
      typeof item === "boolean" ||
      isFiniteNumber(item) ||
      isStringArray(item);
    if (!itemValid) {
      errors.push(`${at}.${key} must be a string, finite number, boolean, or string array`);
      valid = false;
    }
  }
  return valid;
}

function validateEvidence(value: unknown, at: string, errors: string[]): boolean {
  const evidence = requireRecord(value, at, errors);
  if (!evidence) return false;
  const before = errors.length;
  requireString(evidence.sourceId, `${at}.sourceId`, errors);
  requireString(evidence.path, `${at}.path`, errors);
  requireString(evidence.excerpt, `${at}.excerpt`, errors);
  if (!optional(evidence.line, isPositiveInteger))
    errors.push(`${at}.line must be a positive integer`);
  if (!optional(evidence.column, isPositiveInteger)) {
    errors.push(`${at}.column must be a positive integer`);
  }
  return errors.length === before;
}

function validateSource(value: unknown, at: string, errors: string[]): boolean {
  const source = requireRecord(value, at, errors);
  if (!source) return false;
  const before = errors.length;
  for (const field of ["id", "label", "path", "reason", "contentHash"] as const) {
    requireString(source[field], `${at}.${field}`, errors);
  }
  requireEnum(source.kind, SOURCE_KINDS, `${at}.kind`, errors);
  requireEnum(source.agent, AGENT_IDS, `${at}.agent`, errors);
  requireEnum(source.status, SOURCE_STATUSES, `${at}.status`, errors);
  requireEnum(source.observability, OBSERVABILITY_VALUES, `${at}.observability`, errors);
  requireEnum(source.confidence, CONFIDENCE_VALUES, `${at}.confidence`, errors);
  requireEnum(source.relevance, RELEVANCE_VALUES, `${at}.relevance`, errors);
  for (const field of ["tokenEstimate", "bytes", "lines"] as const) {
    requireNonNegativeInteger(source[field], `${at}.${field}`, errors);
  }
  if (!optional(source.order, isFiniteNumber)) errors.push(`${at}.order must be a finite number`);
  if (!optional(source.patterns, isStringArray))
    errors.push(`${at}.patterns must be a string array`);
  if (!optional(source.serverName, (item) => typeof item === "string")) {
    errors.push(`${at}.serverName must be a string`);
  }
  if (!optional(source.toolName, (item) => typeof item === "string")) {
    errors.push(`${at}.toolName must be a string`);
  }
  if (source.metadata !== undefined) validateMetadata(source.metadata, `${at}.metadata`, errors);
  return errors.length === before;
}

function validateEdge(value: unknown, at: string, errors: string[]): boolean {
  const edge = requireRecord(value, at, errors);
  if (!edge) return false;
  const before = errors.length;
  requireString(edge.from, `${at}.from`, errors);
  requireString(edge.to, `${at}.to`, errors);
  requireString(edge.reason, `${at}.reason`, errors);
  requireEnum(edge.kind, EDGE_KINDS, `${at}.kind`, errors);
  return errors.length === before;
}

function validateFinding(value: unknown, at: string, errors: string[]): boolean {
  const finding = requireRecord(value, at, errors);
  if (!finding) return false;
  const before = errors.length;
  for (const field of ["id", "ruleId", "title", "message", "recommendation"] as const) {
    requireString(finding[field], `${at}.${field}`, errors);
  }
  requireEnum(finding.severity, SEVERITY_VALUES, `${at}.severity`, errors);
  requireEnum(finding.confidence, CONFIDENCE_VALUES, `${at}.confidence`, errors);
  requireEnum(finding.category, FINDING_CATEGORIES, `${at}.category`, errors);
  if (!Array.isArray(finding.evidence) || finding.evidence.length === 0) {
    errors.push(`${at}.evidence must be a non-empty array`);
  } else {
    finding.evidence.forEach((item, index) =>
      validateEvidence(item, `${at}.evidence[${index}]`, errors),
    );
  }
  if (!optional(finding.estimatedSavings, isNonNegativeInteger)) {
    errors.push(`${at}.estimatedSavings must be a non-negative integer`);
  }
  return errors.length === before;
}

function validateCoverage(value: unknown, at: string, errors: string[]): boolean {
  const item = requireRecord(value, at, errors);
  if (!item) return false;
  const before = errors.length;
  requireEnum(item.area, COVERAGE_AREAS, `${at}.area`, errors);
  requireEnum(item.status, COVERAGE_STATUSES, `${at}.status`, errors);
  requireString(item.explanation, `${at}.explanation`, errors);
  return errors.length === before;
}

function validateRecommendation(value: unknown, at: string, errors: string[]): boolean {
  const recommendation = requireRecord(value, at, errors);
  if (!recommendation) return false;
  const before = errors.length;
  for (const field of ["id", "title", "description"] as const) {
    requireString(recommendation[field], `${at}.${field}`, errors);
  }
  requireEnum(recommendation.confidence, CONFIDENCE_VALUES, `${at}.confidence`, errors);
  requireNonNegativeInteger(
    recommendation.estimatedTokenSavings,
    `${at}.estimatedTokenSavings`,
    errors,
  );
  if (!isStringArray(recommendation.sourceIds)) {
    errors.push(`${at}.sourceIds must be a string array`);
  }
  return errors.length === before;
}

function validateSummary(value: unknown, at: string, errors: string[]): boolean {
  const summary = requireRecord(value, at, errors);
  if (!summary) return false;
  const before = errors.length;
  for (const field of [
    "effectiveTokens",
    "instructionTokens",
    "skillTokens",
    "toolSchemaTokens",
    "potentialWasteTokens",
    "conflicts",
    "highRiskPermissions",
    "activeSources",
    "discoveredSources",
    "mcpServers",
    "mcpTools",
  ] as const) {
    requireNonNegativeInteger(summary[field], `${at}.${field}`, errors);
  }
  return errors.length === before;
}

function validateRuntime(value: unknown, at: string, errors: string[]): boolean {
  const runtime = requireRecord(value, at, errors);
  if (!runtime) return false;
  const before = errors.length;
  if (!isStringArray(runtime.command)) errors.push(`${at}.command must be a string array`);
  requireString(runtime.startedAt, `${at}.startedAt`, errors);
  requireNonNegativeInteger(runtime.durationMs, `${at}.durationMs`, errors);
  if (!(
    runtime.exitCode === null ||
    (isFiniteNumber(runtime.exitCode) && Number.isInteger(runtime.exitCode))
  )) {
    errors.push(`${at}.exitCode must be an integer or null`);
  }
  if (!(runtime.signal === null || typeof runtime.signal === "string")) {
    errors.push(`${at}.signal must be a string or null`);
  }
  requireNonNegativeInteger(runtime.stdoutBytes, `${at}.stdoutBytes`, errors);
  requireNonNegativeInteger(runtime.stderrBytes, `${at}.stderrBytes`, errors);
  requireString(runtime.note, `${at}.note`, errors);
  return errors.length === before;
}

function validateArray(
  value: unknown,
  at: string,
  errors: string[],
  validator: (item: unknown, itemPath: string, errors: string[]) => boolean,
): boolean {
  if (!Array.isArray(value)) {
    errors.push(`${at} must be an array`);
    return false;
  }
  const before = errors.length;
  value.forEach((item, index) => validator(item, `${at}[${index}]`, errors));
  return errors.length === before;
}

function validateUniqueIds(value: unknown, at: string, errors: string[]): void {
  if (!Array.isArray(value)) return;
  const ids = new Set<string>();
  value.forEach((item, index) => {
    if (!isRecord(item) || typeof item.id !== "string") return;
    if (ids.has(item.id)) errors.push(`${at}[${index}].id must be unique`);
    ids.add(item.id);
  });
}

/**
 * Fully validate the public ScanReport v1 runtime boundary.
 *
 * Unknown object properties are intentionally accepted so v1 consumers remain
 * forward compatible with new optional fields.
 */
export function validateScanReport(value: unknown): ScanReportValidationResult {
  const errors: string[] = [];
  const report = requireRecord(value, "$", errors);
  if (!report) return { valid: false, errors };

  if (report.schemaVersion !== REPORT_SCHEMA_VERSION) {
    errors.push(`$.schemaVersion must be ${REPORT_SCHEMA_VERSION}`);
  }

  const tool = requireRecord(report.tool, "$.tool", errors);
  if (tool) {
    if (tool.name !== "context-ray") errors.push('$.tool.name must be "context-ray"');
    requireString(tool.version, "$.tool.version", errors);
  }

  const scan = requireRecord(report.scan, "$.scan", errors);
  if (scan) {
    for (const field of ["id", "startedAt", "root", "target"] as const) {
      requireString(scan[field], `$.scan.${field}`, errors);
    }
    requireNonNegativeInteger(scan.durationMs, "$.scan.durationMs", errors);
    requireEnum(scan.agent, AGENT_IDS, "$.scan.agent", errors);
    requireEnum(scan.mode, ["static", "static+runtime"] as const, "$.scan.mode", errors);
    if (!optional(scan.task, (item) => typeof item === "string")) {
      errors.push("$.scan.task must be a string");
    }
  }

  validateSummary(report.summary, "$.summary", errors);
  validateArray(report.coverage, "$.coverage", errors, validateCoverage);
  validateArray(report.sources, "$.sources", errors, validateSource);
  validateArray(report.edges, "$.edges", errors, validateEdge);
  validateArray(report.findings, "$.findings", errors, validateFinding);
  validateArray(report.recommendations, "$.recommendations", errors, validateRecommendation);
  if (report.runtime !== undefined) validateRuntime(report.runtime, "$.runtime", errors);

  validateUniqueIds(report.sources, "$.sources", errors);
  validateUniqueIds(report.findings, "$.findings", errors);
  validateUniqueIds(report.recommendations, "$.recommendations", errors);

  if (scan?.mode === "static+runtime" && report.runtime === undefined) {
    errors.push("$.runtime is required when $.scan.mode is static+runtime");
  }
  if (scan?.mode === "static" && report.runtime !== undefined) {
    errors.push("$.runtime must be omitted when $.scan.mode is static");
  }

  if (Array.isArray(report.sources)) {
    const sourceIds = new Set<string>();
    report.sources.forEach((source, index) => {
      if (!isRecord(source) || typeof source.id !== "string") return;
      sourceIds.add(source.id);
      if (
        scan &&
        typeof scan.agent === "string" &&
        typeof source.agent === "string" &&
        source.agent !== scan.agent
      ) {
        errors.push(`$.sources[${index}].agent must match $.scan.agent`);
      }
    });
    if (Array.isArray(report.edges)) {
      report.edges.forEach((edge, index) => {
        if (!isRecord(edge)) return;
        if (typeof edge.from === "string" && !sourceIds.has(edge.from)) {
          errors.push(`$.edges[${index}].from must reference a source id`);
        }
        if (typeof edge.to === "string" && !sourceIds.has(edge.to)) {
          errors.push(`$.edges[${index}].to must reference a source id`);
        }
      });
    }
    if (Array.isArray(report.findings)) {
      report.findings.forEach((finding, findingIndex) => {
        if (!isRecord(finding) || !Array.isArray(finding.evidence)) return;
        finding.evidence.forEach((evidence, evidenceIndex) => {
          if (
            isRecord(evidence) &&
            typeof evidence.sourceId === "string" &&
            !sourceIds.has(evidence.sourceId)
          ) {
            errors.push(
              `$.findings[${findingIndex}].evidence[${evidenceIndex}].sourceId must reference a source id`,
            );
          }
        });
      });
    }
    if (Array.isArray(report.recommendations)) {
      report.recommendations.forEach((recommendation, recommendationIndex) => {
        if (!isRecord(recommendation) || !Array.isArray(recommendation.sourceIds)) return;
        recommendation.sourceIds.forEach((sourceId, sourceIndex) => {
          if (typeof sourceId === "string" && !sourceIds.has(sourceId)) {
            errors.push(
              `$.recommendations[${recommendationIndex}].sourceIds[${sourceIndex}] must reference a source id`,
            );
          }
        });
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

export function isScanReport(value: unknown): value is ScanReport {
  return validateScanReport(value).valid;
}
