import type { ScanReport } from "@context-ray/schema";

declare global {
  interface Window {
    __CONTEXT_RAY_REPORT__: ScanReport | null;
  }
}

export {};
