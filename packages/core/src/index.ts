export { analyzeContext } from "./analyze.js";
export { compareReports } from "./diff.js";
export {
  evaluateBaselineGate,
  severityRank,
  type BaselineGateResult,
  type FailureThreshold,
} from "./gate.js";
export { discoverContext, type DiscoveryResult } from "./discover.js";
export { observeRuntime, type ObserveRuntimeOptions } from "./runtime.js";
export { projectLoadMode } from "./projection.js";
export { estimateTokens, readTextWithinRoot } from "./utils.js";
export { isScanReport, validateScanReport, REPORT_SCHEMA_VERSION } from "@context-ray/schema";
export type * from "@context-ray/schema";
