let sequence = 0;
const pending = new Map();
const reportListeners = new Set();

function isReportPayload(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.scan?.id === "string" &&
    Array.isArray(value.sources) &&
    Array.isArray(value.findings)
  );
}

if (typeof window !== "undefined") {
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || typeof message !== "object") return;
    if (message.type === "context-ray/report" && isReportPayload(message.payload)) {
      reportListeners.forEach((listener) => listener(message.payload, message.runtime));
      return;
    }
    if (message.type !== "context-ray/response" || !message.requestId) return;
    const request = pending.get(message.requestId);
    if (!request) return;
    pending.delete(message.requestId);
    if (request.timer != null) window.clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error));
    else request.resolve(message.payload);
  });
}

async function responseJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `Request failed with status ${response.status}`);
  return body;
}

function vscodeRequest(vscode, type, payload = {}, timeoutMs = 60_000) {
  const requestId = `dashboard-${Date.now()}-${sequence++}`;
  return new Promise((resolve, reject) => {
    const timer =
      timeoutMs == null
        ? undefined
        : window.setTimeout(() => {
            pending.delete(requestId);
            reject(new Error(`VS Code did not answer ${type} within ${timeoutMs / 1000} seconds.`));
          }, timeoutMs);
    pending.set(requestId, { resolve, reject, timer });
    vscode.postMessage({ type, requestId, ...payload });
  });
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function createDashboardApi(runtime, report) {
  const mode = runtime?.mode ?? (report ? "static" : "unavailable");
  const vscode = mode === "vscode" && window.acquireVsCodeApi ? window.acquireVsCodeApi() : null;

  return {
    mode,
    supports: runtime?.supports ?? {
      scan: false,
      projection: false,
      sourcePreview: false,
      export: Boolean(report),
    },
    async session() {
      if (mode === "server") return await fetch("/api/session").then(responseJson);
      return runtime;
    },
    subscribeReport(listener) {
      if (!vscode) return () => {};
      reportListeners.add(listener);
      vscode.postMessage({ type: "context-ray/ready" });
      return () => reportListeners.delete(listener);
    },
    async scan(input) {
      if (mode === "server") {
        return await fetch("/api/scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        }).then(responseJson);
      }
      if (vscode) return await vscodeRequest(vscode, "context-ray/scan", { input }, null);
      throw new Error("This is a static report. Start `context-ray serve` to run a new scan.");
    },
    async project(input) {
      if (mode === "server") {
        return await fetch("/api/project", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        }).then(responseJson);
      }
      if (vscode) return await vscodeRequest(vscode, "context-ray/project", { input });
      throw new Error("Scenario projection requires the local API or VS Code host.");
    },
    async sourcePreview(reportId, sourceId) {
      if (mode === "server") {
        const url = new URL("/api/source-preview", window.location.origin);
        url.searchParams.set("reportId", reportId);
        url.searchParams.set("sourceId", sourceId);
        return await fetch(url).then(responseJson);
      }
      if (vscode) {
        return await vscodeRequest(vscode, "context-ray/source-preview", { reportId, sourceId });
      }
      throw new Error("Source preview is unavailable in a portable static report.");
    },
    async exportReport(currentReport, format) {
      if (mode === "server") {
        const url = new URL("/api/export", window.location.origin);
        url.searchParams.set("reportId", currentReport.scan.id);
        url.searchParams.set("format", format);
        const response = await fetch(url);
        if (!response.ok) await responseJson(response);
        const names = {
          json: "context-ray-report.json",
          sarif: "context-ray-report.sarif",
          markdown: "context-ray-report.md",
          html: "context-ray-report.html",
        };
        downloadBlob(await response.blob(), names[format]);
        return { saved: true, fileName: names[format] };
      }
      if (vscode) {
        return await vscodeRequest(
          vscode,
          "context-ray/export",
          {
            reportId: currentReport.scan.id,
            format,
          },
          null,
        );
      }
      if (format !== "json") {
        throw new Error("Portable reports can download JSON; use the local API for other formats.");
      }
      downloadBlob(
        new Blob([`${JSON.stringify(currentReport, null, 2)}\n`], { type: "application/json" }),
        "context-ray-report.json",
      );
      return { saved: true, fileName: "context-ray-report.json" };
    },
  };
}
