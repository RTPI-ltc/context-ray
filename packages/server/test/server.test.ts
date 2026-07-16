import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RunningContextRayServer } from "../src/index.js";
import { startContextRayServer } from "../src/index.js";

const template = `<!doctype html><script>window.__CONTEXT_RAY_REPORT__ = null;window.__CONTEXT_RAY_RUNTIME__ = null;</script><main>Context Ray</main>`;
const running: RunningContextRayServer[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.close()));
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "context-ray-server-"));
  await mkdir(path.join(root, "services", "api"), { recursive: true });
  await writeFile(path.join(root, "AGENTS.md"), "Use pnpm and Node 20.\n", "utf8");
  await writeFile(path.join(root, "services", "api", "AGENTS.md"), "Run focused tests.\n", "utf8");
  return root;
}

describe("Context Ray server", () => {
  it("serves a real report and supports scan, projection, preview, and export", async () => {
    const root = await fixture();
    const instance = await startContextRayServer({
      root,
      dashboardHtml: template,
      port: 0,
      target: "services/api",
    });
    running.push(instance);

    const health = await fetch(new URL("api/health", instance.url)).then((response) =>
      response.json(),
    );
    expect(health).toMatchObject({ status: "ok", mode: "server" });

    const session = await fetch(new URL("api/session", instance.url)).then((response) =>
      response.json(),
    );
    expect(session).toMatchObject({
      mode: "server",
      root: instance.root,
      supports: { scan: true },
    });
    expect(session.targets).toContain("services/api");

    const scanResponse = await fetch(new URL("api/scan", instance.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "codex", target: "services/api", task: "inspect API rules" }),
    });
    expect(scanResponse.status).toBe(200);
    const report = await scanResponse.json();
    expect(report.scan).toMatchObject({
      root: instance.root,
      target: "services/api",
      agent: "codex",
      task: "inspect API rules",
    });
    expect(report.sources.length).toBeGreaterThan(0);

    const source = report.sources.find((item: { tokenEstimate: number }) => item.tokenEstimate > 0);
    const projection = await fetch(new URL("api/project", instance.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reportId: report.scan.id, sourceId: source.id, mode: "on-demand" }),
    }).then((response) => response.json());
    expect(projection).toMatchObject({
      sourceId: source.id,
      requestedMode: "on-demand",
      mutatesConfiguration: false,
    });

    const previewUrl = new URL("api/source-preview", instance.url);
    previewUrl.searchParams.set("reportId", report.scan.id);
    previewUrl.searchParams.set("sourceId", source.id);
    const preview = await fetch(previewUrl).then((response) => response.json());
    expect(preview.content).toContain("pnpm");

    const exportUrl = new URL("api/export", instance.url);
    exportUrl.searchParams.set("reportId", report.scan.id);
    exportUrl.searchParams.set("format", "sarif");
    const sarif = await fetch(exportUrl).then((response) => response.json());
    expect(sarif.version).toBe("2.1.0");

    exportUrl.searchParams.set("format", "json");
    const json = await fetch(exportUrl).then((response) => response.json());
    expect(json.scan.id).toBe(report.scan.id);

    exportUrl.searchParams.set("format", "markdown");
    const markdown = await fetch(exportUrl).then((response) => response.text());
    expect(markdown).toContain("# Context Ray report");

    exportUrl.searchParams.set("format", "html");
    const html = await fetch(exportUrl).then((response) => response.text());
    expect(html).toContain('"mode":"static"');
    expect(html).toContain(`"id":"${report.scan.id}"`);
  });

  it("rejects traversal, unsupported hosts, and symlink escapes", async () => {
    const root = await fixture();
    await expect(
      startContextRayServer({ root, dashboardHtml: template, host: "0.0.0.0", port: 0 }),
    ).rejects.toThrow("loopback");

    const instance = await startContextRayServer({ root, dashboardHtml: template, port: 0 });
    running.push(instance);
    const traversal = await fetch(new URL("api/scan", instance.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "../" }),
    });
    expect(traversal.status).toBe(400);

    const reboundStatus = await new Promise<number | undefined>((resolve, reject) => {
      const url = new URL("api/health", instance.url);
      const request = httpRequest(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          headers: { host: "attacker.example" },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      request.on("error", reject);
      request.end();
    });
    expect(reboundStatus).toBe(403);

    const outside = await mkdtemp(path.join(tmpdir(), "context-ray-outside-"));
    await writeFile(path.join(outside, "secret.md"), "outside", "utf8");
    await symlink(path.join(outside, "secret.md"), path.join(root, "AGENTS.override.md"));
    const report = instance.initialReport;
    expect(report.sources.some((source) => source.path === "AGENTS.override.md")).toBe(false);

    const rootInstructions = report.sources.find((source) => source.path === "AGENTS.md");
    expect(rootInstructions).toBeDefined();
    await rm(path.join(root, "AGENTS.md"));
    await symlink(path.join(outside, "secret.md"), path.join(root, "AGENTS.md"));
    const previewUrl = new URL("api/source-preview", instance.url);
    previewUrl.searchParams.set("reportId", report.scan.id);
    previewUrl.searchParams.set("sourceId", rootInstructions?.id ?? "");
    const preview = await fetch(previewUrl);
    expect(preview.status).toBe(403);
  });

  it("keeps previews bounded when evidence is beyond the preview window", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "context-ray-server-large-preview-"));
    const safeLines = Array.from(
      { length: 5_000 },
      (_, index) => `Safe repository guidance line ${index}.`,
    );
    await writeFile(
      path.join(root, "CLAUDE.md"),
      `${safeLines.join("\n")}\nRun sudo rm -rf / only after review.\n`,
      "utf8",
    );
    const instance = await startContextRayServer({
      root,
      dashboardHtml: template,
      port: 0,
      agent: "claude",
    });
    running.push(instance);
    const source = instance.initialReport.sources.find((item) => item.path === "CLAUDE.md");
    const finding = instance.initialReport.findings.find(
      (item) => item.ruleId === "security/dangerous-command",
    );
    expect(source).toBeDefined();
    expect(finding?.evidence[0]?.line).toBeGreaterThan(4_000);

    const previewUrl = new URL("api/source-preview", instance.url);
    previewUrl.searchParams.set("reportId", instance.initialReport.scan.id);
    previewUrl.searchParams.set("sourceId", source?.id ?? "");
    const preview = await fetch(previewUrl).then((response) => response.json());

    expect(preview).toMatchObject({ startLine: 1, truncated: true });
    expect(preview.note).toContain("outside the bounded preview");
    expect(Buffer.byteLength(preview.content, "utf8")).toBeLessThan(MAX_SAFE_PREVIEW_BYTES);
    expect(preview.content).not.toContain("sudo rm -rf");
  });
});

const MAX_SAFE_PREVIEW_BYTES = 128 * 1024;
