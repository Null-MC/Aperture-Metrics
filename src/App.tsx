import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useMetricsSocket } from "./useMetricsSocket";
import type { MetricEntry } from "./types";

type StageGroup = {
  stageKey: string;
  stageLabel: string;
  entries: Array<MetricEntry & { displayName: string; programKey: string }>;
};

type ThemeMode = "dark" | "light";
type MetricMode = "gpuMs" | "cpuMs";

type FrameSample = {
  timeMs: number;
  values: Record<string, { gpuMs: number; cpuMs: number }>;
};

type ChartPoint = {
  timeMs: number;
  value: number;
  x: number;
  y: number;
};

type ChartSeries = {
  key: string;
  displayName: string;
  points: string;
  color: string;
  samples: ChartPoint[];
};

type HoveredSeriesPoint = {
  key: string;
  displayName: string;
  color: string;
  sample: ChartPoint;
};

type SortMode = "name" | "gpu" | "cpu";

const THIRTY_SECONDS_MS = 30_000;
const THEME_STORAGE_KEY = "aperture-metrics-viewer-theme";
const CHART_WIDTH = 920;
const CHART_HEIGHT = 260;

const themeStyles: Record<ThemeMode, {
  background: string;
  foreground: string;
  muted: string;
  card: string;
  border: string;
  stageBackground: string;
  headerBackground: string;
  accent: string;
  error: string;
}> = {
  dark: {
    background: "#11151a",
    foreground: "#e7edf4",
    muted: "#aeb8c2",
    card: "#1a2028",
    border: "#2b3441",
    stageBackground: "#212937",
    headerBackground: "#141a21",
    accent: "#67b3ff",
    error: "#ff817a",
  },
  light: {
    background: "#f4f6f8",
    foreground: "#1d2733",
    muted: "#5e6d7e",
    card: "#ffffff",
    border: "#d5dce3",
    stageBackground: "#ecf2f9",
    headerBackground: "#f7fafc",
    accent: "#1667c2",
    error: "#bf3f36",
  },
};

function formatMs(value: number): string {
  if (!Number.isFinite(value)) {
    return "0.000";
  }
  return value.toFixed(3);
}

function formatGameTimeNs(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "-";
  }
  return value.toLocaleString();
}

function splitDisplayName(entryName: string): string {
  const trimmed = entryName.trim();
  if (!trimmed) {
    return "Unnamed";
  }
  return trimmed;
}

function buildProgramKey(entry: MetricEntry): string {
  const stage = entry.stage?.trim() || "OTHER";
  const displayName = splitDisplayName(entry.name);
  return `${stage}::${displayName}`;
}

function programNameFromKey(programKey: string): string {
  const separatorIndex = programKey.indexOf("::");
  if (separatorIndex < 0) {
    return programKey;
  }
  return programKey.slice(separatorIndex + 2);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function colorForProgram(programKey: string): string {
  let hash = 0;
  for (let i = 0; i < programKey.length; i++) {
    hash = ((hash << 5) - hash + programKey.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 70% 55%)`;
}

function groupEntriesByStage(entries: MetricEntry[]): StageGroup[] {
  const grouped = new Map<string, StageGroup>();

  for (const entry of entries) {
    const stageKey = entry.stage?.trim() || "OTHER";
    const stageLabel = entry.stageLabel?.trim() || "Other";
    const displayName = splitDisplayName(entry.name);
    const programKey = buildProgramKey(entry);
    const existing = grouped.get(stageKey);

    if (existing) {
      existing.entries.push({ ...entry, displayName, programKey });
      continue;
    }

    grouped.set(stageKey, {
      stageKey,
      stageLabel,
      entries: [{ ...entry, displayName, programKey }],
    });
  }

  return Array.from(grouped.values());
}

export default function App() {
  const { connected, session, shaderName, latestFrame, error } = useMetricsSocket();

  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") {
      return "dark";
    }
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return saved === "light" ? "light" : "dark";
  });
  const [chartEnabled, setChartEnabled] = useState(false);
  const [chartMetric, setChartMetric] = useState<MetricMode>("gpuMs");
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [collapsedStages, setCollapsedStages] = useState<Record<string, boolean>>({});
  const [history, setHistory] = useState<FrameSample[]>([]);
  const [hoveredPoint, setHoveredPoint] = useState<HoveredSeriesPoint | null>(null);

  const chartContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const activeTheme = themeStyles[theme];

    document.documentElement.style.margin = "0";
    document.documentElement.style.padding = "0";
    document.body.style.margin = "0";
    document.body.style.padding = "0";
    document.body.style.background = activeTheme.background;
    document.body.style.color = activeTheme.foreground;
  }, [theme]);

  useEffect(() => {
    if (!latestFrame) {
      return;
    }

    const now = Date.now();
    const values: Record<string, { gpuMs: number; cpuMs: number }> = {};
    for (const entry of latestFrame.entries) {
      values[buildProgramKey(entry)] = {
        gpuMs: Number.isFinite(entry.gpuMs) ? entry.gpuMs : 0,
        cpuMs: Number.isFinite(entry.cpuMs) ? entry.cpuMs : 0,
      };
    }

    setHistory((prev) => {
      const next = [...prev, { timeMs: now, values }];
      return next.filter((sample) => now - sample.timeMs <= THIRTY_SECONDS_MS);
    });
  }, [latestFrame]);

  const entries = latestFrame?.entries ?? [];
  const stageGroups = groupEntriesByStage(entries);
  const sortedStageGroups = useMemo(() => {
    return stageGroups.map((group) => {
      const sortedEntries = [...group.entries];
      sortedEntries.sort((left, right) => {
        if (sortMode === "gpu") {
          return right.gpuMs - left.gpuMs;
        }
        if (sortMode === "cpu") {
          return right.cpuMs - left.cpuMs;
        }
        return left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" });
      });

      return {
        ...group,
        entries: sortedEntries,
      };
    });
  }, [sortMode, stageGroups]);
  const expandedProgramKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const group of sortedStageGroups) {
      const isCollapsed = collapsedStages[group.stageKey] ?? false;
      if (isCollapsed) {
        continue;
      }

      for (const entry of group.entries) {
        keys.add(entry.programKey);
      }
    }

    return keys;
  }, [collapsedStages, sortedStageGroups]);
  const visual = themeStyles[theme];

  const chartLayout = useMemo(() => {
    if (!chartEnabled || history.length === 0) {
      return {
        windowStart: 0,
        windowEnd: 0,
        series: [] as ChartSeries[],
      };
    }

    const selectedKeys = Array.from(expandedProgramKeys);

    if (selectedKeys.length === 0) {
      return {
        windowStart: 0,
        windowEnd: 0,
        series: [] as ChartSeries[],
      };
    }

    const windowEnd = history[history.length - 1]?.timeMs ?? Date.now();
    const windowStart = windowEnd - THIRTY_SECONDS_MS;
    const minValue = 0;

    let maxValue = 0;
    for (const sample of history) {
      for (const key of selectedKeys) {
        const value = sample.values[key]?.[chartMetric] ?? 0;
        if (value > maxValue) {
          maxValue = value;
        }
      }
    }

    const safeMax = Math.max(maxValue * 1.1, 0.1);
    const toX = (timeMs: number) => ((timeMs - windowStart) / THIRTY_SECONDS_MS) * CHART_WIDTH;
    const toY = (value: number) => {
      const normalized = (value - minValue) / (safeMax - minValue);
      return CHART_HEIGHT - normalized * CHART_HEIGHT;
    };

    const series = selectedKeys.map((key) => {
      const samples = history.map((sample) => {
        const value = sample.values[key]?.[chartMetric] ?? 0;
        return {
          timeMs: sample.timeMs,
          value,
          x: toX(sample.timeMs),
          y: toY(value),
        };
      });

      const points = samples
        .map((sample) => `${sample.x.toFixed(2)},${sample.y.toFixed(2)}`)
        .join(" ");

      return {
        key,
        displayName: programNameFromKey(key),
        points,
        color: colorForProgram(key),
        samples,
      };
    });

    return {
      windowStart,
      windowEnd,
      series,
    };
  }, [chartEnabled, chartMetric, expandedProgramKeys, history]);

  const chartSeries = chartLayout.series;

  useEffect(() => {
    if (!chartEnabled) {
      setHoveredPoint(null);
    }
  }, [chartEnabled]);

  useEffect(() => {
    setHoveredPoint(null);
  }, [chartMetric, chartEnabled, collapsedStages]);

  const hoveredChartDetails = useMemo(() => {
    if (!chartEnabled || !hoveredPoint) {
      return null;
    }

    return {
      key: hoveredPoint.key,
      name: hoveredPoint.displayName,
      color: hoveredPoint.color,
      x: hoveredPoint.sample.x,
      y: hoveredPoint.sample.y,
      timeMs: hoveredPoint.sample.timeMs,
      value: hoveredPoint.sample.value,
    };
  }, [chartEnabled, hoveredPoint]);

  return (
    <main
      style={{
        fontFamily: "Inter, system-ui, Arial, sans-serif",
        margin: 0,
        padding: "1rem 1.25rem 1.5rem",
        background: visual.background,
        color: visual.foreground,
        minHeight: "100vh",
      }}
    >
      <div
        style={{
          background: visual.headerBackground,
          border: `1px solid ${visual.border}`,
          borderRadius: "0.6rem",
          padding: "0.9rem 1rem",
          marginBottom: "1rem",
        }}
      >
        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.65rem" }}>
          <div style={{ display: "inline-flex", gap: "0.5rem", alignItems: "center" }}>
            <h1 style={{ margin: 0 }}>Aperture Shader Metrics</h1>
            <span
              title={`Connection: ${connected ? "Connected" : "Disconnected"}\nSession: ${session ?? "-"}`}
              aria-label={`Connection ${connected ? "connected" : "disconnected"}. Session ${session ?? "unknown"}.`}
              style={{
                display: "inline-block",
                width: "0.65rem",
                height: "0.65rem",
                borderRadius: "999px",
                background: connected ? "#22c55e" : "#ef4444",
                border: `1px solid ${visual.border}`,
                boxShadow: connected ? "0 0 0 1px rgba(34, 197, 94, 0.25)" : "0 0 0 1px rgba(239, 68, 68, 0.25)",
              }}
            />
          </div>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end" }}>
            <label style={{ display: "inline-flex", gap: "0.4rem", alignItems: "center" }}>
              Sort by:
              <select
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value as SortMode)}
                style={{
                  border: `1px solid ${visual.border}`,
                  borderRadius: "0.35rem",
                  background: visual.card,
                  color: visual.foreground,
                  padding: "0.25rem 0.45rem",
                }}
              >
                <option value="name">Name</option>
                <option value="gpu">GPU</option>
                <option value="cpu">CPU</option>
              </select>
            </label>
            <label style={{ display: "inline-flex", gap: "0.35rem", alignItems: "center" }}>
              <input
                type="checkbox"
                checked={chartEnabled}
                onChange={(event) => setChartEnabled(event.target.checked)}
              />
              Enable chart
            </label>
            <button
              type="button"
              onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
              style={{
                border: `1px solid ${visual.border}`,
                borderRadius: "0.5rem",
                padding: "0.4rem 0.65rem",
                background: visual.card,
                color: visual.foreground,
                cursor: "pointer",
              }}
            >
              Theme: {theme === "dark" ? "Dark" : "Light"}
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gap: "0.2rem", color: visual.muted }}>
          <div>
            <strong style={{ color: visual.foreground }}>Shader Name:</strong> {shaderName ?? "-"}
          </div>
          <div>
            <strong style={{ color: visual.foreground }}>Game Time (ns):</strong> {formatGameTimeNs(latestFrame?.gameTimeNs)}
          </div>
          <div>
            <strong style={{ color: visual.foreground }}>Frame:</strong> {latestFrame?.frame ?? "-"}
          </div>
        </div>
      </div>

      {error ? (
        <p style={{ color: visual.error }}>{error}</p>
      ) : null}

      {chartEnabled ? (
        <section
          style={{
            border: `1px solid ${visual.border}`,
            borderRadius: "0.6rem",
            background: visual.card,
            padding: "0.75rem",
            marginBottom: "1rem",
          }}
        >
          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem", flexWrap: "wrap" }}>
            <div style={{ fontWeight: 600 }}>
              {chartMetric === "gpuMs" ? "GPU ms" : "CPU ms"} (rolling 30s)
            </div>
            <label style={{ display: "inline-flex", gap: "0.4rem", alignItems: "center" }}>
              Metric:
              <select
                value={chartMetric}
                onChange={(event) => setChartMetric(event.target.value as MetricMode)}
                style={{
                  border: `1px solid ${visual.border}`,
                  borderRadius: "0.35rem",
                  background: visual.card,
                  color: visual.foreground,
                  padding: "0.25rem 0.45rem",
                }}
              >
                <option value="gpuMs">GPU ms</option>
                <option value="cpuMs">CPU ms</option>
              </select>
            </label>
          </div>
          <div ref={chartContainerRef}>
            <svg
              viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
              width="100%"
              height={CHART_HEIGHT}
              role="img"
              aria-label="Timeseries chart"
              onMouseLeave={() => setHoveredPoint(null)}
              onMouseMove={(event) => {
                if (!chartContainerRef.current) {
                  return;
                }

                if (chartSeries.length === 0 || chartLayout.windowEnd <= chartLayout.windowStart) {
                  setHoveredPoint(null);
                  return;
                }

                const bounds = chartContainerRef.current.getBoundingClientRect();
                if (bounds.width <= 0) {
                  return;
                }

                const pointerX = clamp(
                  ((event.clientX - bounds.left) / bounds.width) * CHART_WIDTH,
                  0,
                  CHART_WIDTH,
                );
                const pointerY = clamp(
                  ((event.clientY - bounds.top) / bounds.height) * CHART_HEIGHT,
                  0,
                  CHART_HEIGHT,
                );

                const hoveredTime = chartLayout.windowStart + (pointerX / CHART_WIDTH) * (chartLayout.windowEnd - chartLayout.windowStart);

                let closest: HoveredSeriesPoint | null = null;
                let bestDistanceSq = Number.POSITIVE_INFINITY;

                for (const series of chartSeries) {
                  for (const sample of series.samples) {
                    const dx = sample.x - pointerX;
                    const dy = sample.y - pointerY;
                    const dt = (sample.timeMs - hoveredTime) / 8;
                    const distanceSq = dx * dx + dy * dy + dt * dt;
                    if (distanceSq < bestDistanceSq) {
                      bestDistanceSq = distanceSq;
                      closest = {
                        key: series.key,
                        displayName: series.displayName,
                        color: series.color,
                        sample,
                      };
                    }
                  }
                }

                setHoveredPoint(closest);
              }}
            >
              <rect x="0" y="0" width={CHART_WIDTH} height={CHART_HEIGHT} fill={visual.background} />
              <line x1="0" y1={CHART_HEIGHT - 1} x2={CHART_WIDTH} y2={CHART_HEIGHT - 1} stroke={visual.border} strokeWidth="1" />
              <line x1="0" y1="0" x2="0" y2={CHART_HEIGHT} stroke={visual.border} strokeWidth="1" />
            {chartSeries.map((series) => (
              <polyline
                key={series.key}
                points={series.points}
                fill="none"
                stroke={series.color}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
              {hoveredChartDetails ? (
                <>
                  <line
                    x1={hoveredChartDetails.x}
                    y1="0"
                    x2={hoveredChartDetails.x}
                    y2={CHART_HEIGHT}
                    stroke={visual.muted}
                    strokeWidth="1"
                    strokeDasharray="4 4"
                  />
                  <circle
                    cx={hoveredChartDetails.x}
                    cy={hoveredChartDetails.y}
                    r="4"
                    fill={hoveredChartDetails.color}
                    stroke={visual.background}
                    strokeWidth="1"
                  />
                  <g
                    transform={`translate(${clamp(hoveredChartDetails.x > CHART_WIDTH - 230 ? hoveredChartDetails.x - 220 : hoveredChartDetails.x + 10, 6, CHART_WIDTH - 214)}, 10)`}
                  >
                    <rect
                      x="0"
                      y="0"
                      width="208"
                      height={40}
                      rx="6"
                      fill={visual.card}
                      stroke={visual.border}
                      opacity="0.96"
                    />
                    <text x="8" y="16" fontSize="11" fill={visual.muted}>
                      {new Date(hoveredChartDetails.timeMs).toLocaleTimeString()}
                    </text>
                    <text x="8" y="32" fontSize="12" fill={hoveredChartDetails.color}>
                      {hoveredChartDetails.name}: {formatMs(hoveredChartDetails.value)}
                    </text>
                  </g>
                </>
              ) : null}
            </svg>
          </div>
          {chartSeries.length === 0 ? (
            <div style={{ color: visual.muted }}>Expand one or more stages to display lines.</div>
          ) : null}
        </section>
      ) : null}

      <div
        style={{
          border: `1px solid ${visual.border}`,
          borderRadius: "0.6rem",
          overflow: "hidden",
          background: visual.card,
        }}
      >
        <table
          style={{
            borderCollapse: "separate",
            borderSpacing: 0,
            width: "100%",
            background: visual.card,
          }}
        >
          <thead>
            <tr>
              <th
                style={{
                  borderBottom: `1px solid ${visual.border}`,
                  padding: "0.5rem",
                  textAlign: "left",
                  background: visual.headerBackground,
                }}
              >
                Program
              </th>
              <th
                style={{
                  borderBottom: `1px solid ${visual.border}`,
                  padding: "0.5rem",
                  textAlign: "right",
                  background: visual.headerBackground,
                }}
              >
                GPU ms
              </th>
              <th
                style={{
                  borderBottom: `1px solid ${visual.border}`,
                  padding: "0.5rem",
                  textAlign: "right",
                  background: visual.headerBackground,
                }}
              >
                CPU ms
              </th>
            </tr>
          </thead>
          <tbody>
          {sortedStageGroups.map((group) => {
            const isCollapsed = collapsedStages[group.stageKey] ?? false;

            return (
            <Fragment key={group.stageKey}>
              <tr>
                <td
                  colSpan={3}
                  style={{
                    borderBottom: `1px solid ${visual.border}`,
                    padding: "0.5rem",
                    background: visual.stageBackground,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() => {
                        setCollapsedStages((current) => ({
                          ...current,
                          [group.stageKey]: !isCollapsed,
                        }));
                      }}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.45rem",
                        border: "none",
                        background: "transparent",
                        color: visual.foreground,
                        cursor: "pointer",
                        fontWeight: 600,
                        padding: 0,
                      }}
                    >
                      <span aria-hidden="true" style={{ fontSize: "0.8rem", lineHeight: 1 }}>{isCollapsed ? "▶" : "▼"}</span>
                      <span>{group.stageLabel}</span>
                    </button>
                  </div>
                </td>
              </tr>
              {!isCollapsed
                ? group.entries.map((entry) => (
                <tr key={entry.name}>
                  <td style={{ borderBottom: `1px solid ${visual.border}`, padding: "0.5rem 0.5rem 0.5rem 1.25rem" }}>
                    {chartEnabled ? <span style={{ color: colorForProgram(entry.programKey), fontWeight: 600, marginRight: "0.5rem" }}>●</span> : null}
                    {entry.displayName}
                  </td>
                  <td style={{ borderBottom: `1px solid ${visual.border}`, padding: "0.5rem", textAlign: "right" }}>
                    {formatMs(entry.gpuMs)}
                  </td>
                  <td style={{ borderBottom: `1px solid ${visual.border}`, padding: "0.5rem", textAlign: "right" }}>
                    {formatMs(entry.cpuMs)}
                  </td>
                </tr>
                  ))
                : null}
            </Fragment>
            );
          })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
