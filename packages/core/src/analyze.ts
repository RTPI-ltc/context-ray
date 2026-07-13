import { createHash } from "node:crypto";
import path from "node:path";
import type {
  Confidence,
  ContextSource,
  CoverageItem,
  Evidence,
  Finding,
  Recommendation,
  ScanOptions,
  ScanReport,
  Severity,
} from "@context-ray/schema";
import { REPORT_SCHEMA_VERSION } from "@context-ray/schema";
import { discoverContext } from "./discover.js";
import { lineExcerpt } from "./utils.js";

const TOOL_VERSION = "0.1.0";
const EFFECTIVE_STATUSES = new Set(["active", "truncated"]);

interface FindingInput {
  ruleId: string;
  title: string;
  message: string;
  severity: Severity;
  confidence: Confidence;
  category: Finding["category"];
  evidence: Evidence[];
  recommendation: string;
  estimatedSavings?: number;
}

function findingId(input: FindingInput): string {
  return createHash("sha256")
    .update(
      `${input.ruleId}:${input.evidence.map((item) => `${item.sourceId}:${item.line ?? 0}`).join(":")}`,
    )
    .digest("hex")
    .slice(0, 16);
}

function makeFinding(input: FindingInput): Finding {
  return {
    id: findingId(input),
    ...input,
    ...(input.estimatedSavings === undefined
      ? {}
      : { estimatedSavings: Math.max(0, Math.round(input.estimatedSavings)) }),
  };
}

function evidenceAt(source: ContextSource, content: string, line: number): Evidence {
  return {
    sourceId: source.id,
    path: source.path,
    line,
    excerpt: lineExcerpt(content, line),
  };
}

function firstMatchingLine(content: string, pattern: RegExp): number {
  const lines = content.split(/\r?\n/);
  const index = lines.findIndex((line) => {
    pattern.lastIndex = 0;
    return pattern.test(line);
  });
  return Math.max(1, index + 1);
}

function normalizedWords(content: string): Set<string> {
  return new Set(
    content
      .toLowerCase()
      .replace(/```[\s\S]*?```/g, " ")
      .split(/[^a-z0-9_-]+/)
      .filter((word) => word.length > 3),
  );
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const word of left) if (right.has(word)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function analyzeSingleSource(source: ContextSource, content: string): Finding[] {
  const findings: Finding[] = [];
  const active = EFFECTIVE_STATUSES.has(source.status);

  if (
    active &&
    source.kind === "instruction" &&
    (source.tokenEstimate > 8_000 || source.lines > 300)
  ) {
    findings.push(
      makeFinding({
        ruleId: "context/oversized-instruction",
        title: "Oversized always-loaded instruction",
        message: `${source.path} contributes about ${source.tokenEstimate.toLocaleString()} tokens before task work begins.`,
        severity: "warning",
        confidence: "high",
        category: "cost",
        evidence: [evidenceAt(source, content, 1)],
        recommendation:
          "Keep stable global rules here and move task-specific procedures into path rules or on-demand skills.",
        estimatedSavings: Math.max(0, source.tokenEstimate - 4_000),
      }),
    );
  }

  if (active && source.relevance === "low" && source.tokenEstimate >= 500) {
    findings.push(
      makeFinding({
        ruleId: "context/low-relevance",
        title: "Low-relevance context is loaded",
        message: `${source.path} has little lexical overlap with the selected target or task but remains in effective context.`,
        severity: "note",
        confidence: "medium",
        category: "cost",
        evidence: [evidenceAt(source, content, 1)],
        recommendation: "Scope this source to matching paths or convert it to an on-demand skill.",
        estimatedSavings: source.tokenEstimate * 0.7,
      }),
    );
  }

  const bidiPattern = /[\u202A-\u202E\u2066-\u2069]/;
  if (bidiPattern.test(content)) {
    const line = firstMatchingLine(content, bidiPattern);
    findings.push(
      makeFinding({
        ruleId: "security/bidi-control",
        title: "Hidden bidirectional control character",
        message:
          "A Unicode direction-control character can make displayed instructions differ from their parsed order.",
        severity: "error",
        confidence: "high",
        category: "security",
        evidence: [evidenceAt(source, content, line)],
        recommendation:
          "Remove the hidden control character and review the surrounding instruction as plain text.",
      }),
    );
  }

  const pipeToShell = /(?:curl|wget)\b[^\n|]{0,240}\|\s*(?:ba|z|fi)?sh\b/i;
  const destructive = /\brm\s+-[a-z]*r[a-z]*f\b|\bsudo\b|\bchmod\s+777\b/i;
  const dangerousPattern = pipeToShell.test(content) ? pipeToShell : destructive;
  if (dangerousPattern.test(content)) {
    const line = firstMatchingLine(content, dangerousPattern);
    findings.push(
      makeFinding({
        ruleId: "security/dangerous-command",
        title: "Instruction contains a high-risk shell pattern",
        message: "This source can steer an agent toward a destructive or unaudited command.",
        severity: "error",
        confidence: "high",
        category: "security",
        evidence: [evidenceAt(source, content, line)],
        recommendation:
          "Replace it with a narrowly scoped, reviewable command and require explicit approval for destructive operations.",
      }),
    );
  }

  const unsafePermission =
    /dangerouslyDisableSandbox|dangerously-skip-permissions|approval_policy\s*=\s*["']never["']|\byolo\b/i;
  if (unsafePermission.test(content)) {
    const line = firstMatchingLine(content, unsafePermission);
    findings.push(
      makeFinding({
        ruleId: "security/broad-permission",
        title: "Broad permission bypass detected",
        message: "The configuration appears to disable a safety or approval boundary.",
        severity: "error",
        confidence: "high",
        category: "security",
        evidence: [evidenceAt(source, content, line)],
        recommendation:
          "Use the narrowest command, path, and network permissions required for the workflow.",
      }),
    );
  }

  const remoteImport = /(^|\s)@https?:\/\//im;
  if (remoteImport.test(content)) {
    const line = firstMatchingLine(content, remoteImport);
    findings.push(
      makeFinding({
        ruleId: "security/remote-instruction",
        title: "Remote instruction import",
        message: "A remote import can change effective guidance without a repository commit.",
        severity: "warning",
        confidence: "high",
        category: "security",
        evidence: [evidenceAt(source, content, line)],
        recommendation:
          "Vendor and review the content locally, or pin it to an immutable digest with an explicit trust policy.",
      }),
    );
  }

  const literalSecret =
    /(?:api[_-]?key|token|secret|password)["']?\s*[:=]\s*["'](?!\$\{|\$|<|env:)([^"'\n]{8,})["']/i;
  if (literalSecret.test(content)) {
    const line = firstMatchingLine(content, literalSecret);
    findings.push(
      makeFinding({
        ruleId: "security/literal-secret",
        title: "Possible literal secret in agent configuration",
        message:
          "A credential-like value appears to be stored directly in a discovered context source.",
        severity: "error",
        confidence: "medium",
        category: "security",
        evidence: [
          { ...evidenceAt(source, content, line), excerpt: "Credential-like assignment redacted" },
        ],
        recommendation:
          "Move the value to the environment or a secret manager, rotate it, and remove it from repository history.",
      }),
    );
  }

  if (source.kind === "mcp-tool" && source.tokenEstimate > 1_200) {
    findings.push(
      makeFinding({
        ruleId: "mcp/large-tool-schema",
        title: "Large MCP tool schema",
        message: `${source.serverName ?? "MCP server"}/${source.toolName ?? source.label} contributes about ${source.tokenEstimate.toLocaleString()} schema tokens.`,
        severity: "warning",
        confidence: "high",
        category: "cost",
        evidence: [evidenceAt(source, content, 1)],
        recommendation:
          "Expose a compact discovery tool first and load detailed operation schemas only after selection.",
        estimatedSavings: source.tokenEstimate * 0.75,
      }),
    );
  }

  if (source.kind === "mcp-server") {
    const command = typeof source.metadata?.command === "string" ? source.metadata.command : "";
    const args = Array.isArray(source.metadata?.args) ? source.metadata.args.join(" ") : "";
    const usesNpx = /(?:^|\/)npx(?:\.cmd)?$/i.test(command);
    const hasPinnedPackage = /(?:^|\s)@?[^\s@/]+(?:\/[^\s@]+)?@(?:\d|sha|git\+)/i.test(args);
    if (usesNpx && !hasPinnedPackage) {
      findings.push(
        makeFinding({
          ruleId: "mcp/unpinned-package",
          title: "Unpinned MCP package execution",
          message: `${source.label} is launched through npx without an immutable package version.`,
          severity: "warning",
          confidence: "high",
          category: "security",
          evidence: [evidenceAt(source, content, 1)],
          recommendation:
            "Pin the MCP server package to a reviewed version or digest and update it deliberately.",
        }),
      );
    }
  }

  return findings;
}

function analyzeCrossSource(sources: ContextSource[], contents: Map<string, string>): Finding[] {
  const findings: Finding[] = [];
  const activeInstructions = sources.filter(
    (source) => source.kind === "instruction" && EFFECTIVE_STATUSES.has(source.status),
  );

  const packageManagers = new Map<string, { source: ContextSource; line: number }>();
  for (const source of activeInstructions) {
    const content = contents.get(source.id) ?? "";
    const pattern = /\b(pnpm|npm|yarn|bun)\s+(?:install|run|test|build|dev|lint)\b/gi;
    for (const match of content.matchAll(pattern)) {
      const manager = match[1]?.toLowerCase();
      if (!manager || packageManagers.has(manager)) continue;
      const line = content.slice(0, match.index ?? 0).split(/\r?\n/).length;
      packageManagers.set(manager, { source, line });
    }
  }
  if (packageManagers.size > 1) {
    const managers = [...packageManagers.keys()];
    findings.push(
      makeFinding({
        ruleId: "conflict/package-manager",
        title: "Conflicting package-manager guidance",
        message: `Effective sources instruct the agent to use ${managers.join(" and ")}.`,
        severity: "error",
        confidence: "high",
        category: "conflict",
        evidence: [...packageManagers.values()].map(({ source, line }) =>
          evidenceAt(source, contents.get(source.id) ?? "", line),
        ),
        recommendation:
          "Choose one package manager and make deeper instructions explicitly override or inherit the repository policy.",
      }),
    );
  }

  const versions = new Map<string, { source: ContextSource; line: number }>();
  const versionPattern = /\bnode(?:\.js)?\s*(?:version|>=|>|=|v)?\s*(\d{2,})(?:\.\d+)?/gi;
  for (const source of activeInstructions) {
    const content = contents.get(source.id) ?? "";
    for (const match of content.matchAll(versionPattern)) {
      const version = match[1];
      if (!version || versions.has(version)) continue;
      const line = content.slice(0, match.index ?? 0).split(/\r?\n/).length;
      versions.set(version, { source, line });
    }
  }
  if (versions.size > 1) {
    findings.push(
      makeFinding({
        ruleId: "conflict/node-version",
        title: "Conflicting Node.js versions",
        message: `Effective sources mention incompatible Node.js majors: ${[...versions.keys()].join(", ")}.`,
        severity: "warning",
        confidence: "medium",
        category: "conflict",
        evidence: [...versions.values()].map(({ source, line }) =>
          evidenceAt(source, contents.get(source.id) ?? "", line),
        ),
        recommendation:
          "Declare the supported runtime once and reference that source from narrower instructions.",
      }),
    );
  }

  const wordSets = activeInstructions.map((source) => ({
    source,
    words: normalizedWords(contents.get(source.id) ?? ""),
  }));
  for (let leftIndex = 0; leftIndex < wordSets.length; leftIndex += 1) {
    const left = wordSets[leftIndex];
    if (!left || left.source.tokenEstimate < 300) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < wordSets.length; rightIndex += 1) {
      const right = wordSets[rightIndex];
      if (!right || right.source.tokenEstimate < 300) continue;
      const overlap = jaccard(left.words, right.words);
      if (overlap < 0.72) continue;
      findings.push(
        makeFinding({
          ruleId: "quality/duplicate-instructions",
          title: "Substantially duplicated instructions",
          message: `${left.source.path} and ${right.source.path} have ${(overlap * 100).toFixed(0)}% normalized vocabulary overlap.`,
          severity: "note",
          confidence: "medium",
          category: "quality",
          evidence: [
            evidenceAt(left.source, contents.get(left.source.id) ?? "", 1),
            evidenceAt(right.source, contents.get(right.source.id) ?? "", 1),
          ],
          recommendation:
            "Keep shared policy in one source and let agent-specific files contain only the compatibility delta.",
          estimatedSavings: Math.min(left.source.tokenEstimate, right.source.tokenEstimate) * 0.65,
        }),
      );
    }
  }

  const toolsByName = new Map<string, ContextSource[]>();
  for (const source of sources.filter((item) => item.kind === "mcp-tool")) {
    const key = source.toolName?.toLowerCase() ?? source.label.toLowerCase();
    toolsByName.set(key, [...(toolsByName.get(key) ?? []), source]);
  }
  for (const [toolName, matching] of toolsByName) {
    const servers = new Set(matching.map((source) => source.serverName));
    if (servers.size < 2) continue;
    findings.push(
      makeFinding({
        ruleId: "mcp/duplicate-tool-name",
        title: "Ambiguous MCP tool name",
        message: `${toolName} is exposed by ${[...servers].join(", ")}; an agent may select the wrong server.`,
        severity: "warning",
        confidence: "high",
        category: "quality",
        evidence: matching.map((source) => evidenceAt(source, contents.get(source.id) ?? "", 1)),
        recommendation:
          "Namespace or rename overlapping tools and make each description state its unique domain and side effects.",
      }),
    );
  }

  return findings;
}

function buildCoverage(options: ScanOptions, sources: ContextSource[]): CoverageItem[] {
  const servers = sources.filter((source) => source.kind === "mcp-server");
  const tools = sources.filter((source) => source.kind === "mcp-tool");
  return [
    {
      area: "repository",
      status: "complete",
      explanation:
        "Supported repository instruction, rule, skill, hook, and MCP configuration paths were scanned without executing project code.",
    },
    {
      area: "global-config",
      status: options.includeGlobal ? "partial" : "not-requested",
      explanation: options.includeGlobal
        ? "Global scanning was requested, but this build keeps user-home and managed organization policy out of the report; repository evidence remains complete."
        : "Pass --include-global to request user-level adapter discovery.",
    },
    {
      area: "runtime",
      status: options.runtime ? "partial" : "not-requested",
      explanation: options.runtime
        ? "Process exit and I/O volume were observed, but the agent's private prompt and provider-side transforms remain hidden."
        : "Static mode does not launch an agent or MCP server.",
    },
    {
      area: "internal-prompt",
      status: "not-observable",
      explanation:
        "Provider system prompts, prompt rewriting, caching, and final serialization are not exposed by repository files.",
    },
    {
      area: "mcp-tools",
      status: servers.length === 0 || tools.length > 0 ? "complete" : "partial",
      explanation:
        servers.length === 0
          ? "No MCP servers were declared for this agent."
          : tools.length > 0
            ? "Tool schemas were read from explicit local snapshots; live availability was not assumed."
            : "Server declarations were found, but exact tool schemas require a supplied snapshot or an explicit probe.",
    },
  ];
}

function buildRecommendations(findings: Finding[]): Recommendation[] {
  return findings
    .filter((finding) => (finding.estimatedSavings ?? 0) > 0)
    .sort((left, right) => (right.estimatedSavings ?? 0) - (left.estimatedSavings ?? 0))
    .slice(0, 8)
    .map((finding) => ({
      id: `recommendation-${finding.id}`,
      title: finding.title,
      description: finding.recommendation,
      confidence: finding.confidence,
      estimatedTokenSavings: finding.estimatedSavings ?? 0,
      sourceIds: [...new Set(finding.evidence.map((item) => item.sourceId))],
    }));
}

export async function analyzeContext(options: ScanOptions): Promise<ScanReport> {
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const root = path.resolve(options.root);
  const discovery = await discoverContext({ ...options, root });
  const findings = [
    ...discovery.sources.flatMap((source) =>
      analyzeSingleSource(source, discovery.contents.get(source.id) ?? ""),
    ),
    ...analyzeCrossSource(discovery.sources, discovery.contents),
  ].sort((left, right) => {
    const rank: Record<Severity, number> = { error: 0, warning: 1, note: 2 };
    return rank[left.severity] - rank[right.severity] || left.ruleId.localeCompare(right.ruleId);
  });
  const effective = discovery.sources.filter((source) => EFFECTIVE_STATUSES.has(source.status));
  const sum = (predicate: (source: ContextSource) => boolean): number =>
    effective.filter(predicate).reduce((total, source) => total + source.tokenEstimate, 0);
  const potentialWasteTokens = Math.round(
    findings.reduce((total, finding) => total + (finding.estimatedSavings ?? 0), 0),
  );
  const reportId = createHash("sha256")
    .update(
      `${root}:${options.agent}:${options.target ?? "."}:${discovery.sources.map((source) => source.contentHash).join(":")}`,
    )
    .digest("hex")
    .slice(0, 16);

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    tool: { name: "context-ray", version: TOOL_VERSION },
    scan: {
      id: reportId,
      startedAt,
      durationMs: Math.round(performance.now() - started),
      root,
      target: options.target ?? ".",
      agent: options.agent,
      ...(options.task ? { task: options.task } : {}),
      mode: options.runtime ? "static+runtime" : "static",
    },
    summary: {
      effectiveTokens: effective.reduce((total, source) => total + source.tokenEstimate, 0),
      instructionTokens: sum(
        (source) => source.kind === "instruction" || source.kind === "referenced-file",
      ),
      skillTokens: sum((source) => source.kind === "skill"),
      toolSchemaTokens: sum((source) => source.kind === "mcp-tool"),
      potentialWasteTokens,
      conflicts: findings.filter((finding) => finding.category === "conflict").length,
      highRiskPermissions: findings.filter(
        (finding) =>
          finding.ruleId === "security/broad-permission" ||
          finding.ruleId === "security/dangerous-command",
      ).length,
      activeSources: effective.length,
      discoveredSources: discovery.sources.length,
      mcpServers: discovery.sources.filter((source) => source.kind === "mcp-server").length,
      mcpTools: discovery.sources.filter((source) => source.kind === "mcp-tool").length,
    },
    coverage: buildCoverage(options, discovery.sources),
    sources: discovery.sources,
    edges: discovery.edges,
    findings,
    recommendations: buildRecommendations(findings),
    ...(options.runtime ? { runtime: options.runtime } : {}),
  };
}
