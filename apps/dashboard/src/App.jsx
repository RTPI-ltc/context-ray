import { useMemo, useState } from "react";
import { Bar } from "@visx/shape";
import {
  IconAlertTriangle,
  IconBolt,
  IconChevronDown,
  IconChevronRight,
  IconDatabase,
  IconFileDescription,
  IconFileText,
  IconInfoCircle,
  IconLayoutList,
  IconLoader2,
  IconPlayerPlay,
  IconPlug,
  IconSparkles,
  IconSunHigh,
  IconTable,
  IconX,
} from "@tabler/icons-react";
import { demoReport } from "./demo-report.js";

const COLORS = {
  Instructions: { fill: "#8070c7", stroke: "#9d8be4", tint: "rgba(128,112,199,.36)" },
  Skills: { fill: "#317dcc", stroke: "#5d9ce0", tint: "rgba(49,125,204,.34)" },
  MCP: { fill: "#1794a9", stroke: "#4cc2d0", tint: "rgba(23,148,169,.34)" },
  References: { fill: "#ad7b08", stroke: "#e8ae28", tint: "rgba(173,123,8,.34)" },
  Conflicts: { fill: "#9d3736", stroke: "#d65f58", tint: "rgba(157,55,54,.34)" },
};

const BAND_ORDER = ["Instructions", "Skills", "MCP", "References", "Conflicts"];

function compact(value) {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 1 : 1)}k`;
  return String(value);
}

function groupFor(source) {
  if (source.metadata?.uiGroup) return source.metadata.uiGroup;
  if (source.kind === "instruction") return "Instructions";
  if (source.kind === "skill") return "Skills";
  if (source.kind === "mcp-tool" || source.kind === "mcp-server") return "MCP";
  if (source.kind === "referenced-file") return "References";
  return "Configuration";
}

function visualWeight(source, bandName) {
  if (bandName === "Conflicts") return 1;
  const cappedTokens =
    bandName === "References" ? Math.min(source.tokenEstimate, 2100) : source.tokenEstimate;
  const aggregatePenalty = bandName === "References" && source.label.startsWith("+") ? 0.65 : 1;
  return Math.sqrt(Math.max(1, cappedTokens)) * aggregatePenalty;
}

function sourceIcon(source, size = 18) {
  if (source.kind === "mcp-tool" || source.kind === "mcp-server") {
    return source.serverName === "postgres-admin" ||
      source.metadata?.serverName === "postgres-admin" ? (
      <IconDatabase size={size} stroke={1.7} />
    ) : (
      <IconPlug size={size} stroke={1.7} />
    );
  }
  if (source.kind === "skill") return <IconSparkles size={size} stroke={1.7} />;
  if (source.kind === "config" || source.kind === "mcp-config")
    return <IconFileDescription size={size} stroke={1.7} />;
  return <IconFileText size={size} stroke={1.7} />;
}

function Metric({ label, value = null, tone = "default", suffix = null, children = null }) {
  return (
    <section className="metric">
      <div className="metric-label">
        {label} <IconInfoCircle size={14} stroke={1.7} />
      </div>
      {value ? <div className={`metric-value ${tone}`}>{value}</div> : children}
      {suffix ? <div className="metric-suffix">{suffix}</div> : null}
    </section>
  );
}

function CompositionChart({
  sources,
  findings,
  selectedId,
  onSelect,
  showEstimates,
  view,
  toolSchemaTokens,
}) {
  const bands = BAND_ORDER.map((name) => {
    const items = sources.filter((source) => groupFor(source) === name);
    return { name, items };
  });
  const width = 1000;
  const top = 8;
  const gap = 6;
  const bandHeight = view === "list" ? 62 : 80;
  const chartHeight = top + bands.length * (bandHeight + gap) + 18;
  const titles = {
    Instructions: `AGENTS.md chain (${bands[0]?.items.length ?? 0} files)`,
    Skills: `Skills (${bands[1]?.items.length ?? 0})`,
    MCP: `MCP servers (${bands[2]?.items.length ?? 0})`,
    References: "Referenced files (top)",
    Conflicts: `Conflicts & overrides (${findings.length})`,
  };

  return (
    <div className="composition-svg-wrap">
      <svg
        className="composition-svg"
        viewBox={`0 0 ${width} ${chartHeight}`}
        role="img"
        aria-label="Effective context token composition"
      >
        {bands.map((band, bandIndex) => {
          const y = top + bandIndex * (bandHeight + gap);
          const palette = COLORS[band.name];
          const total = band.items.reduce((sum, source) => sum + source.tokenEstimate, 0);
          const totalWeight = band.items.reduce(
            (sum, source) => sum + visualWeight(source, band.name),
            0,
          );
          const countTotal =
            band.name === "Conflicts"
              ? findings.length
              : band.name === "MCP"
                ? toolSchemaTokens
                : total;
          let cursor = 10;
          return (
            <g key={band.name}>
              <Bar
                x={0}
                y={y}
                width={width}
                height={bandHeight}
                rx={3}
                fill={palette.tint}
                stroke={palette.stroke}
                strokeWidth={0.8}
              />
              <text x={10} y={y + 20} className="band-title">
                {titles[band.name]}
              </text>
              <text x={width - 10} y={y + 20} textAnchor="end" className="band-total">
                {showEstimates
                  ? band.name === "Conflicts"
                    ? countTotal
                    : compact(countTotal)
                  : ""}
              </text>
              {band.items.map((source, itemIndex) => {
                const available = width - 20;
                const itemWidth = Math.max(
                  85,
                  available * (visualWeight(source, band.name) / Math.max(1, totalWeight)),
                );
                const clamped = Math.min(itemWidth, width - 10 - cursor);
                const selected = source.id === selectedId;
                const itemY = y + 28;
                const itemHeight = bandHeight - 36;
                const label = source.label;
                const shortLabel = label.length > 40 ? `${label.slice(0, 38)}…` : label;
                const labelLines =
                  band.name === "MCP" && shortLabel.includes(" / ")
                    ? shortLabel.split(" / ", 2)
                    : band.name === "References" && shortLabel.includes("/src/")
                      ? [shortLabel.split("/src/")[0] + "/src/", shortLabel.split("/src/")[1]]
                      : [shortLabel];
                const x = cursor;
                cursor += clamped;
                if (clamped <= 0) return null;
                return (
                  <g
                    key={source.id}
                    className="chart-source"
                    onClick={() => onSelect(source.id)}
                    tabIndex={0}
                    role="button"
                    aria-label={`Inspect ${label}`}
                  >
                    <Bar
                      x={x}
                      y={itemY}
                      width={clamped - 2}
                      height={itemHeight}
                      fill={selected ? palette.tint : "rgba(4,13,19,.24)"}
                      stroke={selected ? "#eef8ff" : palette.stroke}
                      strokeWidth={selected ? 1.5 : 0.8}
                    />
                    <clipPath id={`source-clip-${source.id}`}>
                      <rect
                        x={x + 2}
                        y={itemY + 1}
                        width={Math.max(0, clamped - 6)}
                        height={itemHeight - 2}
                      />
                    </clipPath>
                    <g clipPath={`url(#source-clip-${source.id})`}>
                      {band.name === "Conflicts" && itemIndex === 0 ? (
                        <IconAlertTriangle x={x + 8} y={itemY + 8} size={14} color="#ef7269" />
                      ) : null}
                      <text
                        x={x + (band.name === "Conflicts" && itemIndex === 0 ? 28 : 10)}
                        y={itemY + 14}
                        className="source-label"
                      >
                        {labelLines.map((line, lineIndex) => (
                          <tspan
                            key={lineIndex}
                            x={x + (band.name === "Conflicts" && itemIndex === 0 ? 28 : 10)}
                            dy={lineIndex === 0 ? 0 : 12}
                          >
                            {lineIndex > 0 && band.name === "MCP" ? `/ ${line}` : line}
                          </tspan>
                        ))}
                      </text>
                      {showEstimates && source.tokenEstimate > 0 && clamped > 85 ? (
                        <text
                          x={x + clamped - 10}
                          y={itemY + itemHeight - 5}
                          textAnchor="end"
                          className="source-token"
                        >
                          {compact(source.tokenEstimate)}
                        </text>
                      ) : null}
                      {band.name === "Conflicts" ? (
                        <text
                          x={x + clamped - 10}
                          y={itemY + itemHeight - 5}
                          textAnchor="end"
                          className="source-token"
                        >
                          1
                        </text>
                      ) : null}
                    </g>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      <div className="axis-row">
        <span>0</span>
        <span>Tokens (estimated)</span>
        <span>{compact(48300)}</span>
      </div>
    </div>
  );
}

function Relevance({ value }) {
  const label = value === "unknown" ? "Unknown" : value[0].toUpperCase() + value.slice(1);
  return (
    <span className={`relevance ${value}`}>
      <span className="dot" />
      {label}
    </span>
  );
}

function SourcesTable({ sources, selectedId, onSelect, expanded, onToggle, totalSourceCount }) {
  const sorted = [...sources]
    .filter(
      (source) =>
        source.tokenEstimate > 0 &&
        source.kind !== "skill" &&
        groupFor(source) !== "Conflicts" &&
        !source.metadata?.hideFromTable &&
        !source.label.startsWith("+"),
    )
    .sort((left, right) => right.tokenEstimate - left.tokenEstimate);
  const shown = sorted.slice(0, expanded ? 12 : 6);
  return (
    <section className="sources-section">
      <header className="section-heading table-heading">
        <div>
          <strong>Top sources by tokens</strong>
          <span>(sorted by est. tokens)</span>
          <IconInfoCircle size={14} />
        </div>
      </header>
      <div className="source-table" role="table">
        <div className="table-row table-header" role="row">
          <span>Source</span>
          <span>Load mode</span>
          <span>Tokens (est.) ↓</span>
          <span>Relevance</span>
          <span>Recommendation</span>
          <span />
        </div>
        {shown.map((source) => {
          const loadMode =
            source.metadata?.loadMode ?? (source.status === "on-demand" ? "On-demand" : "Eager");
          return (
            <button
              className={`table-row ${source.id === selectedId ? "selected" : ""}`}
              key={source.id}
              onClick={() => onSelect(source.id)}
              role="row"
            >
              <span className="source-cell">
                {sourceIcon(source)}
                <span>{source.label}</span>
              </span>
              <span>
                <em className={`mode ${loadMode === "On-demand" ? "on-demand" : "eager"}`}>
                  {loadMode}
                </em>
              </span>
              <span className="token-cell">{compact(source.tokenEstimate)}</span>
              <span>
                <Relevance value={source.relevance} />
              </span>
              <span className="recommendation-cell">
                <b>{source.metadata?.recommendation ?? "Keep"}</b>
                <small>{source.metadata?.recommendationDetail ?? "Observed source"}</small>
              </span>
              <span className="more">•••</span>
            </button>
          );
        })}
      </div>
      <footer className="table-footer">
        <span>
          Showing 1–{shown.length} of {totalSourceCount} sources
        </span>
        <button onClick={onToggle}>
          {expanded ? "Show less" : "View all"}
          <IconChevronRight size={16} />
        </button>
      </footer>
    </section>
  );
}

function Inspector({ source, onClose, onModeChange }) {
  const recommendation =
    source.metadata?.recommendation ??
    (source.relevance === "low" ? "Progressive discovery" : "Keep");
  const [mode, setMode] = useState(
    recommendation === "Progressive discovery"
      ? recommendation
      : (source.metadata?.loadMode ?? "Eager"),
  );
  const savings = Number(source.metadata?.savings ?? Math.round(source.tokenEstimate * 0.4));
  const evidence = source.metadata?.evidence ?? [
    `Discovered at ${source.path}`,
    source.reason,
    "No provider-internal prompt data is assumed",
  ];
  const changeMode = (event) => {
    setMode(event.target.value);
    onModeChange(event.target.value);
  };
  return (
    <aside className="inspector">
      <div className="inspector-scroll">
        <header className="inspector-title">
          <div className="inspector-source-icon">{sourceIcon(source, 25)}</div>
          <h2>
            {source.metadata?.serverName ?? source.serverName ?? source.label.split(" / ")[0]}
            <span>
              {source.metadata?.toolName
                ? `/ ${source.metadata.toolName}`
                : source.label.includes(" / ")
                  ? `/ ${source.label.split(" / ").slice(1).join(" / ")}`
                  : source.path}
            </span>
          </h2>
          <button className="icon-button" aria-label="Close inspector" onClick={onClose}>
            <IconX size={20} />
          </button>
        </header>
        <div className="badges">
          <span className="badge blue">{source.kind.replace("mcp-", "MCP ")}</span>
          <span className={`badge ${source.relevance === "low" ? "red" : "green"}`}>
            {source.relevance} relevance
          </span>
        </div>
        <div className="inspector-block token-block">
          <label>Tokens (est.)</label>
          <strong>{compact(source.tokenEstimate)}</strong>
          <span>
            (
            {source.tokenEstimate
              ? `~${Math.round((source.tokenEstimate / 48300) * 100)}% of startup context`
              : "not token-bearing"}
            )
          </span>
        </div>
        <div className="inspector-block">
          <label>Description</label>
          <p>{source.metadata?.description ?? source.reason}</p>
        </div>
        <div className="inspector-block">
          <label>Why it’s loaded</label>
          <p>{source.reason}</p>
        </div>
        <div className="inspector-block">
          <label>Relevance (observed)</label>
          <p>
            {source.relevance === "low"
              ? `Not referenced in target path (${demoReport.scan.target}). No static imports of this source were detected.`
              : `Directly associated with the selected target or repository policy.`}
          </p>
        </div>
        <div className="inspector-block recommendation-block">
          <label>
            Recommendation <IconInfoCircle size={14} />
          </label>
          <div className="recommendation-card">
            <h3>{recommendation}</h3>
            <p>
              {recommendation === "Progressive discovery"
                ? "Discover and load this tool only when user intent indicates database inspection is needed."
                : "Keep this source in its current load path."}
            </p>
            <div className="recommendation-stats">
              <div>
                <span>Estimated savings</span>
                <strong>
                  {compact(savings)} tokens (
                  {source.tokenEstimate ? Math.round((savings / source.tokenEstimate) * 100) : 0}%)
                </strong>
              </div>
              <div>
                <span>Confidence</span>
                <strong className="confidence-dots">
                  ● ● ● ○ ○ <em>Medium</em>
                </strong>
              </div>
            </div>
            <small>May add 1 extra tool call when first needed.</small>
          </div>
        </div>
        <div className="inspector-block load-mode">
          <label htmlFor="load-mode">Load mode</label>
          <div className="select-wrap">
            <span>Change to:</span>
            <select id="load-mode" value={mode} onChange={changeMode}>
              <option>Eager</option>
              <option>Progressive discovery</option>
              <option>On-demand</option>
            </select>
            <IconChevronDown size={16} />
          </div>
          <small>Current: {source.metadata?.loadMode ?? "Eager"}</small>
        </div>
        <div className="inspector-block evidence-block">
          <label>Evidence</label>
          <ul>
            {evidence.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <button>
            View references (0)
            <IconChevronRight size={16} />
          </button>
        </div>
      </div>
      <footer className="inspector-footer">
        <div>
          Observability: <b>Repository observed</b> · <b>Runtime partially observable</b>
        </div>
        <span>Estimates derived from static analysis and schema heuristics.</span>
      </footer>
    </aside>
  );
}

export function App() {
  const injected = typeof window !== "undefined" ? window.__CONTEXT_RAY_REPORT__ : null;
  const report = injected ?? demoReport;
  const visibleSources = useMemo(
    () => report.sources.filter((source) => groupFor(source) !== "Configuration"),
    [report],
  );
  const [selectedId, setSelectedId] = useState(
    visibleSources.find((source) => source.kind === "mcp-tool")?.id ?? visibleSources[0]?.id,
  );
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [showEstimates, setShowEstimates] = useState(true);
  const [view, setView] = useState("blocks");
  const [expanded, setExpanded] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanLabel, setScanLabel] = useState("Jul 13, 2026 · 14:32");
  const [toast, setToast] = useState("");
  const selected = visibleSources.find((source) => source.id === selectedId) ?? visibleSources[0];

  const selectSource = (id) => {
    setSelectedId(id);
    setInspectorOpen(true);
  };
  const runScan = () => {
    setScanning(true);
    setToast("");
    window.setTimeout(() => {
      setScanning(false);
      setScanLabel("Just now · 842 ms");
      setToast("Scan complete · repository evidence refreshed");
      window.setTimeout(() => setToast(""), 2800);
    }, 900);
  };
  return (
    <main className={`app-shell ${inspectorOpen ? "with-inspector" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <IconSunHigh size={29} stroke={1.4} />
          <strong>Context Ray</strong>
        </div>
        <label className="context-field">
          <span>Repo</span>
          <select defaultValue="acme/checkout">
            <option>acme/checkout</option>
            <option>acme/billing</option>
          </select>
        </label>
        <label className="context-field agent-field">
          <span>Agent</span>
          <select defaultValue={report.scan.agent}>
            <option>codex</option>
            <option>claude</option>
            <option>cursor</option>
            <option>copilot</option>
            <option>gemini</option>
          </select>
        </label>
        <label className="context-field target-field">
          <span>Target</span>
          <select defaultValue={report.scan.target}>
            <option>{report.scan.target}</option>
            <option>services/checkout/</option>
            <option>.</option>
          </select>
        </label>
        <div className="scan-meta">
          <span>Scan</span>
          <strong>{scanLabel}</strong>
        </div>
        <button className="run-button" onClick={runScan} disabled={scanning}>
          {scanning ? <IconLoader2 className="spin" size={18} /> : <IconPlayerPlay size={18} />}
          {scanning ? "Scanning…" : "Run scan"}
        </button>
        <button className="icon-button more-button" aria-label="More options">
          •••
        </button>
      </header>
      <section className="metrics-strip">
        <Metric
          label="Startup context"
          value={compact(report.summary.effectiveTokens)}
          tone="blue"
          suffix="tokens (est.)"
        />
        <Metric
          label="Tool schemas"
          value={compact(report.summary.toolSchemaTokens)}
          suffix="tokens (est.)"
        />
        <Metric
          label="Potentially removable"
          value={compact(report.summary.potentialWasteTokens)}
          tone="amber"
          suffix="tokens (est.)"
        />
        <Metric
          label="Conflicts"
          value={String(report.summary.conflicts)}
          tone="red"
          suffix="detected"
        />
        <Metric label="Coverage">
          <div className="coverage-lines">
            <span>
              <i />
              Repository observed
            </span>
            <span>Runtime partially observable</span>
          </div>
        </Metric>
        <Metric label="Estimates">
          <div className="estimate-lines">
            <span>Static analysis</span>
            <span>+ schema heuristics</span>
          </div>
        </Metric>
      </section>
      <div className="workspace">
        <section className="main-pane">
          <header className="section-heading composition-heading">
            <div>
              <strong>Context composition</strong>
              <span>(tokens, estimated)</span>
              <IconInfoCircle size={14} />
            </div>
            <div className="chart-controls">
              <label>
                Group by:
                <select>
                  <option>Source type</option>
                  <option>Load mode</option>
                  <option>Relevance</option>
                </select>
                <IconChevronDown size={14} />
              </label>
              <span>View:</span>
              <div className="view-toggle">
                <button
                  className={view === "blocks" ? "active" : ""}
                  onClick={() => setView("blocks")}
                  aria-label="Block view"
                >
                  <IconTable size={16} />
                </button>
                <button
                  className={view === "list" ? "active" : ""}
                  onClick={() => setView("list")}
                  aria-label="Compact view"
                >
                  <IconLayoutList size={17} />
                </button>
              </div>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={showEstimates}
                  onChange={(event) => setShowEstimates(event.target.checked)}
                />
                Show estimates
              </label>
              <IconInfoCircle size={14} />
            </div>
          </header>
          <CompositionChart
            sources={visibleSources}
            findings={report.findings}
            selectedId={selectedId}
            onSelect={selectSource}
            showEstimates={showEstimates}
            view={view}
            toolSchemaTokens={report.summary.toolSchemaTokens}
          />
          <SourcesTable
            sources={visibleSources}
            selectedId={selectedId}
            onSelect={selectSource}
            expanded={expanded}
            onToggle={() => setExpanded((value) => !value)}
            totalSourceCount={report.summary.discoveredSources}
          />
        </section>
        {inspectorOpen && selected ? (
          <Inspector
            key={selected.id}
            source={selected}
            onClose={() => setInspectorOpen(false)}
            onModeChange={(mode) => {
              setToast(`Load mode preview changed to ${mode}`);
              window.setTimeout(() => setToast(""), 2200);
            }}
          />
        ) : null}
      </div>
      {toast ? (
        <div className="toast">
          <IconBolt size={16} />
          {toast}
        </div>
      ) : null}
    </main>
  );
}
