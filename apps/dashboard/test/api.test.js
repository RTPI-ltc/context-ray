import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  delete globalThis.window;
  vi.restoreAllMocks();
});

describe("dashboard VS Code transport", () => {
  it("announces readiness, receives pushed reports, and unsubscribes cleanly", async () => {
    const listeners = new Map();
    const posted = [];
    globalThis.window = {
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
      acquireVsCodeApi() {
        return { postMessage: (message) => posted.push(message) };
      },
      clearTimeout() {},
      setTimeout() {
        return 1;
      },
    };

    const { createDashboardApi } = await import("../src/api.js?transport-test");
    const api = createDashboardApi(
      {
        mode: "vscode",
        supports: { scan: true, projection: true, sourcePreview: true, export: true },
      },
      null,
    );
    const receive = vi.fn();
    const unsubscribe = api.subscribeReport(receive);

    expect(posted).toEqual([{ type: "context-ray/ready" }]);

    const report = {
      scan: { id: "report-2" },
      sources: [],
      findings: [],
    };
    const runtime = { mode: "vscode", repoLabel: "sample" };
    listeners.get("message")({
      data: { type: "context-ray/report", payload: report, runtime },
    });
    expect(receive).toHaveBeenCalledWith(report, runtime);

    unsubscribe();
    listeners.get("message")({
      data: { type: "context-ray/report", payload: report, runtime },
    });
    expect(receive).toHaveBeenCalledTimes(1);
  });

  it("does not falsely time out long scans or an open save dialog", async () => {
    const listeners = new Map();
    const posted = [];
    const setTimeout = vi.fn(() => 1);
    globalThis.window = {
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
      acquireVsCodeApi() {
        return { postMessage: (message) => posted.push(message) };
      },
      clearTimeout: vi.fn(),
      setTimeout,
    };

    const { createDashboardApi } = await import("../src/api.js?timeout-test");
    const api = createDashboardApi(
      {
        mode: "vscode",
        supports: { scan: true, projection: true, sourcePreview: true, export: true },
      },
      null,
    );

    const scanPromise = api.scan({ agent: "codex", target: "." });
    const scanRequest = posted.at(-1);
    expect(setTimeout).not.toHaveBeenCalled();
    listeners.get("message")({
      data: {
        type: "context-ray/response",
        requestId: scanRequest.requestId,
        payload: { scan: { id: "scan-2" }, sources: [], findings: [] },
      },
    });
    await expect(scanPromise).resolves.toMatchObject({ scan: { id: "scan-2" } });

    const exportPromise = api.exportReport({ scan: { id: "scan-2" } }, "json");
    const exportRequest = posted.at(-1);
    expect(setTimeout).not.toHaveBeenCalled();
    listeners.get("message")({
      data: {
        type: "context-ray/response",
        requestId: exportRequest.requestId,
        payload: { saved: false },
      },
    });
    await expect(exportPromise).resolves.toEqual({ saved: false });

    const previewPromise = api.sourcePreview("scan-2", "source-1");
    const previewRequest = posted.at(-1);
    expect(setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 60_000);
    listeners.get("message")({
      data: {
        type: "context-ray/response",
        requestId: previewRequest.requestId,
        payload: { reportId: "scan-2", sourceId: "source-1", content: "" },
      },
    });
    await expect(previewPromise).resolves.toMatchObject({ sourceId: "source-1" });
  });
});
