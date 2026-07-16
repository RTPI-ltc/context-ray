#!/usr/bin/env node
import { readFile, rename, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command, InvalidArgumentError, Option } from "commander";
import open from "open";
import {
  analyzeContext,
  compareReports,
  evaluateBaselineGate,
  observeRuntime,
  severityRank,
  validateScanReport,
  type FailureThreshold,
} from "@context-ray/core";
import { startContextRayServer } from "@context-ray/server";
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
  failOnNew: FailureThreshold;
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

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new InvalidArgumentError("Expected a TCP port between 0 and 65535.");
  }
  return port;
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
  const validation = validateScanReport(parsed);
  if (!validation.valid) {
    const details = validation.errors.slice(0, 5).join("; ");
    throw new Error(`${filePath} is not a valid Context Ray schema v1 report: ${details}`);
  }
  return parsed as ScanReport;
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

function shouldFail(report: ScanReport, failOn: ScanFlags["failOn"]): boolean {
  if (failOn === "none") return false;
  const threshold = severityRank(failOn);
  return report.findings.some((finding) => severityRank(finding.severity) >= threshold);
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
  if (flags.failOnNew !== "none" && !flags.baseline) {
    throw new Error("--fail-on-new requires --baseline <report.json>.");
  }
  const defaultHtmlPath = path.join(root, ".context-ray", "report.html");
  const outputPath = flags.output ?? (flags.format === "html" ? defaultHtmlPath : undefined);
  const baseline = flags.baseline ? await loadReport(flags.baseline) : undefined;
  if (flags.baseline && outputPath && path.resolve(flags.baseline) === path.resolve(outputPath)) {
    throw new Error("--baseline and --output must use different files.");
  }
  const report = await analyzeContext({
    root,
    target: flags.target,
    agent: flags.agent,
    ...(flags.task ? { task: flags.task } : {}),
    ...(flags.includeGlobal ? { includeGlobal: true } : {}),
    ...(flags.mcpSnapshot?.length ? { mcpSnapshotPaths: flags.mcpSnapshot } : {}),
  });
  const output = await serialize(report, flags);
  if (outputPath) {
    await atomicWrite(outputPath, output);
    process.stderr.write(`Context Ray wrote ${path.resolve(outputPath)}\n`);
    if (flags.open) await open(path.resolve(outputPath), { wait: false });
  } else {
    process.stdout.write(output);
  }
  if (baseline) {
    const diff = compareReports(baseline, report);
    process.stderr.write(formatDiff(diff, Boolean(process.stderr.isTTY)));
    if (!diff.comparability.comparable) {
      process.stderr.write(
        `Baseline scope differs in: ${diff.comparability.scopeDifferences.join(", ")}\n`,
      );
      if (flags.failOnNew !== "none") {
        throw new Error("cannot gate new regressions against a non-comparable baseline.");
      }
    } else if (evaluateBaselineGate(diff, flags.failOnNew).failed) {
      process.exitCode = 2;
    }
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
    .addOption(
      new Option(
        "--fail-on-new <severity>",
        "with --baseline, exit 2 only for added findings or severity increases",
      )
        .choices(["none", "note", "warning", "error"])
        .default("none"),
    )
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

program
  .command("serve")
  .description("run the real local analysis API and interactive dashboard")
  .argument("[root]", "repository root", ".")
  .option("-a, --agent <agent>", "initial agent adapter", parseAgent, "codex" as AgentId)
  .option("-t, --target <path>", "initial target file or directory", ".")
  .option("--host <host>", "loopback host", "127.0.0.1")
  .option("--port <port>", "local TCP port", parsePort, 4173)
  .option("--open", "open the dashboard in the default browser")
  .action(
    async (
      root: string,
      flags: {
        agent: AgentId;
        target: string;
        host: string;
        port: number;
        open?: boolean;
      },
    ) => {
      const dashboardHtml = await loadHtmlTemplate();
      const running = await startContextRayServer({
        root: path.resolve(root),
        dashboardHtml,
        host: flags.host,
        port: flags.port,
        agent: flags.agent,
        target: flags.target,
      });
      process.stderr.write(
        `Context Ray dashboard ${running.url}\nRepository ${running.root}\nPress Ctrl+C to stop.\n`,
      );
      if (flags.open) await open(running.url, { wait: false });
      await new Promise<void>((resolve, reject) => {
        let closing = false;
        const close = (): void => {
          if (closing) return;
          closing = true;
          running.close().then(resolve, reject);
        };
        process.once("SIGINT", close);
        process.once("SIGTERM", close);
      });
    },
  );

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`context-ray: ${message}\n`);
  process.exitCode = 1;
});
