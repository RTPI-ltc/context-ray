import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import * as core from "@actions/core";
import {
  analyzeContext,
  compareReports,
  evaluateBaselineGate,
  severityRank,
  validateScanReport,
  type FailureThreshold,
} from "@context-ray/core";
import type { AgentId, ScanReport, Severity } from "@context-ray/schema";
import { formatJson, formatMarkdown, formatSarif } from "@context-ray/reporters";

const agents: AgentId[] = ["codex", "claude", "cursor", "copilot", "gemini"];
const severities: Severity[] = ["note", "warning", "error"];

function agentInput(): AgentId {
  const value = core.getInput("agent") || "codex";
  if (!agents.includes(value as AgentId)) throw new Error(`Unsupported agent: ${value}`);
  return value as AgentId;
}

function thresholdInput(name: string, fallback: FailureThreshold): FailureThreshold {
  const value = core.getInput(name) || fallback;
  if (value !== "none" && !severities.includes(value as Severity)) {
    throw new Error(`Unsupported ${name} severity: ${value}`);
  }
  return value as FailureThreshold;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function loadBaseline(root: string, input: string): Promise<ScanReport> {
  const baselinePath = path.resolve(root, input);
  if (!isInside(root, baselinePath)) {
    throw new Error("Baseline report must stay inside the configured root.");
  }
  const parsed: unknown = JSON.parse(await readFile(baselinePath, "utf8"));
  const validation = validateScanReport(parsed);
  if (!validation.valid) {
    throw new Error(`Invalid baseline report: ${validation.errors.slice(0, 5).join("; ")}`);
  }
  return parsed as ScanReport;
}

async function run(): Promise<void> {
  try {
    const root = path.resolve(core.getInput("root") || process.env.GITHUB_WORKSPACE || ".");
    const target = core.getInput("target") || ".";
    const agent = agentInput();
    const baselineInput = core.getInput("baseline").trim();
    const failOnNew = thresholdInput("fail-on-new", "none");
    if (failOnNew !== "none" && !baselineInput) {
      throw new Error("fail-on-new requires a baseline report.");
    }
    const outputDirectory = path.resolve(root, core.getInput("output-directory") || ".context-ray");
    const jsonPath = path.join(outputDirectory, "report.json");
    const sarifPath = path.join(outputDirectory, "report.sarif");
    const markdownPath = path.join(outputDirectory, "summary.md");
    if (baselineInput && path.resolve(root, baselineInput) === jsonPath) {
      throw new Error("baseline and output-directory/report.json must use different files.");
    }
    const baseline = baselineInput ? await loadBaseline(root, baselineInput) : undefined;
    const report = await analyzeContext({ root, target, agent });
    await mkdir(outputDirectory, { recursive: true });
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
    let baselineSummary = "";
    let baselineFailed = false;
    if (baseline) {
      const diff = compareReports(baseline, report);
      core.setOutput("new-findings", String(diff.addedFindingIds.length));
      core.setOutput("resolved-findings", String(diff.resolvedFindingIds.length));
      baselineSummary = [
        "\n## Baseline regression\n",
        `- Comparable: ${diff.comparability.comparable ? "yes" : "no"}`,
        `- Effective tokens: ${diff.deltas.effectiveTokens >= 0 ? "+" : ""}${diff.deltas.effectiveTokens}`,
        `- New findings: ${diff.addedFindingIds.length}`,
        `- Resolved findings: ${diff.resolvedFindingIds.length}`,
        `- Severity changes: ${diff.severityChanges.length}`,
        "",
      ].join("\n");
      if (!diff.comparability.comparable && failOnNew !== "none") {
        throw new Error(
          `Baseline scope differs in: ${diff.comparability.scopeDifferences.join(", ")}.`,
        );
      }
      baselineFailed = evaluateBaselineGate(diff, failOnNew).failed;
    } else {
      core.setOutput("new-findings", "0");
      core.setOutput("resolved-findings", "0");
    }
    await core.summary.addRaw(`${markdown}${baselineSummary}`).write();

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

    const failOn = thresholdInput("fail-on", "error");
    const currentFailed =
      failOnNew === "none" &&
      failOn !== "none" &&
      report.findings.some((finding) => severityRank(finding.severity) >= severityRank(failOn));
    const failures = [
      ...(currentFailed ? [`${failOn}-or-higher diagnostics`] : []),
      ...(baselineFailed ? [`new ${failOnNew}-or-higher regressions`] : []),
    ];
    if (failures.length > 0) core.setFailed(`Context Ray found ${failures.join(" and ")}.`);
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

void run();
