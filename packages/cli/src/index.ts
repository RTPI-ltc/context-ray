#!/usr/bin/env node
import { readFile, rename, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command, InvalidArgumentError, Option } from "commander";
import open from "open";
import { analyzeContext, compareReports, isScanReport, observeRuntime } from "@context-ray/core";
import type { AgentId, ScanReport, Severity } from "@context-ray/schema";
import {
  formatDiff,
  formatJson,
  formatMarkdown,
  formatSarif,
  formatTerminal,
  renderHtml,
} from "@context-ray/reporters";

const VERSION = "0.1.0";
const AGENTS: AgentId[] = ["codex", "claude", "cursor", "copilot", "gemini"];

interface ScanFlags {
  agent: AgentId;
  target: string;
  task?: string;
  format: "terminal" | "json" | "sarif" | "markdown" | "html";
  output?: string;
  includeGlobal?: boolean;
  mcpSnapshot?: string[];
  failOn: "none" | Severity;
  baseline?: string;
  open?: boolean;
  color?: boolean;
}

function parseAgent(value: string): AgentId {
  if (AGENTS.includes(value as AgentId)) return value as AgentId;
  throw new InvalidArgumentError(`Expected one of: ${AGENTS.join(", ")}`);
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const absolute = path.resolve(filePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.tmp-${process.pid}`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, absolute);
}

async function loadReport(filePath: string): Promise<ScanReport> {
  const parsed: unknown = JSON.parse(await readFile(path.resolve(filePath), "utf8"));
  if (!isScanReport(parsed)) throw new Error(`${filePath} is not a Context Ray schema v1 report.`);
  return parsed;
}

async function loadHtmlTemplate(): Promise<string> {
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(currentDirectory, "assets", "dashboard.html"),
    path.resolve(currentDirectory, "../../../apps/dashboard/dist/index.html"),
    path.resolve(currentDirectory, "../../../../apps/dashboard/dist/index.html"),
  ];
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf8");
    } catch {
      // Try the next source-tree or packaged location.
    }
  }
  throw new Error(
    "Dashboard template not found. Run `pnpm build:dashboard` before exporting HTML.",
  );
}

function failureRank(severity: Severity): number {
  return severity === "error" ? 3 : severity === "warning" ? 2 : 1;
}

function shouldFail(report: ScanReport, failOn: ScanFlags["failOn"]): boolean {
  if (failOn === "none") return false;
  const threshold = failureRank(failOn);
  return report.findings.some((finding) => failureRank(finding.severity) >= threshold);
}

async function serialize(report: ScanReport, flags: ScanFlags): Promise<string> {
  switch (flags.format) {
    case "json":
      return formatJson(report);
    case "sarif":
      return formatSarif(report);
    case "markdown":
      return formatMarkdown(report);
    case "html":
      return renderHtml(report, await loadHtmlTemplate());
    default:
      return formatTerminal(report, {
        color: Boolean(process.stdout.isTTY) && flags.color !== false,
      });
  }
}

async function runScan(root: string, flags: ScanFlags): Promise<ScanReport> {
  const report = await analyzeContext({
    root,
    target: flags.target,
    agent: flags.agent,
    ...(flags.task ? { task: flags.task } : {}),
    ...(flags.includeGlobal ? { includeGlobal: true } : {}),
    ...(flags.mcpSnapshot?.length ? { mcpSnapshotPaths: flags.mcpSnapshot } : {}),
  });
  const output = await serialize(report, flags);
  const defaultHtmlPath = path.join(root, ".context-ray", "report.html");
  const outputPath = flags.output ?? (flags.format === "html" ? defaultHtmlPath : undefined);
  if (outputPath) {
    await atomicWrite(outputPath, output);
    process.stderr.write(`Context Ray wrote ${path.resolve(outputPath)}\n`);
    if (flags.open) await open(path.resolve(outputPath), { wait: false });
  } else {
    process.stdout.write(output);
  }
  if (flags.baseline) {
    const baseline = await loadReport(flags.baseline);
    process.stderr.write(
      formatDiff(compareReports(baseline, report), Boolean(process.stderr.isTTY)),
    );
  }
  if (shouldFail(report, flags.failOn)) process.exitCode = 2;
  return report;
}

function addScanOptions(command: Command): Command {
  return command
    .addOption(
      new Option("-a, --agent <agent>", "agent adapter to simulate")
        .choices(AGENTS)
        .default("codex")
        .argParser(parseAgent),
    )
    .option("-t, --target <path>", "target file or directory", ".")
    .option("--task <description>", "task text used for relevance estimates")
    .addOption(
      new Option("-f, --format <format>", "report format")
        .choices(["terminal", "json", "sarif", "markdown", "html"])
        .default("terminal"),
    )
    .option("-o, --output <file>", "write report atomically instead of stdout")
    .option("--include-global", "request user-level adapter discovery and disclose its coverage")
    .option("--mcp-snapshot <file>", "include a local MCP server/tool snapshot", collect, [])
    .addOption(
      new Option("--fail-on <severity>", "exit 2 when this severity or higher is present")
        .choices(["none", "note", "warning", "error"])
        .default("none"),
    )
    .option("--baseline <report.json>", "print regression deltas against a prior JSON report")
    .option("--open", "open a written HTML report")
    .option("--no-color", "disable ANSI colors");
}

const program = new Command()
  .name("context-ray")
  .description("See what your coding agent can actually observe")
  .version(VERSION)
  .showHelpAfterError();

addScanOptions(
  program
    .command("scan")
    .description("statically analyze repository instructions, skills, hooks, and MCP declarations")
    .argument("[root]", "repository root", ".")
    .action(async (root: string, flags: ScanFlags) => {
      await runScan(path.resolve(root), flags);
    }),
);

program
  .command("compare")
  .description("compare two Context Ray JSON reports")
  .argument("<before>", "baseline report")
  .argument("<after>", "new report")
  .option("--json", "emit structured diff")
  .action(async (beforePath: string, afterPath: string, flags: { json?: boolean }) => {
    const diff = compareReports(await loadReport(beforePath), await loadReport(afterPath));
    process.stdout.write(
      flags.json
        ? `${JSON.stringify(diff, null, 2)}\n`
        : formatDiff(diff, Boolean(process.stdout.isTTY)),
    );
  });

const trace = program
  .command("trace")
  .description(
    "explicitly run a command, observe process metadata, then attach it to a static scan",
  )
  .argument("<command...>", "command and arguments to run; place them after --")
  .requiredOption("--root <path>", "repository root")
  .option("-a, --agent <agent>", "agent adapter", parseAgent, "codex" as AgentId)
  .option("-t, --target <path>", "target file or directory", ".")
  .option("--task <description>", "task text used for relevance estimates")
  .option("-o, --output <file>", "write JSON report", ".context-ray/runtime-report.json");

trace.action(
  async (
    command: string[],
    flags: { root: string; agent: AgentId; target: string; task?: string; output: string },
  ) => {
    const root = path.resolve(flags.root);
    const runtime = await observeRuntime(command, { cwd: root, forwardOutput: true });
    const report = await analyzeContext({
      root,
      agent: flags.agent,
      target: flags.target,
      ...(flags.task ? { task: flags.task } : {}),
      runtime,
    });
    const output = path.resolve(root, flags.output);
    await atomicWrite(output, formatJson(report));
    process.stderr.write(`Context Ray wrote ${output}\n`);
    process.exitCode = runtime.exitCode ?? (runtime.signal ? 1 : 0);
  },
);

program
  .command("doctor")
  .description("show supported adapters and the static/runtime trust boundary")
  .action(() => {
    process.stdout.write(
      `Context Ray ${VERSION}\nNode ${process.version}\nAdapters: ${AGENTS.join(", ")}\nStatic scans never execute repository commands.\nRuntime and MCP probing require explicit commands.\n`,
    );
  });

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`context-ray: ${message}\n`);
  process.exitCode = 1;
});
