import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import * as core from "@actions/core";
import { analyzeContext } from "@context-ray/core";
import type { AgentId, Severity } from "@context-ray/schema";
import { formatJson, formatMarkdown, formatSarif } from "@context-ray/reporters";

const agents: AgentId[] = ["codex", "claude", "cursor", "copilot", "gemini"];
const severities: Severity[] = ["note", "warning", "error"];

function agentInput(): AgentId {
  const value = core.getInput("agent") || "codex";
  if (!agents.includes(value as AgentId)) throw new Error(`Unsupported agent: ${value}`);
  return value as AgentId;
}

function severityRank(value: Severity): number {
  return value === "error" ? 3 : value === "warning" ? 2 : 1;
}

async function run(): Promise<void> {
  try {
    const root = path.resolve(core.getInput("root") || process.env.GITHUB_WORKSPACE || ".");
    const target = core.getInput("target") || ".";
    const agent = agentInput();
    const report = await analyzeContext({ root, target, agent });
    const outputDirectory = path.resolve(root, core.getInput("output-directory") || ".context-ray");
    await mkdir(outputDirectory, { recursive: true });
    const jsonPath = path.join(outputDirectory, "report.json");
    const sarifPath = path.join(outputDirectory, "report.sarif");
    const markdownPath = path.join(outputDirectory, "summary.md");
    await Promise.all([
      writeFile(jsonPath, formatJson(report), "utf8"),
      writeFile(sarifPath, formatSarif(report), "utf8"),
      writeFile(markdownPath, formatMarkdown(report), "utf8"),
    ]);

    core.setOutput("report", jsonPath);
    core.setOutput("sarif", sarifPath);
    core.setOutput("effective-tokens", String(report.summary.effectiveTokens));
    core.setOutput("potential-waste-tokens", String(report.summary.potentialWasteTokens));
    core.setOutput("conflicts", String(report.summary.conflicts));

    const markdown = await readFile(markdownPath, "utf8");
    await core.summary.addRaw(markdown).write();

    for (const finding of report.findings) {
      const evidence = finding.evidence[0];
      const properties = evidence
        ? {
            file: evidence.path.split("#")[0] ?? evidence.path,
            ...(evidence.line ? { startLine: evidence.line } : {}),
          }
        : {};
      const message = `${finding.title}: ${finding.message}`;
      if (finding.severity === "error") core.error(message, properties);
      else if (finding.severity === "warning") core.warning(message, properties);
      else core.notice(message, properties);
    }

    const failOn = core.getInput("fail-on") || "error";
    if (failOn !== "none" && !severities.includes(failOn as Severity)) {
      throw new Error(`Unsupported fail-on severity: ${failOn}`);
    }
    if (
      failOn !== "none" &&
      report.findings.some(
        (finding) => severityRank(finding.severity) >= severityRank(failOn as Severity),
      )
    ) {
      core.setFailed(`Context Ray found ${failOn}-or-higher diagnostics.`);
    }
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

void run();
