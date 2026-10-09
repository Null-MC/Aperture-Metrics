import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { useMetricsSocket } from "./useMetricsSocket";
import { useSimulatedMetrics } from "./useSimulatedMetrics";
import type { MetricEntry } from "./types";
import "./styles.css";

type ThemeMode = "dark" | "light";
type MetricMode = "gpuMs" | "cpuMs";
type SortKey = "name" | "gpu" | "cpu";
type ChartMode = "lines" | "stacked" | "frame";
type StageGroup = {
  key: string;
  label: string;
  color: string;
  entries: Array<MetricEntry & { key: string }>;
};
type Sample = {
  time: number;
  values: Record<string, { gpuMs: number; cpuMs: number }>;
  smoothed: Record<string, { gpuMs: number; cpuMs: number }>;
};
type SortState = { key: SortKey; direction: 1 | -1 };

const HISTORY_WINDOW_MS = 30_000;
const HISTORY_LIMIT = 301;
const WIDTH = 1000;
const HEIGHT = 460;
const THEME_KEY = "aperture-metrics-viewer-theme";
const PINNED_KEY = "aperture-metrics-viewer-pinned";
const COLLAPSED_KEY = "aperture-metrics-viewer-collapsed";
const SORT_KEY = "aperture-metrics-viewer-sort";
const SMOOTH_KEY = "aperture-metrics-viewer-smooth";
const CHART_KEY = "aperture-metrics-viewer-chart";
const CHART_METRIC_KEY = "aperture-metrics-viewer-chart-metric";
const CHART_MODE_KEY = "aperture-metrics-viewer-chart-mode";

function readStored<T>(key: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function readTheme(): ThemeMode {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    return value === "light" || value === JSON.stringify("light") ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function isLocalHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function formatMs(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : "0.000";
}

function formatGameTime(value: number | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : value.toLocaleString();
}

function hashHue(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % 360;
}

function programColor(key: string): string {
  return `hsl(${hashHue(key)} 64% 58%)`;
}

function stageColor(index: number): string {
  return `hsl(${(index * 43 + 28) % 360} 66% 56%)`;
}

function entryKey(entry: MetricEntry): string {
  return `${entry.stage?.trim() || "OTHER"}::${entry.name.trim() || "Unnamed"}`;
}

function groupEntries(entries: MetricEntry[]): StageGroup[] {
  const groups = new Map<string, StageGroup>();
  for (const entry of entries) {
    const key = entry.stage?.trim() || "OTHER";
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        label: entry.stageLabel?.trim() || "Other",
        color: stageColor(groups.size),
        entries: [],
      };
      groups.set(key, group);
    }
    group.entries.push({ ...entry, key: entryKey(entry) });
  }
  return [...groups.values()];
}

function Sparkline({ samples, seriesKey, metric, color, label, smooth }: {
  samples: Sample[];
  seriesKey: string[];
  metric: MetricMode;
  color: string;
  label: string;
  smooth: boolean;
}) {
  const values = samples.slice(-100).map((sample) =>
    seriesKey.reduce((sum, key) => sum + ((smooth ? sample.smoothed : sample.values)[key]?.[metric] ?? 0), 0),
  );
  const max = Math.max(...values, 0.001);
  const points = values.map((value, index) => {
    const x = values.length < 2 ? 0 : (index / (values.length - 1)) * 100;
    const y = 27 - (value / max) * 23;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg className="sparkline" viewBox="0 0 100 30" role="img" aria-label={`${label} recent ${metric === "gpuMs" ? "GPU" : "CPU"} time`}>
      {values.length > 0 && <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

function App() {
  const localHost = typeof window !== "undefined" && isLocalHost(window.location.hostname);
  const simulated = import.meta.env.DEV && localHost && import.meta.env.VITE_APERTURE_SIMULATE === "true";
  const socket = useMetricsSocket(!simulated);
  const simulatedMetrics = useSimulatedMetrics(simulated);
  const feed = simulatedMetrics ?? socket;
  const { connected, session, shaderName, latestFrame, error } = feed;

  const [theme, setTheme] = useState<ThemeMode>(readTheme);
  const [chartEnabled, setChartEnabled] = useState(() => readStored(CHART_KEY, true));
  const [smooth, setSmooth] = useState(() => readStored(SMOOTH_KEY, true));
  const [chartMetric, setChartMetric] = useState<MetricMode>(() => readStored(CHART_METRIC_KEY, "gpuMs") === "cpuMs" ? "cpuMs" : "gpuMs");
  const [chartMode, setChartMode] = useState<ChartMode>(() => {
    const mode = readStored(CHART_MODE_KEY, "lines");
    return mode === "stacked" || mode === "frame" ? mode : "lines";
  });
  const [sort, setSort] = useState<SortState>(() => {
    const stored = readStored<SortState>(SORT_KEY, { key: "gpu", direction: 1 });
    return ["name", "gpu", "cpu"].includes(stored.key) ? stored : { key: "gpu", direction: 1 };
  });
  const [collapsedStages, setCollapsedStages] = useState<Record<string, boolean>>(() => readStored(COLLAPSED_KEY, {}));
  const [pinned, setPinned] = useState<Set<string>>(() => new Set(readStored<string[]>(PINNED_KEY, [])));
  const [isolated, setIsolated] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<Sample[]>([]);
  const [fps, setFps] = useState<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const lastFrameRef = useRef<{ frame: number; at: number } | null>(null);
  const lastSampleAtRef = useRef(0);
  const emaRef = useRef<Record<string, { gpuMs: number; cpuMs: number }>>({});
  const simulationSeededRef = useRef(false);

  useEffect(() => { window.localStorage.setItem(THEME_KEY, theme); }, [theme]);
  useEffect(() => { window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsedStages)); }, [collapsedStages]);
  useEffect(() => { window.localStorage.setItem(PINNED_KEY, JSON.stringify([...pinned])); }, [pinned]);
  useEffect(() => { window.localStorage.setItem(SORT_KEY, JSON.stringify(sort)); }, [sort]);
  useEffect(() => { window.localStorage.setItem(SMOOTH_KEY, JSON.stringify(smooth)); }, [smooth]);
  useEffect(() => { window.localStorage.setItem(CHART_KEY, JSON.stringify(chartEnabled)); }, [chartEnabled]);
  useEffect(() => { window.localStorage.setItem(CHART_METRIC_KEY, JSON.stringify(chartMetric)); }, [chartMetric]);
  useEffect(() => { window.localStorage.setItem(CHART_MODE_KEY, JSON.stringify(chartMode)); }, [chartMode]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!latestFrame) return;
    const now = Date.now();
    const previousFrame = lastFrameRef.current;
    if (previousFrame && latestFrame.frame >= previousFrame.frame && now > previousFrame.at) {
      setFps(((latestFrame.frame - previousFrame.frame) * 1000) / (now - previousFrame.at));
    }
    lastFrameRef.current = { frame: latestFrame.frame, at: now };

    if (now - lastSampleAtRef.current < 90) return;
    lastSampleAtRef.current = now;
    const values: Sample["values"] = {};
    for (const entry of latestFrame.entries) {
      values[entryKey(entry)] = {
        gpuMs: Number.isFinite(entry.gpuMs) ? Math.max(0, entry.gpuMs) : 0,
        cpuMs: Number.isFinite(entry.cpuMs) ? Math.max(0, entry.cpuMs) : 0,
      };
    }
    if (simulated && !simulationSeededRef.current) {
      simulationSeededRef.current = true;
      const seed = Array.from({ length: 101 }, (_, index) => {
        const time = now - (100 - index) * 300;
        const seededValues: Sample["values"] = {};
        for (const [key, value] of Object.entries(values)) {
          const phase = (hashHue(key) * Math.PI) / 180;
          const wave = 0.92 + Math.sin(index * 0.08 + phase) * 0.07 + Math.sin(index * 0.21 + phase * 2) * 0.025;
          seededValues[key] = { gpuMs: value.gpuMs * wave, cpuMs: value.cpuMs * (0.98 + Math.sin(index * 0.1 + phase) * 0.025) };
        }
        return { time, values: seededValues, smoothed: seededValues };
      });
      emaRef.current = seed[seed.length - 1].smoothed;
      setHistory(seed);
    }
    const smoothed: Sample["smoothed"] = {};
    for (const [key, value] of Object.entries(values)) {
      const previous = emaRef.current[key] ?? value;
      smoothed[key] = {
        gpuMs: previous.gpuMs * 0.82 + value.gpuMs * 0.18,
        cpuMs: previous.cpuMs * 0.82 + value.cpuMs * 0.18,
      };
    }
    emaRef.current = smoothed;
    setHistory((previous) => [...previous, { time: now, values, smoothed }]
      .filter((sample) => now - sample.time <= HISTORY_WINDOW_MS)
      .slice(-HISTORY_LIMIT));
  }, [latestFrame, simulated]);

  const groups = useMemo(() => groupEntries(latestFrame?.entries ?? []), [latestFrame]);
  const entries = useMemo(() => groups.flatMap((group) => group.entries), [groups]);
  const latestSmoothed = history.length ? history[history.length - 1].smoothed : {};
  const currentValue = (entry: MetricEntry & { key: string }, metric: MetricMode) =>
    smooth ? latestSmoothed[entry.key]?.[metric] ?? entry[metric] : entry[metric];
  const totals = useMemo(() => entries.reduce((sum, entry) => ({
    gpu: sum.gpu + (Number.isFinite(currentValue(entry, "gpuMs")) ? currentValue(entry, "gpuMs") : 0),
    cpu: sum.cpu + (Number.isFinite(currentValue(entry, "cpuMs")) ? currentValue(entry, "cpuMs") : 0),
  }), { gpu: 0, cpu: 0 }), [entries, history, smooth]);

  const compareEntries = (left: StageGroup["entries"][number], right: StageGroup["entries"][number]) => {
    if (sort.key === "name") {
      return sort.direction * left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    }
    const a = sort.key === "gpu" ? left.gpuMs : left.cpuMs;
    const b = sort.key === "gpu" ? right.gpuMs : right.cpuMs;
    return sort.direction * (b - a);
  };
  const sortedGroups = groups.map((group) => ({
    ...group,
    entries: [...group.entries].sort(compareEntries),
  }));
  const visibleEntries = sortedGroups
    .filter((group) => !collapsedStages[group.key])
    .flatMap((group) => group.entries);
  const chartEntries = isolated.size
    ? visibleEntries.filter((entry) => isolated.has(entry.key))
    : visibleEntries;
  const pinnedEntries = entries.filter((entry) => pinned.has(entry.key)).sort(compareEntries);

  const chart = useMemo(() => {
    if (!history.length) return null;
    const now = history[history.length - 1].time;
    const start = now - HISTORY_WINDOW_MS;
    const samples = history.filter((sample) => sample.time >= start);
    const selected = chartMode === "lines"
      ? chartEntries.map((entry) => ({ key: entry.key, name: entry.name, color: programColor(entry.key), entries: [entry.key] }))
      : groups
        .map((group) => ({
          key: group.key,
          name: group.label,
          color: group.color,
          entries: group.entries.filter((entry) => chartEntries.some((visible) => visible.key === entry.key)).map((entry) => entry.key),
        }))
        .filter((series) => series.entries.length > 0);
    const metric = chartMetric;
    const series = selected.map((item) => ({
      ...item,
      values: samples.map((sample) => item.entries.reduce((sum, key) => sum + ((smooth ? sample.smoothed : sample.values)[key]?.[metric] ?? 0), 0)),
    }));
    const scaleTop = Math.max(0.1, ...samples.map((sample) =>
      chartMode === "stacked" || chartMode === "frame"
        ? selected.reduce((sum, item) => sum + item.entries.reduce((subtotal, key) => subtotal + (sample.values[key]?.[metric] ?? 0), 0), 0)
        : Math.max(0, ...selected.map((item) => item.entries.reduce((sum, key) => sum + (sample.values[key]?.[metric] ?? 0), 0))),
    )) * 1.08;
    return { samples, series, start, end: now, scaleTop };
  }, [chartEntries, chartMetric, chartMode, groups, history, smooth]);

  const toggleIsolated = (key: string, additive: boolean) => {
    setIsolated((current) => {
      if (!additive) return current.size === 1 && current.has(key) ? new Set() : new Set([key]);
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setIsolated(new Set());
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const sortedHeader = (key: SortKey, label: string, numeric = false) => (
    <button
      type="button"
      className={`sort-header${sort.key === key ? " active" : ""}${numeric ? " numeric" : ""}`}
      onClick={() => setSort((current) => ({ key, direction: current.key === key ? (current.direction === 1 ? -1 : 1) : 1 }))}
      aria-label={`Sort by ${label}`}
    >
      {numeric && sort.key === key ? (sort.direction === 1 ? "↓ " : "↑ ") : null}{label}
      {!numeric && sort.key === key ? (sort.direction === 1 ? " ↑" : " ↓") : null}
    </button>
  );

  const toggleStage = (key: string) => setCollapsedStages((current) => ({ ...current, [key]: !current[key] }));
  const togglePin = (key: string) => setPinned((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  const renderEntry = (entry: StageGroup["entries"][number], inPinned = false) => {
    const color = programColor(entry.key);
    const faded = isolated.size > 0 && !isolated.has(entry.key);
    const handleKey = (event: KeyboardEvent<HTMLTableRowElement>) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleIsolated(entry.key, event.shiftKey || event.ctrlKey || event.metaKey);
      }
    };
    return (
      <tr
        key={`${inPinned ? "pin-" : ""}${entry.key}`}
        className={`program-row${pinned.has(entry.key) ? " pinned" : ""}${isolated.has(entry.key) ? " isolated" : ""}${faded ? " faded" : ""}`}
        onClick={(event) => toggleIsolated(entry.key, event.shiftKey || event.ctrlKey || event.metaKey)}
        onKeyDown={handleKey}
        tabIndex={0}
        title="Click to isolate in chart · Shift-click to select multiple"
      >
        <td className="name-cell">
          <button
            type="button"
            className={`pin-button${pinned.has(entry.key) ? " selected" : ""}`}
            onClick={(event) => { event.stopPropagation(); togglePin(entry.key); }}
            aria-label={pinned.has(entry.key) ? `Unpin ${entry.name}` : `Pin ${entry.name}`}
            title={pinned.has(entry.key) ? "Unpin program" : "Pin program"}
          >{pinned.has(entry.key) ? "◆" : "⌖"}</button>
          <i className="program-dot" style={{ backgroundColor: color }} />
          <span className="program-name">{entry.name || "Unnamed"}</span>
          {inPinned && <span className="stage-tag">{entry.stageLabel || entry.stage || "Other"}</span>}
        </td>
        <td className="spark-cell"><Sparkline samples={history} seriesKey={[entry.key]} metric={chartMetric} color={color} label={entry.name} smooth={smooth} /></td>
        <td className="number-cell">{formatMs(currentValue(entry, "gpuMs"))}</td>
        <td className="number-cell muted-number">{formatMs(currentValue(entry, "cpuMs"))}</td>
      </tr>
    );
  };

  const chartPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!chart || !chart.samples.length) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const time = chart.start + ratio * HISTORY_WINDOW_MS;
    let closest = 0;
    for (let index = 1; index < chart.samples.length; index += 1) {
      if (Math.abs(chart.samples[index].time - time) < Math.abs(chart.samples[closest].time - time)) closest = index;
    }
    setHoverIndex(closest);
  };

  const linePoints = (values: number[]) => values.map((value, index) => {
    const x = chart && chart.samples.length > 1
      ? ((chart.samples[index].time - chart.start) / HISTORY_WINDOW_MS) * WIDTH
      : 0;
    const y = HEIGHT - (value / (chart?.scaleTop ?? 1)) * HEIGHT;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  const chartAreaPaths = useMemo(() => {
    if (!chart) return [];
    const baseline = chart.samples.map(() => 0);
    return chart.series.map((series) => {
      const lower = [...baseline];
      const upper = series.values.map((value, index) => {
        baseline[index] += value;
        return baseline[index];
      });
      const upperPoints = upper.map((value, index) => {
        const x = chart.samples.length > 1 ? ((chart.samples[index].time - chart.start) / HISTORY_WINDOW_MS) * WIDTH : 0;
        return `${x.toFixed(1)},${(HEIGHT - (value / chart.scaleTop) * HEIGHT).toFixed(1)}`;
      });
      const lowerPoints = lower.map((value, index) => {
        const x = chart.samples.length > 1 ? ((chart.samples[index].time - chart.start) / HISTORY_WINDOW_MS) * WIDTH : 0;
        return `${x.toFixed(1)},${(HEIGHT - (value / chart.scaleTop) * HEIGHT).toFixed(1)}`;
      }).reverse();
      return { ...series, path: `M ${upperPoints.join(" L ")} L ${lowerPoints.join(" L ")} Z` };
    });
  }, [chart]);

  const frameBars = groups.map((group) => ({
    ...group,
    total: group.entries.reduce((sum, entry) => sum + currentValue(entry, chartMetric), 0),
  }));
  const frameTotal = frameBars.reduce((sum, group) => sum + group.total, 0) || 1;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><i className="brand-mark" /><span>Aperture</span><small>metrics</small></div>
        <div className={`session-chip${connected ? " live" : " offline"}`} title={`Session: ${session ?? "unknown"}`}>
          <i className="status-dot" /><span>{simulated ? "SIMULATED" : connected ? shaderName || "Connected" : "Disconnected"}</span>
        </div>
        <div className="toolbar-spacer" />
        <div className="kpi" title="Total GPU time across programs"><b>{formatMs(totals.gpu)}</b><span>ms GPU</span></div>
        <div className="kpi optional-kpi" title="Total CPU time across programs"><b>{formatMs(totals.cpu)}</b><span>ms CPU</span></div>
        <div className="kpi" title="Estimated frames per second"><b>{fps == null ? "—" : Math.round(fps)}</b><span>fps</span></div>
        <button type="button" className={`toolbar-toggle${smooth ? " on" : ""}`} onClick={() => setSmooth((current) => !current)} title="Toggle exponential smoothing" aria-pressed={smooth}>
          <i />Smooth
        </button>
        <button type="button" className={`icon-button${chartEnabled ? " selected" : ""}`} onClick={() => setChartEnabled((current) => !current)} title={chartEnabled ? "Hide chart" : "Show chart"} aria-label={chartEnabled ? "Hide chart" : "Show chart"}>⌁</button>
        <button type="button" className="icon-button" onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")} title="Toggle theme" aria-label="Toggle theme">{theme === "dark" ? "☾" : "☼"}</button>
      </header>

      {!connected && (
        <div className="connection-banner" role="status">
          <i className="banner-spinner" /> Lost connection to Aperture. Retrying every second…
          {error && <code>{error}</code>}
        </div>
      )}

      <div className={`workspace${chartEnabled ? " with-chart" : ""}${!connected && entries.length ? " disconnected" : ""}`}>
        <section className="pane table-pane" aria-label="Program metrics">
          <div className="pane-header">
            <span className="pane-title">Programs</span>
            <span className="pane-subtitle">{entries.length} in {groups.length} stages{pinned.size ? ` · ${pinned.size} pinned` : ""}</span>
            <div className="toolbar-spacer" />
            {isolated.size > 0 && <button type="button" className="clear-isolation" onClick={() => setIsolated(new Set())}>Clear selection ×</button>}
            <button
              type="button"
              className="icon-button subtle"
              onClick={() => {
                const shouldCollapse = groups.some((group) => !collapsedStages[group.key]);
                setCollapsedStages(Object.fromEntries(groups.map((group) => [group.key, shouldCollapse])));
              }}
              title={groups.every((group) => collapsedStages[group.key]) ? "Expand all stages" : "Collapse all stages"}
              aria-label={groups.every((group) => collapsedStages[group.key]) ? "Expand all stages" : "Collapse all stages"}
            >⌄</button>
          </div>
          <div className="table-scroll">
            <table className="metrics-table">
              <thead>
                <tr>
                  <th>{sortedHeader("name", "Program")}</th>
                  <th className="spark-heading">{chartMetric === "gpuMs" ? "GPU" : "CPU"} 10s</th>
                  <th>{sortedHeader("gpu", "GPU ms", true)}</th>
                  <th>{sortedHeader("cpu", "CPU ms", true)}</th>
                </tr>
              </thead>
              <tbody>
                {pinnedEntries.length > 0 && (
                  <Fragment>
                    <tr className="stage-row pinned-stage">
                      <th colSpan={4}>
                        <button type="button" onClick={() => toggleStage("__pinned")} aria-expanded={!collapsedStages.__pinned}>
                          <span className={`caret${collapsedStages.__pinned ? " collapsed" : ""}`}>⌄</span>
                          <i className="stage-swatch" />
                          <span>Pinned</span>
                          <small>{pinnedEntries.length}</small>
                        </button>
                      </th>
                    </tr>
                    {!collapsedStages.__pinned && pinnedEntries.map((entry) => renderEntry(entry, true))}
                  </Fragment>
                )}
                {sortedGroups.map((group) => {
                  const collapsed = Boolean(collapsedStages[group.key]);
                  const stageGpu = group.entries.reduce((sum, entry) => sum + currentValue(entry, "gpuMs"), 0);
                  const stageCpu = group.entries.reduce((sum, entry) => sum + currentValue(entry, "cpuMs"), 0);
                  return (
                    <Fragment key={group.key}>
                      <tr className="stage-row">
                        <th colSpan={2}>
                          <button type="button" onClick={() => toggleStage(group.key)} aria-expanded={!collapsed}>
                            <span className={`caret${collapsed ? " collapsed" : ""}`}>⌄</span>
                            <i className="stage-swatch" style={{ backgroundColor: group.color }} />
                            <span>{group.label}</span>
                            <small>{group.entries.length}</small>
                          </button>
                        </th>
                        <td className="number-cell stage-total">{formatMs(stageGpu)}</td>
                        <td className="number-cell stage-total muted-number">{formatMs(stageCpu)}</td>
                      </tr>
                      {!collapsed && group.entries.map((entry) => renderEntry(entry))}
                    </Fragment>
                  );
                })}
                {entries.length === 0 && (
                  <tr><td className="empty-state" colSpan={4}>{connected ? "Waiting for metrics…" : "Waiting for Aperture to reconnect…"}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <footer className="table-footer">
            <span>Frame <b>{latestFrame?.frame.toLocaleString() ?? "—"}</b></span>
            <span>Game time <b>{formatGameTime(latestFrame?.gameTimeNs)} ns</b></span>
            <span>Session <b>{session ?? "—"}</b></span>
          </footer>
        </section>

        {chartEnabled && (
          <section className="pane chart-pane" aria-label="Metrics charts">
            <div className="pane-header chart-controls">
              <div className="segmented" role="group" aria-label="Chart visualization">
                {(["lines", "stacked", "frame"] as const).map((mode) => (
                  <button key={mode} type="button" className={chartMode === mode ? "active" : ""} onClick={() => { setChartMode(mode); setHoverIndex(null); }}>
                    {mode === "frame" ? "Frame" : mode === "stacked" ? "Stacked" : "Lines"}
                  </button>
                ))}
              </div>
              {chartMode === "stacked" && <span className="pane-subtitle">By stage</span>}
              {isolated.size > 0 && <span className="selection-chip">{isolated.size === 1 ? [...isolated][0].split("::").pop() : `${isolated.size} programs`}</span>}
              <div className="toolbar-spacer" />
              <div className="segmented metric-segment" role="group" aria-label="Chart metric">
                <button type="button" className={chartMetric === "gpuMs" ? "active" : ""} onClick={() => setChartMetric("gpuMs")}>GPU</button>
                <button type="button" className={chartMetric === "cpuMs" ? "active" : ""} onClick={() => setChartMetric("cpuMs")}>CPU</button>
              </div>
            </div>
            <div className="chart-body">
              {chartMode === "frame" && (
                <div className="frame-breakdown" aria-label="Current frame stage breakdown">
                  <div className="breakdown-caption">CURRENT FRAME · {chartMetric === "gpuMs" ? "GPU" : "CPU"} SHARE</div>
                  <div className="breakdown-bar">
                    {frameBars.map((group) => (
                      <div key={group.key} className="breakdown-segment" style={{ flexGrow: group.total, backgroundColor: group.color }} title={`${group.label} ${formatMs(group.total)} ms`}>
                        {group.total / frameTotal > 0.06 && <span>{group.label}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {!chart || chart.samples.length === 0 ? (
                <div className="chart-empty">{connected ? "Collecting samples for the chart…" : "Chart will resume when the connection returns."}</div>
              ) : chart.series.length === 0 ? (
                <div className="chart-empty">Expand a stage or clear the selection to show chart series.</div>
              ) : (
                <svg
                  className="metrics-chart"
                  viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                  role="img"
                  aria-label={`${chartMetric === "gpuMs" ? "GPU" : "CPU"} metrics over the last 30 seconds`}
                  onPointerMove={chartPointerMove}
                  onPointerLeave={() => setHoverIndex(null)}
                >
                  {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
                    const y = HEIGHT - fraction * HEIGHT;
                    const value = (chart.scaleTop * fraction);
                    return (
                      <g key={fraction}>
                        <line className="chart-grid" x1="0" x2={WIDTH} y1={y} y2={y} />
                        <text className="chart-axis" x="2" y={y - 5}>{formatMs(value)}</text>
                      </g>
                    );
                  })}
                  {chartMode === "lines" && chart.series.map((series) => (
                    <polyline key={series.key} points={linePoints(series.values)} fill="none" stroke={series.color} strokeWidth={isolated.has(series.key) ? 2.6 : 1.7} vectorEffect="non-scaling-stroke">
                      <title>{series.name}</title>
                    </polyline>
                  ))}
                  {chartMode !== "lines" && chartAreaPaths?.map((series) => (
                    <path key={series.key} d={series.path} fill={series.color} fillOpacity="0.64" stroke={series.color} strokeWidth="1" vectorEffect="non-scaling-stroke">
                      <title>{series.name}</title>
                    </path>
                  ))}
                  {[30, 20, 10, 0].map((seconds) => (
                    <text key={seconds} className="chart-axis time-axis" x={(1 - seconds / 30) * WIDTH} y={HEIGHT - 5} textAnchor={seconds === 30 ? "start" : seconds === 0 ? "end" : "middle"}>
                      {seconds === 0 ? "now" : `-${seconds}s`}
                    </text>
                  ))}
                  {hoverIndex != null && chart.samples[hoverIndex] && (() => {
                    const x = ((chart.samples[hoverIndex].time - chart.start) / HISTORY_WINDOW_MS) * WIDTH;
                    const lines = chart.series.map((series) => ({
                      ...series,
                      value: series.values[hoverIndex] ?? 0,
                    })).sort((a, b) => b.value - a.value).slice(0, 5);
                    return (
                      <g className="chart-hover">
                        <line x1={x} x2={x} y1="0" y2={HEIGHT} />
                        <rect x={Math.min(x + 12, WIDTH - 196)} y="12" width="184" height={lines.length * 22 + 28} rx="3" />
                        <text className="hover-time" x={Math.min(x + 22, WIDTH - 186)} y="30">{new Date(chart.samples[hoverIndex].time).toLocaleTimeString()}</text>
                        {lines.map((line, index) => (
                          <g key={line.key}>
                            <circle cx={Math.min(x + 23, WIDTH - 185)} cy={50 + index * 22} r="4" fill={line.color} />
                            <text className="hover-label" x={Math.min(x + 34, WIDTH - 174)} y={54 + index * 22}>{line.name.length > 19 ? `${line.name.slice(0, 18)}…` : line.name}</text>
                            <text className="hover-value" x={Math.min(x + 184, WIDTH - 24)} y={54 + index * 22} textAnchor="end">{formatMs(line.value)}</text>
                          </g>
                        ))}
                      </g>
                    );
                  })()}
                </svg>
              )}
            </div>
            <div className="chart-legend">
              <span>Rolling 30 seconds</span>
              <span>{chart?.series.length ?? 0} {chartMode === "lines" ? "series" : "stages"}</span>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

export default App;
