import type { DashboardRuntime, ScanReport } from "@context-ray/schema";

declare global {
  interface Window {
    __CONTEXT_RAY_REPORT__: ScanReport | null;
    __CONTEXT_RAY_RUNTIME__: DashboardRuntime | null;
    acquireVsCodeApi?: () => {
      postMessage(message: unknown): void;
      getState(): unknown;
      setState(state: unknown): void;
    };
  }
}

export {};
