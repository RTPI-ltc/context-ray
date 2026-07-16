import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import * as vscode from "vscode";
import { analyzeContext, projectLoadMode, readTextWithinRoot } from "@context-ray/core";
import type {
  AgentId,
  ContextSource,
  DashboardRuntime,
  Finding,
  LoadMode,
  ScanReport,
} from "@context-ray/schema";
import {
  formatJson,
  formatMarkdown,
  formatSarif,
  formatTerminal,
  renderHtml,
} from "@context-ray/reporters";
import { createDebouncedTrigger, LatestRequestGate } from "./scan-coordinator.js";

const AGENTS: AgentId[] = ["codex", "claude", "cursor", "copilot", "gemini"];
const MAX_PREVIEW_BYTES = 128 * 1024;
const SCAN_ON_SAVE_DEBOUNCE_MS = 300;

interface ResolvedScanInput {
  root: string;
  agent: AgentId;
  target: string;
  task?: string;
}

class ScanSupersededError extends Error {
  constructor() {
    super("Scan superseded by a newer request.");
    this.name = "ScanSupersededError";
  }
}

class ReportState {
  report: ScanReport | undefined;
  readonly emitter = new vscode.EventEmitter<void>();

  update(report: ScanReport): void {
    this.report = report;
    this.emitter.fire();
  }
}

function cleanRepositoryPath(value: string): string {
  return value.split("#", 1)[0]?.replace(/^\/+/, "") ?? "";
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function repositoryUri(root: string, value: string): vscode.Uri | undefined {
  const cleanPath = cleanRepositoryPath(value);
  if (!cleanPath) return undefined;
  const candidate = path.resolve(root, cleanPath);
  return isInside(root, candidate) ? vscode.Uri.file(candidate) : undefined;
}

class FindingProvider implements vscode.TreeDataProvider<Finding> {
  readonly onDidChangeTreeData: vscode.Event<void>;

  constructor(private readonly state: ReportState) {
    this.onDidChangeTreeData = state.emitter.event;
  }

  getTreeItem(finding: Finding): vscode.TreeItem {
    const item = new vscode.TreeItem(finding.title, vscode.TreeItemCollapsibleState.None);
    item.description = finding.evidence[0]?.path ?? finding.ruleId;
    item.tooltip = new vscode.MarkdownString(
      `**${finding.ruleId}**\n\n${finding.message}\n\n${finding.recommendation}`,
    );
    item.iconPath = new vscode.ThemeIcon(
      finding.severity === "error" ? "error" : finding.severity === "warning" ? "warning" : "info",
    );
    const evidence = finding.evidence[0];
    const uri = evidence
      ? repositoryUri(this.state.report?.scan.root ?? "", evidence.path)
      : undefined;
    if (uri) {
      item.command = {
        command: "vscode.open",
        title: "Open evidence",
        arguments: [
          uri,
          {
            selection: new vscode.Range(
              Math.max(0, (evidence?.line ?? 1) - 1),
              0,
              Math.max(0, (evidence?.line ?? 1) - 1),
              0,
            ),
          },
        ],
      };
    }
    return item;
  }

  getChildren(): Finding[] {
    return this.state.report?.findings ?? [];
  }
}

class SourceProvider implements vscode.TreeDataProvider<ContextSource> {
  readonly onDidChangeTreeData: vscode.Event<void>;

  constructor(private readonly state: ReportState) {
    this.onDidChangeTreeData = state.emitter.event;
  }

  getTreeItem(source: ContextSource): vscode.TreeItem {
    const item = new vscode.TreeItem(source.label, vscode.TreeItemCollapsibleState.None);
    item.description = `${source.status} · ${source.tokenEstimate.toLocaleString()} tokens`;
    item.tooltip = `${source.reason}\n${source.path}`;
    item.iconPath = new vscode.ThemeIcon(
      source.kind === "mcp-tool" ? "tools" : source.kind === "skill" ? "sparkle" : "file-text",
    );
    const uri = repositoryUri(this.state.report?.scan.root ?? "", source.path);
    if (uri) {
      item.command = {
        command: "vscode.open",
        title: "Open source",
        arguments: [uri],
      };
    }
    return item;
  }

  getChildren(): ContextSource[] {
    return [...(this.state.report?.sources ?? [])].sort(
      (left, right) => right.tokenEstimate - left.tokenEstimate,
    );
  }
}

function configuredAgent(): AgentId {
  return vscode.workspace.getConfiguration("contextRay").get<AgentId>("agent", "codex");
}

function activeWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  return (
    (activeUri ? vscode.workspace.getWorkspaceFolder(activeUri) : undefined) ??
    vscode.workspace.workspaceFolders?.[0]
  );
}

function activeTarget(root: string): string {
  const file = vscode.window.activeTextEditor?.document.uri.fsPath;
  if (!file || !isInside(root, file)) return ".";
  return path.relative(root, file).replaceAll(path.sep, "/") || ".";
}

async function validatedTarget(
  root: string,
  requested: unknown,
  fallback: string,
): Promise<string> {
  const value = typeof requested === "string" && requested.trim() ? requested.trim() : fallback;
  const absolute = path.resolve(root, value);
  if (!isInside(root, absolute)) throw new Error("Target must stay inside the workspace.");
  await stat(absolute);
  return path.relative(root, absolute).replaceAll(path.sep, "/") || ".";
}

function targetsFor(report: ScanReport): string[] {
  const targets = new Set<string>([".", report.scan.target]);
  for (const source of report.sources) {
    const cleanPath = cleanRepositoryPath(source.path);
    if (!cleanPath) continue;
    const directory = path.posix.dirname(cleanPath.replaceAll(path.sep, "/"));
    if (directory !== ".") targets.add(directory);
  }
  return [...targets].sort((left, right) => left.localeCompare(right));
}

function dashboardRuntime(report: ScanReport): DashboardRuntime {
  return {
    mode: "vscode",
    root: report.scan.root,
    repoLabel: path.basename(report.scan.root),
    agents: AGENTS,
    targets: targetsFor(report),
    supports: { scan: true, projection: true, sourcePreview: true, export: true },
  };
}

function updateDiagnostics(report: ScanReport, collection: vscode.DiagnosticCollection): void {
  collection.clear();
  const diagnostics = new Map<string, vscode.Diagnostic[]>();
  for (const finding of report.findings) {
    for (const evidence of finding.evidence) {
      const uri = repositoryUri(report.scan.root, evidence.path);
      if (!uri) continue;
      const line = Math.max(0, (evidence.line ?? 1) - 1);
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(line, 0, line, 240),
        finding.message,
        finding.severity === "error"
          ? vscode.DiagnosticSeverity.Error
          : finding.severity === "warning"
            ? vscode.DiagnosticSeverity.Warning
            : vscode.DiagnosticSeverity.Information,
      );
      diagnostic.code = finding.ruleId;
      diagnostic.source = "Context Ray";
      diagnostics.set(uri.toString(), [...(diagnostics.get(uri.toString()) ?? []), diagnostic]);
    }
  }
  for (const [uri, items] of diagnostics) collection.set(vscode.Uri.parse(uri), items);
}

async function sourcePreview(report: ScanReport, sourceId: string) {
  const source = report.sources.find((item) => item.id === sourceId);
  if (!source) throw new Error("Source is not part of the active report.");
  const cleanPath = cleanRepositoryPath(source.path);
  if (!cleanPath) throw new Error("This source has no readable repository file.");
  const resolvedRoot = await realpath(report.scan.root);
  const candidate = path.resolve(resolvedRoot, cleanPath);
  if (!isInside(resolvedRoot, candidate)) throw new Error("Source must stay inside the workspace.");
  const resolved = await realpath(candidate);
  if (!isInside(resolvedRoot, resolved)) throw new Error("Source symlink escapes the workspace.");
  const file = await readTextWithinRoot(resolvedRoot, resolved, MAX_PREVIEW_BYTES);
  if (!file) throw new Error("Source file is not readable.");
  const content = file.content;
  const lines = content.split(/\r?\n/);
  const evidenceLine = report.findings
    .flatMap((finding) => finding.evidence)
    .find((evidence) => evidence.sourceId === source.id)?.line;
  const evidenceOutsidePreview =
    evidenceLine !== undefined && file.truncated && evidenceLine > lines.length;
  const startLine = Math.max(1, (evidenceOutsidePreview ? 1 : (evidenceLine ?? 1)) - 8);
  const endLine = Math.min(lines.length, startLine + 79);
  return {
    reportId: report.scan.id,
    sourceId,
    path: cleanPath,
    startLine,
    endLine,
    truncated: file.truncated || endLine < lines.length,
    ...(evidenceOutsidePreview
      ? {
          note: `Evidence at line ${evidenceLine} is outside the bounded preview; showing the file start.`,
        }
      : {}),
    content: lines.slice(startLine - 1, endLine).join("\n"),
  };
}

function exportContent(
  report: ScanReport,
  template: string,
  format: string,
): { content: string; extension: string } {
  if (format === "json") return { content: formatJson(report), extension: "json" };
  if (format === "sarif") return { content: formatSarif(report), extension: "sarif" };
  if (format === "markdown") return { content: formatMarkdown(report), extension: "md" };
  if (format === "html") return { content: renderHtml(report, template), extension: "html" };
  throw new Error("Unsupported export format.");
}

export function activate(context: vscode.ExtensionContext): void {
  const state = new ReportState();
  const output = vscode.window.createOutputChannel("Context Ray");
  const diagnostics = vscode.languages.createDiagnosticCollection("context-ray");
  const scanGate = new LatestRequestGate();
  let reportPanel: vscode.WebviewPanel | undefined;
  let reportPanelDisposables: vscode.Disposable[] = [];
  let cancelPendingRescan = (): void => undefined;
  let scheduleQueuedRescan = (): void => undefined;
  let scansInFlight = 0;
  let automaticRescanQueued = false;
  let latestScanInput: ResolvedScanInput | undefined;

  const clearPanelSubscriptions = (): void => {
    const subscriptions = reportPanelDisposables.splice(0);
    for (const subscription of subscriptions) subscription.dispose();
  };

  const publishReportToPanel = (report: ScanReport): void => {
    const panel = reportPanel;
    if (!panel) return;
    panel.title = `Context Ray · ${report.scan.agent}`;
    void panel.webview
      .postMessage({
        type: "context-ray/report",
        payload: report,
        runtime: dashboardRuntime(report),
      })
      .then(undefined, () => undefined);
  };

  const commitReport = (report: ScanReport): void => {
    state.update(report);
    updateDiagnostics(report, diagnostics);
    output.clear();
    output.append(formatTerminal(report, { color: false }));
    publishReportToPanel(report);
  };

  context.subscriptions.push(
    output,
    diagnostics,
    state.emitter,
    vscode.window.registerTreeDataProvider("contextRay.findings", new FindingProvider(state)),
    vscode.window.registerTreeDataProvider("contextRay.sources", new SourceProvider(state)),
    {
      dispose(): void {
        const panel = reportPanel;
        reportPanel = undefined;
        clearPanelSubscriptions();
        panel?.dispose();
      },
    },
  );

  const executeScan = async (
    input: { root?: string; agent?: unknown; target?: unknown; task?: unknown } = {},
    notify = true,
  ): Promise<ScanReport> => {
    const root = input.root ?? activeWorkspaceFolder()?.uri.fsPath;
    if (!root) throw new Error("Open a workspace before running Context Ray.");
    const agent = typeof input.agent === "string" ? input.agent : configuredAgent();
    if (!AGENTS.includes(agent as AgentId)) throw new Error("Unsupported agent.");
    const generation = scanGate.begin();
    scansInFlight += 1;
    try {
      const target = await validatedTarget(root, input.target, activeTarget(root));
      if (!scanGate.isCurrent(generation)) throw new ScanSupersededError();
      const task = typeof input.task === "string" ? input.task.trim().slice(0, 2_000) : "";
      const resolvedInput: ResolvedScanInput = {
        root,
        agent: agent as AgentId,
        target,
        ...(task ? { task } : {}),
      };
      latestScanInput = resolvedInput;
      return await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title: "Context Ray: analyzing effective context",
        },
        async () => {
          const report = await analyzeContext(resolvedInput);
          if (!scanGate.isCurrent(generation)) throw new ScanSupersededError();
          commitReport(report);
          if (notify) {
            void vscode.window.showInformationMessage(
              `Context Ray: ${report.summary.effectiveTokens.toLocaleString()} tokens, ${report.findings.length} findings`,
            );
          }
          return report;
        },
      );
    } finally {
      scansInFlight -= 1;
      if (scansInFlight === 0 && automaticRescanQueued) {
        automaticRescanQueued = false;
        scheduleQueuedRescan();
      }
    }
  };

  const scan = async (
    notify = true,
    input: { root?: string; agent?: unknown; target?: unknown; task?: unknown } = {},
  ): Promise<ScanReport | undefined> => {
    try {
      return await executeScan(input, notify);
    } catch (error) {
      if (error instanceof ScanSupersededError) return undefined;
      const message = error instanceof Error ? error.message : String(error);
      output.appendLine(message);
      if (notify) void vscode.window.showErrorMessage(`Context Ray scan failed: ${message}`);
      return undefined;
    }
  };

  const requireActiveReport = (reportId: unknown): ScanReport => {
    const report = state.report;
    if (!report) throw new Error("No active report.");
    if (reportId !== report.scan.id) throw new Error("Report is no longer active.");
    return report;
  };

  const handlePanelMessage = async (
    panel: vscode.WebviewPanel,
    template: string,
    message: Record<string, unknown>,
  ): Promise<void> => {
    if (message.type === "context-ray/ready") {
      if (reportPanel === panel && state.report) publishReportToPanel(state.report);
      return;
    }
    const requestId = typeof message.requestId === "string" ? message.requestId : undefined;
    if (!requestId || typeof message.type !== "string") return;
    const reply = async (payload?: unknown, error?: string): Promise<void> => {
      await panel.webview.postMessage({
        type: "context-ray/response",
        requestId,
        ...(error ? { error } : { payload }),
      });
    };

    try {
      if (message.type === "context-ray/scan") {
        cancelPendingRescan();
        const activeReport = state.report;
        if (!activeReport) throw new Error("No active report.");
        const input =
          message.input && typeof message.input === "object"
            ? (message.input as Record<string, unknown>)
            : {};
        const next = await executeScan(
          {
            root: activeReport.scan.root,
            agent: input.agent,
            target: input.target,
            task: input.task,
          },
          false,
        );
        await reply(next);
        return;
      }
      if (message.type === "context-ray/project") {
        const input =
          message.input && typeof message.input === "object"
            ? (message.input as Record<string, unknown>)
            : {};
        const activeReport = requireActiveReport(input.reportId);
        if (typeof input.sourceId !== "string") throw new Error("sourceId is required.");
        if (input.mode !== "eager" && input.mode !== "progressive" && input.mode !== "on-demand") {
          throw new Error("Unsupported load mode.");
        }
        await reply(projectLoadMode(activeReport, input.sourceId, input.mode as LoadMode));
        return;
      }
      if (message.type === "context-ray/source-preview") {
        const activeReport = requireActiveReport(message.reportId);
        if (typeof message.sourceId !== "string") throw new Error("sourceId is required.");
        const preview = await sourcePreview(activeReport, message.sourceId);
        requireActiveReport(activeReport.scan.id);
        await reply(preview);
        return;
      }
      if (message.type === "context-ray/export") {
        const activeReport = requireActiveReport(message.reportId);
        const format = typeof message.format === "string" ? message.format : "json";
        const exported = exportContent(activeReport, template, format);
        const destination = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(
            path.join(activeReport.scan.root, `context-ray-report.${exported.extension}`),
          ),
          saveLabel: "Export Context Ray report",
        });
        if (!destination) {
          await reply({ saved: false });
          return;
        }
        requireActiveReport(activeReport.scan.id);
        await vscode.workspace.fs.writeFile(destination, Buffer.from(exported.content, "utf8"));
        await reply({ saved: true, fileName: path.basename(destination.fsPath) });
        return;
      }
      throw new Error("Unsupported Dashboard request.");
    } catch (error) {
      await reply(undefined, error instanceof Error ? error.message : String(error));
    }
  };

  const openReport = async (): Promise<void> => {
    let report = state.report;
    if (!report) {
      cancelPendingRescan();
      report = await scan(false);
    }
    if (!report) return;
    if (reportPanel) {
      reportPanel.reveal(vscode.ViewColumn.Beside);
      publishReportToPanel(state.report ?? report);
      return;
    }

    let createdPanel: vscode.WebviewPanel | undefined;
    try {
      const template = await readFile(
        vscode.Uri.joinPath(context.extensionUri, "media", "dashboard.html").fsPath,
        "utf8",
      );
      const existingPanel = reportPanel as vscode.WebviewPanel | undefined;
      if (existingPanel) {
        existingPanel.reveal(vscode.ViewColumn.Beside);
        publishReportToPanel(state.report ?? report);
        return;
      }

      const activeReport = state.report ?? report;
      const panel = vscode.window.createWebviewPanel(
        "contextRayReport",
        `Context Ray · ${activeReport.scan.agent}`,
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true },
      );
      createdPanel = panel;
      reportPanel = panel;
      const messageSubscription = panel.webview.onDidReceiveMessage(
        async (message: Record<string, unknown>) => {
          await handlePanelMessage(panel, template, message);
        },
      );
      const disposeSubscription = panel.onDidDispose(() => {
        if (reportPanel !== panel) return;
        reportPanel = undefined;
        clearPanelSubscriptions();
      });
      reportPanelDisposables = [messageSubscription, disposeSubscription];
      panel.webview.html = renderHtml(activeReport, template, dashboardRuntime(activeReport));
    } catch (error) {
      if (createdPanel && reportPanel === createdPanel) {
        reportPanel = undefined;
        clearPanelSubscriptions();
        createdPanel.dispose();
      }
      output.appendLine(error instanceof Error ? error.message : String(error));
      void vscode.window.showErrorMessage(
        "Dashboard asset is missing. Build the workspace before opening the report.",
      );
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("contextRay.scan", async () => {
      cancelPendingRescan();
      await scan(true);
    }),
    vscode.commands.registerCommand("contextRay.openReport", async () => {
      await openReport();
    }),
  );

  const watcher = vscode.workspace.createFileSystemWatcher(
    "**/{AGENTS.md,AGENTS.override.md,CLAUDE.md,CLAUDE.local.md,GEMINI.md,*.mdc,*.instructions.md,SKILL.md,.mcp.json,context-ray.mcp.json,mcp.json,settings.json,settings.local.json,config.toml,hooks.json}",
  );
  const debouncedRescan = createDebouncedTrigger(() => {
    if (vscode.workspace.getConfiguration("contextRay").get("scanOnSave", true)) {
      if (scansInFlight > 0) {
        automaticRescanQueued = true;
        return;
      }
      const activeReport = state.report;
      const input =
        latestScanInput ??
        (activeReport
          ? {
              root: activeReport.scan.root,
              agent: activeReport.scan.agent,
              target: activeReport.scan.target,
              ...(activeReport.scan.task ? { task: activeReport.scan.task } : {}),
            }
          : {});
      void scan(false, input);
    }
  }, SCAN_ON_SAVE_DEBOUNCE_MS);
  scheduleQueuedRescan = () => debouncedRescan.trigger();
  cancelPendingRescan = () => {
    automaticRescanQueued = false;
    debouncedRescan.dispose();
  };
  const scheduleRescan = (): void => {
    if (vscode.workspace.getConfiguration("contextRay").get("scanOnSave", true)) {
      debouncedRescan.trigger();
    }
  };
  watcher.onDidChange(scheduleRescan, undefined, context.subscriptions);
  watcher.onDidCreate(scheduleRescan, undefined, context.subscriptions);
  watcher.onDidDelete(scheduleRescan, undefined, context.subscriptions);
  context.subscriptions.push(watcher, { dispose: () => debouncedRescan.dispose() });
  void scan(false);
}

export function deactivate(): void {}
