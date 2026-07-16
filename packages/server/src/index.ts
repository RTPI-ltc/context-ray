import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { analyzeContext, projectLoadMode, readTextWithinRoot } from "@context-ray/core";
import { formatJson, formatMarkdown, formatSarif, renderHtml } from "@context-ray/reporters";
import type { AgentId, DashboardRuntime, LoadMode, ScanReport } from "@context-ray/schema";

const AGENTS: AgentId[] = ["codex", "claude", "cursor", "copilot", "gemini"];
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const MAX_BODY_BYTES = 64 * 1024;
const MAX_PREVIEW_BYTES = 128 * 1024;
const MAX_REPORTS = 20;

export interface ContextRayServerOptions {
  root: string;
  dashboardHtml: string;
  host?: string;
  port?: number;
  agent?: AgentId;
  target?: string;
}

export interface RunningContextRayServer {
  server: Server;
  root: string;
  url: string;
  initialReport: ScanReport;
  close(): Promise<void>;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isLoopbackRequest(request: IncomingMessage): boolean {
  const header = request.headers.host;
  if (!header) return false;
  try {
    const hostname = new URL(`http://${header}`).hostname.replace(/^\[|\]$/g, "");
    return LOOPBACK_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(`${JSON.stringify(value)}\n`);
}

function sendText(
  response: ServerResponse,
  status: number,
  value: string,
  contentType: string,
  fileName?: string,
): void {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...(fileName ? { "content-disposition": `attachment; filename="${fileName}"` } : {}),
  });
  response.end(value);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "Request body is too large.");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Expected an object.");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

function parseAgent(value: unknown, fallback: AgentId): AgentId {
  const candidate = typeof value === "string" ? value : fallback;
  if (!AGENTS.includes(candidate as AgentId)) throw new HttpError(400, "Unsupported agent.");
  return candidate as AgentId;
}

function parseMode(value: unknown): LoadMode {
  if (value === "eager" || value === "progressive" || value === "on-demand") return value;
  throw new HttpError(400, "Unsupported load mode.");
}

async function resolveTarget(root: string, value: unknown, fallback: string): Promise<string> {
  const target = typeof value === "string" && value.trim() ? value.trim() : fallback;
  const absolute = path.resolve(root, target);
  if (!isInside(root, absolute))
    throw new HttpError(400, "Target must stay inside the repository.");
  try {
    await stat(absolute);
  } catch {
    throw new HttpError(400, `Target does not exist: ${target}`);
  }
  return path.relative(root, absolute).replaceAll(path.sep, "/") || ".";
}

async function discoverTargets(root: string): Promise<string[]> {
  const directories = await fg("**/*", {
    cwd: root,
    dot: true,
    onlyDirectories: true,
    unique: true,
    deep: 5,
    followSymbolicLinks: false,
    ignore: [
      "**/.git/**",
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/.context-ray/**",
    ],
  });
  return [".", ...directories.sort().slice(0, 200)];
}

function rememberReport(reports: Map<string, ScanReport>, report: ScanReport): void {
  reports.set(report.scan.id, report);
  while (reports.size > MAX_REPORTS) {
    const oldest = reports.keys().next().value as string | undefined;
    if (!oldest) break;
    reports.delete(oldest);
  }
}

function reportFrom(reports: Map<string, ScanReport>, id: string | null): ScanReport {
  if (!id) throw new HttpError(400, "reportId is required.");
  const report = reports.get(id);
  if (!report) throw new HttpError(404, "Report is not available in this server session.");
  return report;
}

async function sourcePreview(root: string, report: ScanReport, sourceId: string | null) {
  if (!sourceId) throw new HttpError(400, "sourceId is required.");
  const source = report.sources.find((item) => item.id === sourceId);
  if (!source) throw new HttpError(404, "Source is not part of this report.");
  const cleanPath = source.path.split("#", 1)[0]?.replace(/^\/+/, "");
  if (!cleanPath) throw new HttpError(400, "This source has no readable repository file.");
  const candidate = path.resolve(root, cleanPath);
  if (!isInside(root, candidate))
    throw new HttpError(400, "Source must stay inside the repository.");
  let resolved: string;
  try {
    resolved = await realpath(candidate);
  } catch {
    throw new HttpError(404, "Source file no longer exists.");
  }
  if (!isInside(root, resolved)) throw new HttpError(403, "Source symlink escapes the repository.");
  const file = await readTextWithinRoot(root, resolved, MAX_PREVIEW_BYTES);
  if (!file) throw new HttpError(404, "Source file is not readable.");
  const content = file.content;
  const lines = content.split(/\r?\n/);
  const evidenceLine = report.findings
    .flatMap((finding) => finding.evidence)
    .find((item) => item.sourceId === source.id)?.line;
  const evidenceOutsidePreview =
    evidenceLine !== undefined && file.truncated && evidenceLine > lines.length;
  const startLine = Math.max(1, (evidenceOutsidePreview ? 1 : (evidenceLine ?? 1)) - 8);
  const endLine = Math.min(lines.length, startLine + 79);
  return {
    reportId: report.scan.id,
    sourceId: source.id,
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

function staticRuntime(report: ScanReport): DashboardRuntime {
  return {
    mode: "static",
    root: report.scan.root,
    repoLabel: path.basename(report.scan.root),
    agents: AGENTS,
    targets: [report.scan.target],
    supports: { scan: false, projection: false, sourcePreview: false, export: true },
  };
}

export async function startContextRayServer(
  options: ContextRayServerOptions,
): Promise<RunningContextRayServer> {
  const root = await realpath(path.resolve(options.root));
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) throw new Error(`Repository root is not a directory: ${root}`);
  const host = options.host ?? "127.0.0.1";
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error("Context Ray server only binds to loopback hosts to protect repository data.");
  }
  const agent = options.agent ?? "codex";
  const target = await resolveTarget(root, options.target ?? ".", ".");
  const targets = await discoverTargets(root);
  if (!targets.includes(target)) targets.unshift(target);
  const reports = new Map<string, ScanReport>();
  const initialReport = await analyzeContext({ root, agent, target });
  rememberReport(reports, initialReport);
  const runtime: DashboardRuntime = {
    mode: "server",
    root,
    repoLabel: path.basename(root),
    agents: AGENTS,
    targets,
    supports: { scan: true, projection: true, sourcePreview: true, export: true },
  };
  const dashboard = renderHtml(initialReport, options.dashboardHtml, runtime);

  const server = createServer(async (request, response) => {
    try {
      if (!isLoopbackRequest(request)) {
        throw new HttpError(403, "Host header must name a loopback address.");
      }
      const url = new URL(request.url ?? "/", `http://${host}`);
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
          "content-security-policy":
            "default-src 'self' data: blob:; connect-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'",
        });
        response.end(dashboard);
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/health") {
        sendJson(response, 200, {
          status: "ok",
          root,
          mode: "server",
          reportId: initialReport.scan.id,
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/session") {
        sendJson(response, 200, runtime);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/scan") {
        const body = await readJson(request);
        const nextAgent = parseAgent(body.agent, agent);
        const nextTarget = await resolveTarget(root, body.target, target);
        const task = typeof body.task === "string" ? body.task.trim().slice(0, 2_000) : "";
        const report = await analyzeContext({
          root,
          agent: nextAgent,
          target: nextTarget,
          ...(task ? { task } : {}),
        });
        rememberReport(reports, report);
        sendJson(response, 200, report);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/project") {
        const body = await readJson(request);
        const report = reportFrom(
          reports,
          typeof body.reportId === "string" ? body.reportId : null,
        );
        if (typeof body.sourceId !== "string") throw new HttpError(400, "sourceId is required.");
        sendJson(response, 200, projectLoadMode(report, body.sourceId, parseMode(body.mode)));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/source-preview") {
        const report = reportFrom(reports, url.searchParams.get("reportId"));
        sendJson(
          response,
          200,
          await sourcePreview(root, report, url.searchParams.get("sourceId")),
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/export") {
        const report = reportFrom(reports, url.searchParams.get("reportId"));
        const format = url.searchParams.get("format") ?? "json";
        if (format === "json") {
          sendText(
            response,
            200,
            formatJson(report),
            "application/json; charset=utf-8",
            "context-ray-report.json",
          );
          return;
        }
        if (format === "sarif") {
          sendText(
            response,
            200,
            formatSarif(report),
            "application/sarif+json; charset=utf-8",
            "context-ray-report.sarif",
          );
          return;
        }
        if (format === "markdown") {
          sendText(
            response,
            200,
            formatMarkdown(report),
            "text/markdown; charset=utf-8",
            "context-ray-report.md",
          );
          return;
        }
        if (format === "html") {
          sendText(
            response,
            200,
            renderHtml(report, options.dashboardHtml, staticRuntime(report)),
            "text/html; charset=utf-8",
            "context-ray-report.html",
          );
          return;
        }
        throw new HttpError(400, "Unsupported export format.");
      }
      throw new HttpError(404, "Route not found.");
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, status, { error: message });
    }
  });

  const port = options.port ?? 4173;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Server did not expose a TCP address.");
  return {
    server,
    root,
    url: `http://${host}:${address.port}/`,
    initialReport,
    close: async () =>
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
