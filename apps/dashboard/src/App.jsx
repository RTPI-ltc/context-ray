import { useEffect, useMemo, useRef, useState } from "react";
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
  compositionSegments,
  exportSuccessMessage,
  findingFilterCounts,
  findingsForFilter,
  formatScanLabel,
  initialItemId,
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

function Metric({
  label,
  value = null,
  tone = "default",
  suffix = null,
  children = null,
  onActivate = null,
  actionLabel = null,
}) {
  const content = (
    <>
      <div className="metric-label">
        {label} <IconInfoCircle size={14} stroke={1.7} />
      </div>
      {value !== null ? <div className={`metric-value ${tone}`}>{value}</div> : children}
      {suffix ? <div className="metric-suffix">{suffix}</div> : null}
    </>
  );
  return (
    <section className={`metric ${onActivate ? "interactive" : ""}`}>
      {onActivate ? (
        <button className="metric-action" onClick={onActivate} aria-label={actionLabel ?? label}>
          {content}
          <IconChevronRight className="metric-drill-icon" size={16} aria-hidden="true" />
        </button>
      ) : (
        content
      )}
    </section>
  );
}

function CompositionChart({ report, groupBy, selectedId, onSelect, showEstimates, view }) {
  const bands = buildBands(report, groupBy);
  const width = 1_000;
  const available = width - 20;
  const top = 8;
  const gap = 6;
  const bandHeight = view === "list" ? 62 : 80;
  const chartHeight = top + bands.length * (bandHeight + gap) + 18;
  const scaleMax = Math.max(
    1,
    report.summary.effectiveTokens,
    ...bands.map((band) => band.totalTokens),
  );
  const maxMetadataItems = Math.max(
    0,
    ...bands
      .filter((band) => band.name !== "Findings")
      .map((band) => band.items.filter((item) => item.tokenEstimate <= 0).length),
  );
  const metadataLaneWidth = maxMetadataItems
    ? Math.min(available * 0.24, Math.max(56, maxMetadataItems * 28))
    : 0;

  return (
    <div className="composition-svg-wrap">
      <svg
        className="composition-svg"
        viewBox={`0 0 ${width} ${chartHeight}`}
        role="group"
        aria-labelledby="composition-chart-title composition-chart-description"
      >
        <title id="composition-chart-title">Effective context grouped by {groupBy}</title>
        <desc id="composition-chart-description">
          Token-bearing sources use one linear scale from zero to {scaleMax} estimated tokens.
          Outlined blocks in a separate lane are zero-token records. Every report item is present.
        </desc>
        {bands.map((band, bandIndex) => {
          const y = top + bandIndex * (bandHeight + gap);
          const palette = PALETTES[bandIndex] ?? PALETTES[0];
          const segments =
            band.name === "Findings"
              ? band.items.map((item, index) => ({
                  item,
                  x: (available / Math.max(1, band.items.length)) * index,
                  width: available / Math.max(1, band.items.length),
                  scale: "count",
                }))
              : compositionSegments(band.items, scaleMax, available, metadataLaneWidth);
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
                {band.name} ({band.count}){band.name === "Findings" ? " · count" : ""}
              </text>
              <text x={width - 10} y={y + 20} textAnchor="end" className="band-total">
                {showEstimates
                  ? band.name === "Findings"
                    ? band.count
                    : compact(band.totalTokens)
                  : ""}
              </text>
              {segments.map(({ item, x: segmentX, width: segmentWidth, scale }) => {
                const x = 10 + segmentX;
                const selected = item.id === selectedId;
                const itemY = y + 28;
                const itemHeight = bandHeight - 36;
                const shortLabel =
                  item.label.length > 40 ? `${item.label.slice(0, 38)}…` : item.label;
                const select = (trigger) => onSelect(item.id, trigger);
                const clipId = `source-clip-${bandIndex}-${item.id.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}`;
                const metadata = scale === "metadata";
                return (
                  <g
                    key={item.id}
                    className="chart-source"
                    onClick={(event) => select(event.currentTarget)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        select(event.currentTarget);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-pressed={selected}
                    aria-label={`Inspect ${item.label}, ${item.tokenEstimate} estimated tokens${metadata ? ", zero-token record" : ""}`}
                  >
                    <title>
                      {item.label} · {item.tokenEstimate} estimated tokens
                    </title>
                    <Bar
                      x={x}
                      y={itemY}
                      width={Math.max(0, segmentWidth - 2)}
                      height={itemHeight}
                      fill={
                        metadata
                          ? "rgba(4,13,19,.08)"
                          : selected
                            ? palette.tint
                            : "rgba(4,13,19,.24)"
                      }
                      stroke={selected ? "#eef8ff" : palette.stroke}
                      strokeWidth={selected ? 1.5 : 0.8}
                      strokeDasharray={metadata ? "4 3" : undefined}
                    />
                    <rect
                      className="chart-hit-target"
                      x={x + segmentWidth / 2 - Math.max(24, segmentWidth) / 2}
                      y={itemY}
                      width={Math.max(24, segmentWidth)}
                      height={itemHeight}
                      fill="transparent"
                    />
                    <clipPath id={clipId}>
                      <rect
                        x={x + 2}
                        y={itemY + 1}
                        width={Math.max(0, segmentWidth - 6)}
                        height={itemHeight - 2}
                      />
                    </clipPath>
                    <g clipPath={`url(#${clipId})`}>
                      {item.itemType === "finding" && segmentWidth > 30 ? (
                        <IconAlertTriangle x={x + 8} y={itemY + 8} size={14} color="#ef7269" />
                      ) : null}
                      {segmentWidth > 54 ? (
                        <text
                          x={x + (item.itemType === "finding" ? 28 : 10)}
                          y={itemY + 14}
                          className="source-label"
                        >
                          {shortLabel}
                        </text>
                      ) : null}
                      {showEstimates && item.tokenEstimate > 0 && segmentWidth > 85 ? (
                        <text
                          x={x + segmentWidth - 10}
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
        <span>Linear token scale: 0–{compact(scaleMax)} estimated tokens</span>
        <span>Outlined right lane = zero-token records</span>
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

const FINDING_FILTERS = [
  ["all", "All"],
  ["error", "Errors"],
  ["warning", "Warnings"],
  ["note", "Notes"],
  ["conflict", "Conflicts"],
  ["actionable", "Removable"],
];

function FindingsQueue({ report, filter, onFilter, selectedId, onSelect, sectionRef }) {
  const counts = findingFilterCounts(report.findings);
  const findings = findingsForFilter(report.findings, filter);
  return (
    <section
      className="findings-section"
      id="findings"
      ref={sectionRef}
      tabIndex={-1}
      aria-labelledby="findings-heading"
    >
      <header className="section-heading findings-heading">
        <div>
          <strong id="findings-heading">Findings queue</strong>
          <span>({findings.length} shown from the current report)</span>
        </div>
        <div className="finding-filters" role="group" aria-label="Filter findings">
          {FINDING_FILTERS.map(([value, label]) => (
            <button
              key={value}
              className={filter === value ? "active" : ""}
              aria-pressed={filter === value}
              onClick={() => onFilter(value)}
            >
              {label} <span>{counts[value]}</span>
            </button>
          ))}
        </div>
      </header>
      {findings.length ? (
        <ol className="findings-list">
          {findings.map((finding) => {
            const id = `finding:${finding.id}`;
            const evidence = finding.evidence[0];
            return (
              <li key={finding.id}>
                <button
                  className={`finding-row severity-${finding.severity} ${selectedId === id ? "selected" : ""}`}
                  onClick={(event) => onSelect(id, event.currentTarget)}
                  aria-current={selectedId === id ? "true" : undefined}
                >
                  <span className="finding-severity">
                    <IconAlertTriangle size={16} aria-hidden="true" />
                    {finding.severity}
                  </span>
                  <span className="finding-summary">
                    <strong>{finding.title}</strong>
                    <small>{finding.message}</small>
                  </span>
                  <span className="finding-rule">
                    <b>{finding.ruleId}</b>
                    <small>
                      {evidence
                        ? `${evidence.path}${evidence.line ? `:${evidence.line}` : ""}`
                        : "No path evidence"}
                    </small>
                  </span>
                  <span className="finding-confidence">{finding.confidence} confidence</span>
                  <IconChevronRight className="finding-open" size={17} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="findings-empty" role="status">
          No findings match this filter in report {report.scan.id}.
        </div>
      )}
    </section>
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
      <div className="source-table-wrap">
        <table className="source-table">
          <caption className="sr-only">
            Token-bearing sources from the current report, sorted by estimated tokens
          </caption>
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col">Observed mode</th>
              <th scope="col" aria-sort="descending">
                Tokens (est.)
              </th>
              <th scope="col">Relevance</th>
              <th scope="col">Backend recommendation</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((source) => {
              const recommendation = recommendationForSource(report, source.id);
              const loadMode = loadModeForSource(source);
              return (
                <tr className={source.id === selectedId ? "selected" : ""} key={source.id}>
                  <th scope="row" data-label="Source">
                    <button
                      className="source-select"
                      onClick={(event) => onSelect(source.id, event.currentTarget)}
                      aria-current={source.id === selectedId ? "true" : undefined}
                    >
                      <span className="source-cell">
                        {sourceIcon(source)}
                        <span>{source.label}</span>
                      </span>
                      <IconChevronRight size={16} aria-hidden="true" />
                    </button>
                  </th>
                  <td data-label="Observed mode">
                    <em className={`mode ${loadMode.toLowerCase()}`}>{loadMode}</em>
                  </td>
                  <td data-label="Tokens (est.)" className="token-cell">
                    {compact(source.tokenEstimate)}
                  </td>
                  <td data-label="Relevance">
                    <Relevance value={source.relevance} />
                  </td>
                  <td data-label="Recommendation" className="recommendation-cell">
                    <b>{recommendation.title}</b>
                    <small>
                      {recommendation.savings > 0
                        ? `Est. save ${compact(recommendation.savings)}`
                        : "No savings estimate"}
                    </small>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
  const inspectorRef = useRef(null);
  const closeButtonRef = useRef(null);
  const [isModal, setIsModal] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.("(max-width: 980px)").matches,
  );
  const observedMode = item.itemType === "source" ? loadModeForSource(item) : "Eager";
  const [scenario, setScenario] = useState(
    observedMode === "Eager" ? "eager" : observedMode === "On-demand" ? "on-demand" : "",
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

  useEffect(() => {
    const query = window.matchMedia?.("(max-width: 980px)");
    if (!query) return undefined;
    const update = () => {
      setIsModal(query.matches);
      if (query.matches) closeButtonRef.current?.focus();
    };
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);

  const project = async (event) => {
    const mode = event.target.value;
    setScenario(mode);
    setProjection(null);
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
    <aside
      ref={inspectorRef}
      className="inspector"
      role={isModal ? "dialog" : undefined}
      aria-modal={isModal ? "true" : undefined}
      aria-label={`Inspector for ${item.label}`}
      aria-busy={busy}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
          return;
        }
        if (event.key === "Tab" && isModal) {
          const focusable = [
            ...(inspectorRef.current?.querySelectorAll(
              'button:not([disabled]), select:not([disabled]), textarea:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
            ) ?? []),
          ].filter((element) => element.getAttribute("aria-hidden") !== "true");
          const first = focusable[0];
          const last = focusable.at(-1);
          if (!first || !last) {
            event.preventDefault();
          } else if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }}
    >
      <div className="inspector-scroll">
        <header className="inspector-title">
          <div className="inspector-source-icon">{sourceIcon(item, 25)}</div>
          <h2>
            {item.label}
            <span>{item.path}</span>
          </h2>
          <button
            ref={closeButtonRef}
            className="icon-button"
            aria-label="Close inspector"
            onClick={onClose}
          >
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
        {item.itemType === "source" && item.tokenEstimate > 0 ? (
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
                {scenario === "" ? (
                  <option value="" disabled>
                    Choose scenario…
                  </option>
                ) : null}
                <option value="eager">Eager</option>
                <option value="progressive">Progressive</option>
                <option value="on-demand">On-demand</option>
              </select>
              <IconChevronDown size={16} />
            </div>
            <small>Observed: {observedMode} · this control runs analysis, not a config write</small>
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
              <header>
                <strong>
                  {preview.path}:{preview.startLine}–{preview.endLine}
                </strong>
                {preview.truncated ? <span>Excerpt truncated by preview limits</span> : null}
              </header>
              {preview.note ? <p>{preview.note}</p> : null}
              <pre>{preview.content}</pre>
            </div>
          ) : null}
          {localError ? (
            <p className="inline-error" role="alert">
              {localError}
            </p>
          ) : null}
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
  const [selectedId, setSelectedId] = useState(injected ? initialItemId(injected) : null);
  const [inspectorOpen, setInspectorOpen] = useState(Boolean(injected));
  const [showEstimates, setShowEstimates] = useState(true);
  const [view, setView] = useState("blocks");
  const [groupBy, setGroupBy] = useState("source-type");
  const [findingFilter, setFindingFilter] = useState("all");
  const [expanded, setExpanded] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState("json");
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const findingsRef = useRef(null);
  const lastInspectorTriggerRef = useRef(null);
  const toastTimerRef = useRef(null);

  const showToast = (message) => {
    window.clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = window.setTimeout(() => setToast(""), 2_800);
  };

  useEffect(
    () => () => {
      window.clearTimeout(toastTimerRef.current);
    },
    [],
  );

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

  useEffect(
    () =>
      api.subscribeReport((next, nextRuntime) => {
        const nextSelectedId = initialItemId(next);
        setReport(next);
        if (nextRuntime) setSession(nextRuntime);
        setAgent(next.scan.agent);
        setTarget(next.scan.target);
        setTask(next.scan.task ?? "");
        setSelectedId(nextSelectedId);
        setInspectorOpen(Boolean(nextSelectedId));
        setFindingFilter("all");
        setError("");
        showToast(`Report refreshed by VS Code · ${next.scan.durationMs} ms`);
      }),
    [api],
  );

  const items = useMemo(() => (report ? reportItems(report) : []), [report]);
  const fallbackSelectedId = report ? initialItemId(report) : null;
  const selected =
    items.find((item) => item.id === selectedId) ??
    items.find((item) => item.id === fallbackSelectedId) ??
    items[0];
  useEffect(() => {
    if (fallbackSelectedId && !items.some((item) => item.id === selectedId)) {
      setSelectedId(fallbackSelectedId);
    }
  }, [fallbackSelectedId, items, selectedId]);

  const selectItem = (id, trigger = null) => {
    if (trigger && typeof trigger.focus === "function") lastInspectorTriggerRef.current = trigger;
    setSelectedId(id);
    setInspectorOpen(true);
  };

  const closeInspector = () => {
    setInspectorOpen(false);
    window.requestAnimationFrame(() => lastInspectorTriggerRef.current?.focus());
  };

  const drillIntoFindings = (filter) => {
    setFindingFilter(filter);
    window.requestAnimationFrame(() => {
      findingsRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
      findingsRef.current?.focus({ preventScroll: true });
    });
  };

  const inspectLargestSource = (predicate = () => true) => {
    const source = [...report.sources]
      .filter(predicate)
      .sort((left, right) => right.tokenEstimate - left.tokenEstimate)[0];
    if (source) selectItem(source.id, document.activeElement);
  };

  const runScan = async () => {
    setScanning(true);
    setError("");
    setMoreOpen(false);
    try {
      const next = await api.scan({ agent, target, task });
      setReport(next);
      const nextSelectedId = initialItemId(next);
      setSelectedId(nextSelectedId);
      setInspectorOpen(Boolean(nextSelectedId));
      setFindingFilter("all");
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
      const successMessage = exportSuccessMessage(result);
      if (!successMessage) {
        setMoreOpen(false);
        return;
      }
      showToast(successMessage);
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
          onActivate={() => inspectLargestSource()}
          actionLabel="Inspect the largest startup context source"
        />
        <Metric
          label="Tool schemas"
          value={compact(report.summary.toolSchemaTokens)}
          suffix="tokens (est.)"
          onActivate={() =>
            inspectLargestSource((source) =>
              ["mcp-tool", "mcp-server", "mcp-config"].includes(source.kind),
            )
          }
          actionLabel="Inspect the largest MCP tool schema source"
        />
        <Metric
          label="Potentially removable"
          value={compact(report.summary.potentialWasteTokens)}
          tone="amber"
          suffix="tokens (est.)"
          onActivate={() => drillIntoFindings("actionable")}
          actionLabel="Show findings with estimated removable tokens"
        />
        <Metric
          label="Conflicts"
          value={String(report.summary.conflicts)}
          tone="red"
          suffix="detected"
          onActivate={() => drillIntoFindings("conflict")}
          actionLabel="Show conflict findings"
        />
        <Metric label="Coverage">
          <div className="coverage-lines">
            <span>
              <i /> Repository {repositoryCoverage?.status ?? "unknown"}
            </span>
            <span>Runtime {runtimeCoverage?.status ?? "unknown"}</span>
          </div>
        </Metric>
        <Metric
          label="Evidence"
          onActivate={() => drillIntoFindings("all")}
          actionLabel="Show all findings from the current report"
        >
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
              <div className="view-toggle" role="group" aria-label="Composition density">
                <button
                  className={view === "blocks" ? "active" : ""}
                  onClick={() => setView("blocks")}
                  aria-label="Block view"
                  aria-pressed={view === "blocks"}
                >
                  <IconTable size={16} />
                </button>
                <button
                  className={view === "list" ? "active" : ""}
                  onClick={() => setView("list")}
                  aria-label="Compact view"
                  aria-pressed={view === "list"}
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
            onSelect={selectItem}
            showEstimates={showEstimates}
            view={view}
          />
          <FindingsQueue
            report={report}
            filter={findingFilter}
            onFilter={setFindingFilter}
            selectedId={selectedId}
            onSelect={selectItem}
            sectionRef={findingsRef}
          />
          <SourcesTable
            report={report}
            selectedId={selectedId}
            onSelect={selectItem}
            expanded={expanded}
            onToggle={() => setExpanded((value) => !value)}
          />
        </section>
        {inspectorOpen && selected ? (
          <>
            <button
              className="inspector-backdrop"
              aria-label="Close inspector"
              onClick={closeInspector}
            />
            <Inspector
              key={`${report.scan.id}-${selected.id}`}
              report={report}
              item={selected}
              api={api}
              onClose={closeInspector}
              onToast={showToast}
            />
          </>
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
