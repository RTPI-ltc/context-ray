import path from "node:path";
import * as TOML from "@iarna/toml";
import fg from "fast-glob";
import { parse as parseYaml } from "yaml";
import type {
  AgentId,
  Confidence,
  ContextEdge,
  ContextSource,
  Observability,
  Relevance,
  ScanOptions,
  SourceKind,
  SourceStatus,
} from "@context-ray/schema";
import {
  directoriesBetween,
  estimateTokens,
  matchesAny,
  parseFrontMatter,
  readTextWithinRoot,
  relevanceFor,
  resolveTargetDirectory,
  sourceId,
  stringArray,
  toPosix,
  type TextFile,
} from "./utils.js";

const DISCOVERY_PATTERNS = [
  "**/AGENTS.md",
  "**/AGENTS.override.md",
  "**/CLAUDE.md",
  "**/CLAUDE.local.md",
  ".claude/CLAUDE.md",
  ".claude/rules/**/*.md",
  ".claude/skills/**/SKILL.md",
  ".claude/settings*.json",
  ".claude/hooks/**/*",
  ".cursor/rules/**/*.{md,mdc}",
  ".cursor/skills/**/SKILL.md",
  ".cursor/mcp.json",
  ".cursor/hooks.json",
  ".cursorrules",
  ".github/copilot-instructions.md",
  ".github/instructions/**/*.instructions.md",
  ".vscode/mcp.json",
  "**/GEMINI.md",
  ".gemini/skills/**/SKILL.md",
  ".gemini/settings.json",
  ".codex/config.toml",
  ".codex/hooks.json",
  ".mcp.json",
  "context-ray.mcp.json",
] as const;

const IGNORE_PATTERNS = [
  "**/.git/**",
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.next/**",
  "**/.turbo/**",
  "**/.context-ray/**",
];

export interface DiscoveryResult {
  sources: ContextSource[];
  edges: ContextEdge[];
  contents: Map<string, string>;
}

interface AddSourceInput {
  file: TextFile;
  kind: SourceKind;
  status: SourceStatus;
  observability: Observability;
  confidence: Confidence;
  reason: string;
  content?: string;
  order?: number;
  patterns?: string[];
  label?: string;
  serverName?: string;
  toolName?: string;
  tokenOverride?: number;
  metadata?: Record<string, string | number | boolean | string[]>;
}

interface AdapterContext {
  options: ScanOptions;
  root: string;
  targetRelative: string;
  directories: string[];
  filesByPath: Map<string, TextFile>;
  sources: ContextSource[];
  edges: ContextEdge[];
  contents: Map<string, string>;
  sourceByPath: Map<string, ContextSource>;
  addSource(input: AddSourceInput): ContextSource;
}

function relevanceLabel(score: number, alwaysLoaded = false): Relevance {
  if (score >= 0.5) return "high";
  if (score >= 0.15 || alwaysLoaded) return "medium";
  return "low";
}

async function readDiscoveredFiles(root: string, maxBytes: number): Promise<Map<string, TextFile>> {
  const relativePaths = await fg([...DISCOVERY_PATTERNS], {
    cwd: root,
    dot: true,
    onlyFiles: true,
    unique: true,
    followSymbolicLinks: false,
    ignore: IGNORE_PATTERNS,
  });
  const files = new Map<string, TextFile>();
  await Promise.all(
    relativePaths.map(async (relativePath) => {
      const file = await readTextWithinRoot(root, path.join(root, relativePath), maxBytes);
      if (file) files.set(toPosix(relativePath), file);
    }),
  );
  return files;
}

async function addExplicitSnapshots(
  root: string,
  files: Map<string, TextFile>,
  paths: string[],
  maxBytes: number,
): Promise<void> {
  await Promise.all(
    paths.map(async (snapshotPath) => {
      const file = await readTextWithinRoot(root, path.resolve(root, snapshotPath), maxBytes);
      if (file) files.set(file.relativePath, file);
    }),
  );
}

function createContext(
  options: ScanOptions,
  root: string,
  targetRelative: string,
  directories: string[],
  filesByPath: Map<string, TextFile>,
): AdapterContext {
  const sources: ContextSource[] = [];
  const edges: ContextEdge[] = [];
  const contents = new Map<string, string>();
  const sourceByPath = new Map<string, ContextSource>();

  const context: AdapterContext = {
    options,
    root,
    targetRelative,
    directories,
    filesByPath,
    sources,
    edges,
    contents,
    sourceByPath,
    addSource(input) {
      const existing = sourceByPath.get(input.file.relativePath);
      if (existing) {
        if (input.status === "active" && existing.status !== "active") {
          existing.status = "active";
          existing.reason = input.reason;
          existing.observability = input.observability;
          existing.confidence = input.confidence;
          const effectiveContent = input.content ?? input.file.content;
          existing.tokenEstimate = input.tokenOverride ?? estimateTokens(effectiveContent);
          contents.set(existing.id, effectiveContent);
        }
        return existing;
      }

      const effectiveContent = input.content ?? input.file.content;
      const score = relevanceFor(
        effectiveContent,
        input.file.relativePath,
        targetRelative,
        options.task,
      );
      const source: ContextSource = {
        id: sourceId(options.agent, input.kind, input.file.relativePath, input.toolName ?? ""),
        label: input.label ?? path.basename(input.file.relativePath),
        path: input.file.relativePath,
        kind: input.kind,
        agent: options.agent,
        status: input.file.truncated && input.status === "active" ? "truncated" : input.status,
        observability: input.observability,
        confidence: input.confidence,
        reason: input.file.symlink
          ? `${input.reason}; symlink resolved inside repository`
          : input.reason,
        tokenEstimate: input.tokenOverride ?? estimateTokens(effectiveContent),
        bytes: input.file.bytes,
        lines: input.file.lines,
        contentHash: input.file.contentHash,
        relevance: relevanceLabel(score, input.status === "active"),
        ...(input.order === undefined ? {} : { order: input.order }),
        ...(input.patterns ? { patterns: input.patterns } : {}),
        ...(input.serverName ? { serverName: input.serverName } : {}),
        ...(input.toolName ? { toolName: input.toolName } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
      };
      sources.push(source);
      sourceByPath.set(input.file.relativePath, source);
      contents.set(source.id, effectiveContent);
      return source;
    },
  };
  return context;
}

function relativeFromRoot(root: string, absolute: string): string {
  return toPosix(path.relative(root, absolute));
}

function addShadowedSiblings(
  context: AdapterContext,
  directory: string,
  selectedPath: string,
  candidateNames: string[],
): void {
  const directoryRelative = relativeFromRoot(context.root, directory);
  for (const name of candidateNames) {
    const candidate = toPosix(path.join(directoryRelative, name)).replace(/^\.\//, "");
    if (candidate === selectedPath) continue;
    const file = context.filesByPath.get(candidate);
    if (!file) continue;
    const selected = context.sourceByPath.get(selectedPath);
    const shadowed = context.addSource({
      file,
      kind: "instruction",
      status: "shadowed",
      observability: "observed",
      confidence: "high",
      reason: `${selectedPath} has higher filename precedence in the same directory`,
    });
    if (selected) {
      context.edges.push({
        from: selected.id,
        to: shadowed.id,
        kind: "overrides",
        reason: "Only the first non-empty instruction file in a directory is loaded",
      });
    }
  }
}

function parseCodexConfig(file?: TextFile): { fallbackNames: string[]; maxBytes: number } {
  if (!file) return { fallbackNames: [], maxBytes: 32 * 1024 };
  try {
    const parsed = TOML.parse(file.content) as Record<string, unknown>;
    const fallbackNames = stringArray(parsed.project_doc_fallback_filenames);
    const configuredMax = parsed.project_doc_max_bytes;
    return {
      fallbackNames,
      maxBytes:
        typeof configuredMax === "number" && Number.isFinite(configuredMax)
          ? Math.max(1, configuredMax)
          : 32 * 1024,
    };
  } catch {
    return { fallbackNames: [], maxBytes: 32 * 1024 };
  }
}

function applyCodexAdapter(context: AdapterContext): void {
  const config = context.filesByPath.get(".codex/config.toml");
  if (config) {
    context.addSource({
      file: config,
      kind: "config",
      status: "active",
      observability: "observed",
      confidence: "high",
      reason: "Trusted project-scoped Codex configuration",
      tokenOverride: 0,
    });
  }

  const { fallbackNames, maxBytes } = parseCodexConfig(config);
  const candidateNames = ["AGENTS.override.md", "AGENTS.md", ...fallbackNames];
  let consumedBytes = 0;
  let previous: ContextSource | undefined;
  let order = 0;

  for (const directory of context.directories) {
    const directoryRelative = relativeFromRoot(context.root, directory);
    const selectedPath = candidateNames
      .map((name) => toPosix(path.join(directoryRelative, name)).replace(/^\.\//, ""))
      .find((candidate) => context.filesByPath.get(candidate)?.content.trim());
    if (!selectedPath) continue;
    const file = context.filesByPath.get(selectedPath);
    if (!file) continue;
    const remainingBytes = Math.max(0, maxBytes - consumedBytes);
    const loadedContent = Buffer.from(file.content).subarray(0, remainingBytes).toString("utf8");
    const isTruncated = Buffer.byteLength(file.content) > remainingBytes;
    const source = context.addSource({
      file,
      kind: "instruction",
      status: isTruncated ? "truncated" : "active",
      observability: "observed",
      confidence: "high",
      reason: `Codex instruction chain from project root to target; ${path.basename(selectedPath)} selected`,
      content: loadedContent,
      order,
      metadata: { loadedBytes: Buffer.byteLength(loadedContent), configuredMaxBytes: maxBytes },
    });
    if (previous) {
      context.edges.push({
        from: previous.id,
        to: source.id,
        kind: "loads",
        reason: "Later, deeper guidance appears later in the combined prompt",
      });
    }
    previous = source;
    order += 1;
    consumedBytes += Buffer.byteLength(loadedContent);
    addShadowedSiblings(context, directory, selectedPath, candidateNames);
    if (consumedBytes >= maxBytes) break;
  }
}

async function addClaudeImports(
  context: AdapterContext,
  parent: ContextSource,
  content: string,
  baseDirectory: string,
  depth = 0,
  seen = new Set<string>(),
): Promise<void> {
  if (depth >= 5) return;
  const importPattern = /(?:^|\s)@((?:\.{0,2}\/)[^\s)`]+|[^\s)`]+\.(?:md|txt|json|toml|ya?ml))/gm;
  for (const match of content.matchAll(importPattern)) {
    const reference = match[1];
    if (!reference || reference.startsWith("http://") || reference.startsWith("https://")) continue;
    const relative = toPosix(path.normalize(path.join(baseDirectory, reference))).replace(
      /^\.\//,
      "",
    );
    if (seen.has(relative)) continue;
    seen.add(relative);
    let file = context.filesByPath.get(relative);
    if (!file) {
      file =
        (await readTextWithinRoot(
          context.root,
          path.resolve(context.root, relative),
          context.options.maxFileBytes ?? 512_000,
        )) ?? undefined;
      if (file) context.filesByPath.set(relative, file);
    }
    if (!file) continue;
    const imported = context.addSource({
      file,
      kind: "referenced-file",
      status: "active",
      observability: "observed",
      confidence: "high",
      reason: `Imported by ${parent.path}`,
    });
    context.edges.push({
      from: parent.id,
      to: imported.id,
      kind: "imports",
      reason: `@ import resolved relative to ${baseDirectory || "."}`,
    });
    await addClaudeImports(
      context,
      imported,
      file.content,
      path.dirname(relative),
      depth + 1,
      seen,
    );
  }
}

async function applyClaudeAdapter(context: AdapterContext): Promise<void> {
  let order = 0;
  const paths: string[] = [];
  for (const directory of context.directories) {
    const directoryRelative = relativeFromRoot(context.root, directory);
    for (const name of ["CLAUDE.md", "CLAUDE.local.md"]) {
      paths.push(toPosix(path.join(directoryRelative, name)).replace(/^\.\//, ""));
    }
  }
  paths.splice(1, 0, ".claude/CLAUDE.md");

  for (const relative of [...new Set(paths)]) {
    const file = context.filesByPath.get(relative);
    if (!file) continue;
    const source = context.addSource({
      file,
      kind: "instruction",
      status: "active",
      observability: "observed",
      confidence: "high",
      reason: "Claude Code project memory loaded for the launch-to-target directory chain",
      order,
    });
    order += 1;
    await addClaudeImports(context, source, file.content, path.dirname(relative));
  }

  for (const [relative, file] of context.filesByPath) {
    if (relative.startsWith(".claude/rules/") && relative.endsWith(".md")) {
      const { data } = parseFrontMatter(file.content);
      const patterns = stringArray(data.paths);
      const active = patterns.length === 0 || matchesAny(context.targetRelative, patterns);
      context.addSource({
        file,
        kind: "instruction",
        status: active ? "active" : "conditional",
        observability: "observed",
        confidence: "high",
        reason: active
          ? patterns.length === 0
            ? "Claude rule without paths frontmatter loads every session"
            : "Claude rule path pattern matches the selected target"
          : "Claude rule is path-scoped and does not match the selected target",
        patterns,
        order: order++,
      });
    }
    if (relative.startsWith(".claude/skills/") && relative.endsWith("/SKILL.md")) {
      context.addSource({
        file,
        kind: "skill",
        status: "on-demand",
        observability: "observed",
        confidence: "medium",
        reason:
          "Skill metadata is discoverable; full content is loaded only when invoked or selected",
      });
    }
  }
}

function applyCursorAdapter(context: AdapterContext): void {
  let order = 0;
  for (const relative of ["AGENTS.md", "CLAUDE.md", ".cursorrules"]) {
    const file = context.filesByPath.get(relative);
    if (!file) continue;
    context.addSource({
      file,
      kind: "instruction",
      status: "active",
      observability: "observed",
      confidence: relative === ".cursorrules" ? "medium" : "high",
      reason:
        relative === ".cursorrules"
          ? "Legacy Cursor project rule"
          : "Cursor project-level compatibility rule loaded by the current CLI/editor surface",
      order: order++,
    });
  }

  for (const [relative, file] of context.filesByPath) {
    if (relative.startsWith(".cursor/rules/") && /\.(?:md|mdc)$/.test(relative)) {
      const { data } = parseFrontMatter(file.content);
      const patterns = stringArray(data.globs);
      const alwaysApply = data.alwaysApply === true;
      const active =
        alwaysApply || (patterns.length > 0 && matchesAny(context.targetRelative, patterns));
      const agentRequested =
        !alwaysApply && patterns.length === 0 && typeof data.description === "string";
      context.addSource({
        file,
        kind: "instruction",
        status: active ? "active" : "conditional",
        observability: agentRequested ? "inferred" : "observed",
        confidence: agentRequested ? "medium" : "high",
        reason: active
          ? alwaysApply
            ? "Cursor rule declares alwaysApply"
            : "Cursor rule glob matches the selected target"
          : agentRequested
            ? "Agent-requested rule may load when its description matches the task"
            : "Cursor rule glob does not match the selected target",
        patterns,
        order: order++,
      });
    }
    if (relative.startsWith(".cursor/skills/") && relative.endsWith("/SKILL.md")) {
      context.addSource({
        file,
        kind: "skill",
        status: "on-demand",
        observability: "observed",
        confidence: "medium",
        reason: "Cursor skill is available for on-demand activation",
      });
    }
  }
}

function applyCopilotAdapter(context: AdapterContext): void {
  let order = 0;
  for (const relative of [".github/copilot-instructions.md", "AGENTS.md"]) {
    const file = context.filesByPath.get(relative);
    if (!file) continue;
    context.addSource({
      file,
      kind: "instruction",
      status: "active",
      observability: "observed",
      confidence: "high",
      reason: "Repository-wide instruction supported by Copilot IDE and CLI surfaces",
      order: order++,
    });
  }
  for (const relative of ["CLAUDE.md", "GEMINI.md"]) {
    const file = context.filesByPath.get(relative);
    if (!file) continue;
    context.addSource({
      file,
      kind: "instruction",
      status: "conditional",
      observability: "inferred",
      confidence: "medium",
      reason:
        "Supported by some Copilot agent surfaces but not uniformly loaded by every IDE surface",
      order: order++,
    });
  }
  for (const [relative, file] of context.filesByPath) {
    if (!relative.startsWith(".github/instructions/") || !relative.endsWith(".instructions.md")) {
      continue;
    }
    const { data } = parseFrontMatter(file.content);
    const patterns = stringArray(data.applyTo);
    const active = patterns.length > 0 && matchesAny(context.targetRelative, patterns);
    context.addSource({
      file,
      kind: "instruction",
      status: active ? "active" : "conditional",
      observability: "observed",
      confidence: "high",
      reason: active
        ? "Copilot applyTo pattern matches the selected target"
        : "Copilot path-specific instruction does not match the selected target",
      patterns,
      order: order++,
    });
  }
}

function geminiContextNames(file?: TextFile): string[] {
  if (!file) return ["GEMINI.md"];
  try {
    const parsed = JSON.parse(file.content) as { context?: { fileName?: unknown } };
    const configured = stringArray(parsed.context?.fileName);
    return configured.length > 0 ? configured : ["GEMINI.md"];
  } catch {
    return ["GEMINI.md"];
  }
}

async function applyGeminiAdapter(context: AdapterContext): Promise<void> {
  const settings = context.filesByPath.get(".gemini/settings.json");
  const names = geminiContextNames(settings);
  if (settings) {
    context.addSource({
      file: settings,
      kind: "config",
      status: "active",
      observability: "observed",
      confidence: "high",
      reason: "Gemini CLI project settings",
      tokenOverride: 0,
    });
  }
  let order = 0;
  for (const directory of context.directories) {
    const directoryRelative = relativeFromRoot(context.root, directory);
    for (const name of names) {
      const relative = toPosix(path.join(directoryRelative, name)).replace(/^\.\//, "");
      const file = context.filesByPath.get(relative);
      if (!file) continue;
      const source = context.addSource({
        file,
        kind: "instruction",
        status: "active",
        observability: "observed",
        confidence: "high",
        reason: "Gemini hierarchical memory for the selected workspace and target path",
        order: order++,
      });
      await addClaudeImports(context, source, file.content, path.dirname(relative));
    }
  }
  for (const [relative, file] of context.filesByPath) {
    if (relative.startsWith(".gemini/skills/") && relative.endsWith("/SKILL.md")) {
      context.addSource({
        file,
        kind: "skill",
        status: "on-demand",
        observability: "observed",
        confidence: "medium",
        reason: "Gemini skill can be activated on demand",
      });
    }
  }
}

function parseStructuredFile(file: TextFile): Record<string, unknown> | null {
  try {
    const parsed = file.relativePath.endsWith(".toml")
      ? TOML.parse(file.content)
      : /\.ya?ml$/.test(file.relativePath)
        ? parseYaml(file.content)
        : JSON.parse(file.content);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function candidateServers(
  parsed: Record<string, unknown>,
): Array<[string, Record<string, unknown>]> {
  const containers = [parsed.mcpServers, parsed.mcp_servers, parsed.servers];
  for (const container of containers) {
    if (typeof container === "object" && container !== null && !Array.isArray(container)) {
      return Object.entries(container).filter(
        (entry): entry is [string, Record<string, unknown>] =>
          typeof entry[1] === "object" && entry[1] !== null && !Array.isArray(entry[1]),
      );
    }
    if (Array.isArray(container)) {
      return container
        .filter(
          (item): item is Record<string, unknown> => typeof item === "object" && item !== null,
        )
        .map((item, index) => [String(item.name ?? `server-${index + 1}`), item]);
    }
  }
  return [];
}

function addMcpSources(context: AdapterContext): void {
  const agentConfigs: Record<AgentId, string[]> = {
    codex: [".codex/config.toml"],
    claude: [".mcp.json", ".claude/settings.json", ".claude/settings.local.json"],
    cursor: [".cursor/mcp.json"],
    copilot: [".vscode/mcp.json"],
    gemini: [".gemini/settings.json"],
  };
  const paths = [
    ...agentConfigs[context.options.agent],
    "context-ray.mcp.json",
    ...(context.options.mcpSnapshotPaths ?? []).map((snapshotPath) =>
      toPosix(path.relative(context.root, path.resolve(context.root, snapshotPath))),
    ),
  ];
  for (const relative of paths) {
    const file = context.filesByPath.get(relative);
    if (!file) continue;
    const parsed = parseStructuredFile(file);
    if (!parsed) continue;
    const configSource = context.addSource({
      file,
      kind: "mcp-config",
      status: "active",
      observability: "observed",
      confidence: "high",
      reason: "MCP server declaration discovered without executing repository commands",
      tokenOverride: 0,
    });
    for (const [name, definition] of candidateServers(parsed)) {
      const serverContent = JSON.stringify(definition);
      const serverFile: TextFile = {
        ...file,
        relativePath: `${relative}#${name}`,
        content: serverContent,
        bytes: Buffer.byteLength(serverContent),
        lines: 1,
        contentHash: file.contentHash,
        truncated: false,
        symlink: false,
      };
      const metadata: Record<string, string | number | boolean | string[]> = {};
      if (typeof definition.command === "string") metadata.command = definition.command;
      if (Array.isArray(definition.args))
        metadata.args = definition.args.filter((arg): arg is string => typeof arg === "string");
      if (typeof definition.url === "string") metadata.url = definition.url;
      const server = context.addSource({
        file: serverFile,
        kind: "mcp-server",
        status: "conditional",
        observability: "observed",
        confidence: "high",
        reason: "Server is declared; live availability and exposed tools require an explicit probe",
        label: name,
        serverName: name,
        tokenOverride: 0,
        metadata,
      });
      context.edges.push({
        from: configSource.id,
        to: server.id,
        kind: "declares",
        reason: `${relative} declares MCP server ${name}`,
      });
      const tools = Array.isArray(definition.tools) ? definition.tools : [];
      for (const item of tools) {
        if (typeof item !== "object" || item === null) continue;
        const tool = item as Record<string, unknown>;
        const toolName = typeof tool.name === "string" ? tool.name : "unnamed-tool";
        const toolContent = JSON.stringify(tool);
        const toolFile: TextFile = {
          ...file,
          relativePath: `${relative}#${name}/${toolName}`,
          content: toolContent,
          bytes: Buffer.byteLength(toolContent),
          lines: 1,
          contentHash: file.contentHash,
          truncated: false,
          symlink: false,
        };
        const toolSource = context.addSource({
          file: toolFile,
          kind: "mcp-tool",
          status: "active",
          observability: "observed",
          confidence: "high",
          reason: "Tool schema imported from a local Context Ray snapshot",
          label: toolName,
          serverName: name,
          toolName,
        });
        context.edges.push({
          from: server.id,
          to: toolSource.id,
          kind: "declares",
          reason: `${name} exposes ${toolName}`,
        });
      }
    }
  }
}

function addHookSources(context: AdapterContext): void {
  for (const [relative, file] of context.filesByPath) {
    if (!relative.includes("hook")) continue;
    context.addSource({
      file,
      kind: "hook",
      status: "conditional",
      observability: "observed",
      confidence: "medium",
      reason:
        "Hook configuration or script may inject context or execute at an agent lifecycle event",
      tokenOverride: 0,
    });
  }
}

export async function discoverContext(options: ScanOptions): Promise<DiscoveryResult> {
  const root = path.resolve(options.root);
  const targetDirectory = await resolveTargetDirectory(root, options.target);
  const targetRelative =
    toPosix(path.relative(root, path.resolve(root, options.target ?? "."))) || ".";
  const directories = directoriesBetween(root, targetDirectory);
  const filesByPath = await readDiscoveredFiles(root, options.maxFileBytes ?? 512_000);
  await addExplicitSnapshots(
    root,
    filesByPath,
    options.mcpSnapshotPaths ?? [],
    options.maxFileBytes ?? 512_000,
  );
  const context = createContext(options, root, targetRelative, directories, filesByPath);

  const adapters: Record<AgentId, (adapterContext: AdapterContext) => void | Promise<void>> = {
    codex: applyCodexAdapter,
    claude: applyClaudeAdapter,
    cursor: applyCursorAdapter,
    copilot: applyCopilotAdapter,
    gemini: applyGeminiAdapter,
  };
  await adapters[options.agent](context);
  addMcpSources(context);
  addHookSources(context);

  return { sources: context.sources, edges: context.edges, contents: context.contents };
}
