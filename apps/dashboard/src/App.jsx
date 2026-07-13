import { useEffect, useMemo, useState } from "react";
import { Bar } from "@visx/shape";
import {
  IconAlertTriangle,
  IconBolt,
  IconChevronDown,
  IconChevronRight,
  IconDatabase,
  IconDownload,
  IconFileDescription,
  IconFileText,
  IconInfoCircle,
  IconLayoutList,
  IconLoader2,
  IconPlayerPlay,
  IconPlug,
  IconSettings,
  IconSparkles,
  IconSunHigh,
  IconTable,
  IconX,
} from "@tabler/icons-react";
import { createDashboardApi } from "./api.js";
import {
  AGENTS,
  buildBands,
  compact,
  formatScanLabel,
  loadModeForSource,
  recommendationForSource,
  referencesForItem,
  reportItems,
} from "./model.js";

const PALETTES = [
  { fill: "#8070c7", stroke: "#9d8be4", tint: "rgba(128,112,199,.36)" },
  { fill: "#526b80", stroke: "#7893a8", tint: "rgba(82,107,128,.34)" },
  { fill: "#317dcc", stroke: "#5d9ce0", tint: "rgba(49,125,204,.34)" },
  { fill: "#1794a9", stroke: "#4cc2d0", tint: "rgba(23,148,169,.34)" },
  { fill: "#ad7b08", stroke: "#e8ae28", tint: "rgba(173,123,8,.34)" },
  { fill: "#9d3736", stroke: "#d65f58", tint: "rgba(157,55,54,.34)" },
];

function sourceIcon(item, size = 18) {
  if (item.itemType === "finding") return <IconAlertTriangle size={size} stroke={1.7} />;
  if (item.kind === "mcp-tool" || item.kind === "mcp-server") {
    return item.serverName === "postgres-admin" ? (
      <IconDatabase size={size} stroke={1.7} />
    ) : (
      <IconPlug size={size} stroke={1.7} />
    );
  }
  if (item.kind === "skill") return <IconSparkles size={size} stroke={1.7} />;
  if (item.kind === "config" || item.kind === "mcp-config") {
    return <IconFileDescription size={size} stroke={1.7} />;
  }
  return <IconFileText size={size} stroke={1.7} />;
}

function Metric({ label, value = null, tone = "default", suffix = null, children = null }) {
  return (
    <section className="metric">
      <div className="metric-label">
        {label} <IconInfoCircle size={14} stroke={1.7} />
      </div>
      {value !== null ? <div className={`metric-value ${tone}`}>{value}</div> : children}
      {suffix ? <div className="metric-suffix">{suffix}</div> : null}
    </section>
  );
}

function visualWeight(item, bandName) {
  if (item.itemType === "finding" || bandName === "Findings") return 1;
  const capped =
    bandName === "References" ? Math.min(item.tokenEstimate, 2_100) : item.tokenEstimate;
  return Math.sqrt(Math.max(1, capped));
}

function CompositionChart({ report, groupBy, selectedId, onSelect, showEstimates, view }) {
  const bands = buildBands(report, groupBy);
  const width = 1_000;
  const top = 8;
  const gap = 6;
  const bandHeight = view === "list" ? 62 : 80;
  const chartHeight = top + bands.length * (bandHeight + gap) + 18;

  return (
    <div className="composition-svg-wrap">
      <svg
        className="composition-svg"
        viewBox={`0 0 ${width} ${chartHeight}`}
        role="img"
        aria-label={`Effective context grouped by ${groupBy}`}
      >
        {bands.map((band, bandIndex) => {
          const y = top + bandIndex * (bandHeight + gap);
          const palette = PALETTES[bandIndex] ?? PALETTES[0];
          const totalWeight = band.items.reduce(
            (sum, item) => sum + visualWeight(item, band.name),
            0,
          );
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
                {band.name} ({band.count})
              </text>
              <text x={width - 10} y={y + 20} textAnchor="end" className="band-total">
                {showEstimates
                  ? band.name === "Findings"
                    ? band.count
                    : compact(band.totalTokens)
                  : ""}
              </text>
              {band.items.map((item) => {
                const available = width - 20;
                const itemWidth = Math.max(
                  85,
                  available * (visualWeight(item, band.name) / Math.max(1, totalWeight)),
                );
                const clamped = Math.min(itemWidth, width - 10 - cursor);
                const x = cursor;
                cursor += clamped;
                if (clamped <= 0) return null;
                const selected = item.id === selectedId;
                const itemY = y + 28;
                const itemHeight = bandHeight - 36;
                const shortLabel =
                  item.label.length > 40 ? `${item.label.slice(0, 38)}…` : item.label;
                const select = () => onSelect(item.id);
                return (
                  <g
                    key={item.id}
                    className="chart-source"
                    onClick={select}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") select();
                    }}
                    tabIndex={0}
                    role="button"
                    aria-label={`Inspect ${item.label}`}
                  >
                    <Bar
                      x={x}
                      y={itemY}
                      width={Math.max(1, clamped - 2)}
                      height={itemHeight}
                      fill={selected ? palette.tint : "rgba(4,13,19,.24)"}
                      stroke={selected ? "#eef8ff" : palette.stroke}
                      strokeWidth={selected ? 1.5 : 0.8}
                    />
                    <clipPath id={`source-clip-${item.id.replaceAll(":", "-")}`}>
                      <rect
                        x={x + 2}
                        y={itemY + 1}
                        width={Math.max(0, clamped - 6)}
                        height={itemHeight - 2}
                      />
                    </clipPath>
                    <g clipPath={`url(#source-clip-${item.id.replaceAll(":", "-")})`}>
                      {item.itemType === "finding" ? (
                        <IconAlertTriangle x={x + 8} y={itemY + 8} size={14} color="#ef7269" />
                      ) : null}
                      <text
                        x={x + (item.itemType === "finding" ? 28 : 10)}
                        y={itemY + 14}
                        className="source-label"
                      >
                        {shortLabel}
                      </text>
                      {showEstimates && item.tokenEstimate > 0 && clamped > 85 ? (
                        <text
                          x={x + clamped - 10}
                          y={itemY + itemHeight - 5}
                          textAnchor="end"
                          className="source-token"
                        >
                          {compact(item.tokenEstimate)}
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
        <span>{compact(report.summary.effectiveTokens)}</span>
      </div>
    </div>
  );
}

function Relevance({ value }) {
  const label = value[0].toUpperCase() + value.slice(1);
  return (
    <span className={`relevance ${value}`}>
      <span className="dot" />
      {label}
    </span>
  );
}

function SourcesTable({ report, selectedId, onSelect, expanded, onToggle }) {
  const sorted = [...report.sources]
    .filter((source) => source.tokenEstimate > 0)
    .sort((left, right) => right.tokenEstimate - left.tokenEstimate);
  const shown = sorted.slice(0, expanded ? sorted.length : 6);
  return (
    <section className="sources-section">
      <header className="section-heading table-heading">
        <div>
          <strong>Top sources by tokens</strong>
          <span>(real scan, sorted by estimate)</span>
          <IconInfoCircle size={14} />
        </div>
      </header>
      <div className="source-table" role="table">
        <div className="table-row table-header" role="row">
          <span>Source</span>
          <span>Observed mode</span>
          <span>Tokens (est.) ↓</span>
          <span>Relevance</span>
          <span>Backend recommendation</span>
          <span />
        </div>
        {shown.map((source) => {
          const recommendation = recommendationForSource(report, source.id);
          const loadMode = loadModeForSource(source);
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
                <b>{recommendation.title}</b>
                <small>
                  {recommendation.savings > 0
                    ? `Est. save ${compact(recommendation.savings)}`
                    : "No savings estimate"}
                </small>
              </span>
              <span className="more">•••</span>
            </button>
          );
        })}
      </div>
      <footer className="table-footer">
        <span>
          Showing {shown.length} of {sorted.length} token-bearing sources · {report.sources.length}{" "}
          total
        </span>
        {sorted.length > 6 ? (
          <button onClick={onToggle}>
            {expanded ? "Show less" : "View all"}
            <IconChevronRight size={16} />
          </button>
        ) : null}
      </footer>
    </section>
  );
}

function Confidence({ value }) {
  const count = value === "high" ? 3 : value === "medium" ? 2 : 1;
  return (
    <strong className="confidence-dots">
      {Array.from({ length: 3 }, (_, index) => (index < count ? "●" : "○")).join(" ")}{" "}
      <em>{value}</em>
    </strong>
  );
}

function Inspector({ report, item, api, onClose, onToast }) {
  const [scenario, setScenario] = useState(
    item.itemType === "source"
      ? loadModeForSource(item).toLowerCase().replace("progressive", "progressive")
      : "eager",
  );
  const [projection, setProjection] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const references = referencesForItem(report, item);
  const recommendation =
    item.itemType === "finding"
      ? {
          title: item.finding.title,
          description: item.finding.recommendation,
          savings: item.finding.estimatedSavings ?? 0,
          confidence: item.finding.confidence,
        }
      : recommendationForSource(report, item.id);
  const percent = report.summary.effectiveTokens
    ? Math.round((item.tokenEstimate / report.summary.effectiveTokens) * 100)
    : 0;

  const project = async (event) => {
    const mode = event.target.value;
    setScenario(mode);
    setBusy(true);
    setLocalError("");
    try {
      const next = await api.project({ reportId: report.scan.id, sourceId: item.id, mode });
      setProjection(next);
      onToast(`Scenario recalculated by ${api.mode === "server" ? "local API" : "VS Code host"}`);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const showPreview = async () => {
    setBusy(true);
    setLocalError("");
    try {
      setPreview(await api.sourcePreview(report.scan.id, item.id));
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="inspector">
      <div className="inspector-scroll">
        <header className="inspector-title">
          <div className="inspector-source-icon">{sourceIcon(item, 25)}</div>
          <h2>
            {item.label}
            <span>{item.path}</span>
          </h2>
          <button className="icon-button" aria-label="Close inspector" onClick={onClose}>
            <IconX size={20} />
          </button>
        </header>
        <div className="badges">
          <span className="badge blue">
            {item.itemType === "finding" ? item.finding.ruleId : item.kind}
          </span>
          <span className={`badge ${item.relevance === "low" ? "red" : "green"}`}>
            {item.itemType === "finding" ? item.finding.severity : `${item.relevance} relevance`}
          </span>
        </div>
        <div className="inspector-block token-block">
          <label>Tokens (est.)</label>
          <strong>{compact(item.tokenEstimate)}</strong>
          <span>
            {item.itemType === "finding"
              ? "finding metadata"
              : item.tokenEstimate
                ? `~${percent}% of measured startup context`
                : "No startup token contribution"}
          </span>
        </div>
        <div className="inspector-block">
          <label>{item.itemType === "finding" ? "Finding" : "Why it’s loaded"}</label>
          <p>{item.reason}</p>
        </div>
        {item.itemType === "source" ? (
          <div className="inspector-block">
            <label>Observed evidence</label>
            <p>
              Target <b>{report.scan.target}</b> · {item.observability} · {item.confidence}{" "}
              confidence
            </p>
          </div>
        ) : null}
        <div className="inspector-block recommendation-block">
          <label>
            {projection ? "Backend scenario result" : "Backend recommendation"}{" "}
            <IconInfoCircle size={14} />
          </label>
          <div className="recommendation-card">
            <h3>{projection ? `${projection.requestedMode} scenario` : recommendation.title}</h3>
            <p>{projection?.explanation ?? recommendation.description}</p>
            <div className="recommendation-stats">
              <div>
                <span>{projection ? "Projected startup" : "Estimated savings"}</span>
                <strong>
                  {projection
                    ? `${compact(projection.projectedEffectiveTokens)} tokens`
                    : `${compact(recommendation.savings)} tokens`}
                </strong>
              </div>
              <div>
                <span>Confidence</span>
                <Confidence value={projection?.confidence ?? recommendation.confidence} />
              </div>
            </div>
            <small>
              {projection
                ? `Delta ${projection.deltaTokens > 0 ? "+" : ""}${compact(projection.deltaTokens)} tokens. Scenario only; configuration is unchanged.`
                : "Derived from the current report and linked findings."}
            </small>
          </div>
        </div>
        {item.itemType === "source" ? (
          <div className="inspector-block load-mode">
            <label htmlFor="load-mode">Scenario load mode</label>
            <div className="select-wrap">
              <span>Project as:</span>
              <select
                id="load-mode"
                value={scenario}
                onChange={project}
                disabled={!api.supports.projection || busy}
              >
                <option value="eager">Eager</option>
                <option value="progressive">Progressive</option>
                <option value="on-demand">On-demand</option>
              </select>
              <IconChevronDown size={16} />
            </div>
            <small>
              Observed: {loadModeForSource(item)} · this control runs analysis, not a config write
            </small>
          </div>
        ) : null}
        <div className="inspector-block evidence-block">
          <label>References ({references.length})</label>
          {references.length > 0 ? (
            <ul>
              {references.map((reference, index) => (
                <li key={`${reference.path}-${reference.line ?? 0}-${index}`}>
                  {reference.path}
                  {reference.line ? `:${reference.line}` : ""} — {reference.excerpt}
                </li>
              ))}
            </ul>
          ) : (
            <p>No finding or provenance edge references this item.</p>
          )}
          {item.itemType === "source" && api.supports.sourcePreview ? (
            <button onClick={showPreview} disabled={busy}>
              {busy ? "Loading…" : preview ? "Refresh source excerpt" : "View source excerpt"}
              <IconChevronRight size={16} />
            </button>
          ) : null}
          {preview ? (
            <div className="source-preview">
              <strong>
                {preview.path}:{preview.startLine}–{preview.endLine}
              </strong>
              <pre>{preview.content}</pre>
            </div>
          ) : null}
          {localError ? <p className="inline-error">{localError}</p> : null}
        </div>
      </div>
      <footer className="inspector-footer">
        <div>
          Observability: <b>{item.observability}</b> · Confidence: <b>{item.confidence}</b>
        </div>
        <span>Exact provider prompts remain outside repository observability.</span>
      </footer>
    </aside>
  );
}

function EmptyState({ error }) {
  return (
    <main className="empty-state">
      <IconSunHigh size={36} />
      <h1>No report is loaded</h1>
      <p>{error || "Run `context-ray serve <repo>` or open an exported Context Ray report."}</p>
    </main>
  );
}

export function App() {
  const injected = typeof window !== "undefined" ? window.__CONTEXT_RAY_REPORT__ : null;
  const runtime = typeof window !== "undefined" ? window.__CONTEXT_RAY_RUNTIME__ : null;
  const api = useMemo(() => createDashboardApi(runtime, injected), [runtime, injected]);
  const [report, setReport] = useState(injected);
  const [session, setSession] = useState(runtime);
  const [agent, setAgent] = useState(injected?.scan.agent ?? "codex");
  const [target, setTarget] = useState(injected?.scan.target ?? ".");
  const [task, setTask] = useState(injected?.scan.task ?? "");
  const [selectedId, setSelectedId] = useState(injected?.sources[0]?.id ?? null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [showEstimates, setShowEstimates] = useState(true);
  const [view, setView] = useState("blocks");
  const [groupBy, setGroupBy] = useState("source-type");
  const [expanded, setExpanded] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState("json");
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api
      .session()
      .then((value) => {
        if (active && value) setSession(value);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      active = false;
    };
  }, [api]);

  const items = useMemo(() => (report ? reportItems(report) : []), [report]);
  const selected = items.find((item) => item.id === selectedId) ?? items[0];
  useEffect(() => {
    if (items[0] && !items.some((item) => item.id === selectedId)) {
      setSelectedId(items[0].id);
    }
  }, [items, selectedId]);

  const showToast = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2_800);
  };

  const runScan = async () => {
    setScanning(true);
    setError("");
    setMoreOpen(false);
    try {
      const next = await api.scan({ agent, target, task });
      setReport(next);
      setSelectedId(next.sources[0]?.id ?? null);
      setInspectorOpen(true);
      showToast(`Real scan complete · ${next.sources.length} sources · ${next.scan.durationMs} ms`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setScanning(false);
    }
  };

  const exportReport = async () => {
    if (!report) return;
    setError("");
    try {
      const result = await api.exportReport(report, exportFormat);
      showToast(`Export ready${result.fileName ? ` · ${result.fileName}` : ""}`);
      setMoreOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  if (!report) return <EmptyState error={error} />;

  const repositoryCoverage = report.coverage.find((item) => item.area === "repository");
  const runtimeCoverage = report.coverage.find((item) => item.area === "runtime");
  const exportFormats = api.mode === "static" ? ["json"] : ["json", "sarif", "markdown", "html"];

  return (
    <main className={`app-shell ${inspectorOpen ? "with-inspector" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <IconSunHigh size={29} stroke={1.4} />
          <strong>Context Ray</strong>
        </div>
        <div className="context-field">
          <span>Repo</span>
          <strong className="context-value" title={session?.root ?? report.scan.root}>
            {session?.repoLabel ?? report.scan.root}
          </strong>
        </div>
        <label className="context-field agent-field">
          <span>Agent</span>
          <select
            value={agent}
            onChange={(event) => setAgent(event.target.value)}
            disabled={!api.supports.scan}
          >
            {(session?.agents ?? AGENTS).map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="context-field target-field">
          <span>Target</span>
          <select
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            disabled={!api.supports.scan}
          >
            {[...new Set([target, ...(session?.targets ?? [report.scan.target])])].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <div className="scan-meta">
          <span>
            {api.mode === "server"
              ? "Local API scan"
              : api.mode === "vscode"
                ? "VS Code scan"
                : "Static report"}
          </span>
          <strong>{formatScanLabel(report)}</strong>
        </div>
        <button className="run-button" onClick={runScan} disabled={scanning || !api.supports.scan}>
          {scanning ? <IconLoader2 className="spin" size={18} /> : <IconPlayerPlay size={18} />}
          {scanning ? "Scanning…" : api.supports.scan ? "Run scan" : "Read only"}
        </button>
        <button
          className="icon-button more-button"
          aria-label="Scan and export options"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((value) => !value)}
        >
          <IconSettings size={19} />
        </button>
        {moreOpen ? (
          <div className="settings-popover" role="dialog" aria-label="Scan and export options">
            <label>
              Task used for relevance
              <textarea
                value={task}
                onChange={(event) => setTask(event.target.value)}
                placeholder="Optional task description"
                disabled={!api.supports.scan}
              />
            </label>
            <small>
              Backend:{" "}
              {api.mode === "server"
                ? "loopback API"
                : api.mode === "vscode"
                  ? "VS Code extension host"
                  : "portable static report"}
            </small>
            <div className="export-row">
              <select
                value={exportFormat}
                onChange={(event) => setExportFormat(event.target.value)}
              >
                {exportFormats.map((format) => (
                  <option key={format} value={format}>
                    {format.toUpperCase()}
                  </option>
                ))}
              </select>
              <button onClick={exportReport}>
                <IconDownload size={15} /> Export
              </button>
            </div>
          </div>
        ) : null}
      </header>
      {error ? (
        <div className="error-banner" role="alert">
          <IconAlertTriangle size={16} /> {error}
        </div>
      ) : null}
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
              <i /> Repository {repositoryCoverage?.status ?? "unknown"}
            </span>
            <span>Runtime {runtimeCoverage?.status ?? "unknown"}</span>
          </div>
        </Metric>
        <Metric label="Evidence">
          <div className="estimate-lines">
            <span>{report.summary.activeSources} effective sources</span>
            <span>{report.findings.length} findings</span>
          </div>
        </Metric>
      </section>
      <div className="workspace">
        <section className="main-pane">
          <header className="section-heading composition-heading">
            <div>
              <strong>Context composition</strong>
              <span>(report {report.scan.id})</span>
              <IconInfoCircle size={14} />
            </div>
            <div className="chart-controls">
              <label>
                Group by:
                <select value={groupBy} onChange={(event) => setGroupBy(event.target.value)}>
                  <option value="source-type">Source type</option>
                  <option value="load-mode">Load mode</option>
                  <option value="relevance">Relevance</option>
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
            </div>
          </header>
          <CompositionChart
            report={report}
            groupBy={groupBy}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id);
              setInspectorOpen(true);
            }}
            showEstimates={showEstimates}
            view={view}
          />
          <SourcesTable
            report={report}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id);
              setInspectorOpen(true);
            }}
            expanded={expanded}
            onToggle={() => setExpanded((value) => !value)}
          />
        </section>
        {inspectorOpen && selected ? (
          <Inspector
            key={`${report.scan.id}-${selected.id}`}
            report={report}
            item={selected}
            api={api}
            onClose={() => setInspectorOpen(false)}
            onToast={showToast}
          />
        ) : null}
      </div>
      {toast ? (
        <div className="toast" role="status">
          <IconBolt size={16} /> {toast}
        </div>
      ) : null}
    </main>
  );
}
