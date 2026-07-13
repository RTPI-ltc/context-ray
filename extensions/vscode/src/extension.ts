import { readFile } from "node:fs/promises";
import path from "node:path";
import * as vscode from "vscode";
import { analyzeContext } from "@context-ray/core";
import type { AgentId, ContextSource, Finding, ScanReport } from "@context-ray/schema";
import { formatTerminal, renderHtml } from "@context-ray/reporters";

class ReportState {
  report: ScanReport | undefined;
  readonly emitter = new vscode.EventEmitter<void>();

  update(report: ScanReport): void {
    this.report = report;
    this.emitter.fire();
  }
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
    if (evidence) {
      item.command = {
        command: "vscode.open",
        title: "Open evidence",
        arguments: [vscode.Uri.file(path.join(this.state.report?.scan.root ?? "", evidence.path))],
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
    if (!source.path.includes("#")) {
      item.command = {
        command: "vscode.open",
        title: "Open source",
        arguments: [vscode.Uri.file(path.join(this.state.report?.scan.root ?? "", source.path))],
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

function activeTarget(root: string): string {
  const file = vscode.window.activeTextEditor?.document.uri.fsPath;
  return file && !path.relative(root, file).startsWith("..") ? path.relative(root, file) : ".";
}

function updateDiagnostics(report: ScanReport, collection: vscode.DiagnosticCollection): void {
  collection.clear();
  const diagnostics = new Map<string, vscode.Diagnostic[]>();
  for (const finding of report.findings) {
    for (const evidence of finding.evidence) {
      if (evidence.path.includes("#")) continue;
      const uri = vscode.Uri.file(path.join(report.scan.root, evidence.path));
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

export function activate(context: vscode.ExtensionContext): void {
  const state = new ReportState();
  const output = vscode.window.createOutputChannel("Context Ray");
  const diagnostics = vscode.languages.createDiagnosticCollection("context-ray");
  context.subscriptions.push(
    output,
    diagnostics,
    state.emitter,
    vscode.window.registerTreeDataProvider("contextRay.findings", new FindingProvider(state)),
    vscode.window.registerTreeDataProvider("contextRay.sources", new SourceProvider(state)),
  );

  const scan = async (notify = true): Promise<ScanReport | undefined> => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      if (notify)
        void vscode.window.showWarningMessage("Open a workspace before running Context Ray.");
      return undefined;
    }
    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: "Context Ray: analyzing effective context",
      },
      async () => {
        try {
          const report = await analyzeContext({
            root,
            agent: configuredAgent(),
            target: activeTarget(root),
          });
          state.update(report);
          updateDiagnostics(report, diagnostics);
          output.clear();
          output.append(formatTerminal(report, { color: false }));
          if (notify) {
            void vscode.window.showInformationMessage(
              `Context Ray: ${report.summary.effectiveTokens.toLocaleString()} tokens, ${report.findings.length} findings`,
            );
          }
          return report;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          output.appendLine(message);
          void vscode.window.showErrorMessage(`Context Ray scan failed: ${message}`);
          return undefined;
        }
      },
    );
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("contextRay.scan", async () => {
      await scan(true);
    }),
    vscode.commands.registerCommand("contextRay.openReport", async () => {
      const report = state.report ?? (await scan(false));
      if (!report) return;
      try {
        const template = await readFile(
          vscode.Uri.joinPath(context.extensionUri, "media", "dashboard.html").fsPath,
          "utf8",
        );
        const panel = vscode.window.createWebviewPanel(
          "contextRayReport",
          `Context Ray · ${report.scan.agent}`,
          vscode.ViewColumn.Beside,
          { enableScripts: true },
        );
        panel.webview.html = renderHtml(report, template);
      } catch {
        void vscode.window.showErrorMessage(
          "Dashboard asset is missing. Build the workspace before opening the report.",
        );
      }
    }),
  );

  const watcher = vscode.workspace.createFileSystemWatcher(
    "**/{AGENTS.md,AGENTS.override.md,CLAUDE.md,GEMINI.md,*.mdc,.mcp.json,context-ray.mcp.json}",
  );
  const rescan = (): void => {
    if (vscode.workspace.getConfiguration("contextRay").get("scanOnSave", true)) void scan(false);
  };
  watcher.onDidChange(rescan, undefined, context.subscriptions);
  watcher.onDidCreate(rescan, undefined, context.subscriptions);
  watcher.onDidDelete(rescan, undefined, context.subscriptions);
  context.subscriptions.push(watcher);
  void scan(false);
}

export function deactivate(): void {}
