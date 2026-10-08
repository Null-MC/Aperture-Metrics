export type HelloMessage = {
  type: "hello";
  session: string;
  mod: string;
  shaderName?: string;
};

export type MetricEntry = {
  name: string;
  stage?: string;
  stageLabel?: string;
  gpuMs: number;
  cpuMs: number;
};

export type FrameMetricsMessage = {
  type: "frame_metrics";
  session: string;
  frame: number;
  gameTimeNs: number;
  profilingActive: boolean;
  entries: MetricEntry[];
};

export type ApertureMessage = HelloMessage | FrameMetricsMessage | Record<string, unknown>;