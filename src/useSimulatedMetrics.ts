import { useEffect, useState } from "react";
import type { FrameMetricsMessage } from "./types";

type SimulatedMetricsState = {
  connected: boolean;
  session: string;
  shaderName: string;
  latestFrame: FrameMetricsMessage;
  error: null;
};

const stages = [
  { key: "SETUP", label: "Setup", names: [["setup_noise_bake", 0.004, 0.006], ["setup_lut_bake", 0.006, 0.004]] },
  { key: "BEGIN", label: "Begin", names: [["begin_cloud_shadow_map", 0.14, 0.009], ["begin_sky_view_lut", 0.08, 0.011], ["begin_multiscatter_lut", 0.05, 0.007], ["begin_transmittance_lut", 0.03, 0.006], ["begin_exposure_read", 0.012, 0.008]] },
  { key: "SHADOW", label: "Shadow", names: [["shadow_terrain_solid_c0", 0.92, 0.41], ["shadow_terrain_solid_c1", 0.61, 0.33], ["shadow_terrain_solid_c2", 0.44, 0.27], ["shadow_terrain_cutout", 0.38, 0.22], ["shadow_terrain_solid_c3", 0.29, 0.19], ["shadow_entities", 0.17, 0.12], ["shadow_translucent", 0.12, 0.07], ["shadow_block_entities", 0.09, 0.08], ["shadow_rsm_downsample", 0.064, 0.004], ["shadow_particles", 0.03, 0.02], ["shadow_hand", 0.011, 0.006]] },
  { key: "GBUFFER", label: "G-Buffer", names: [["gbuf_terrain_solid", 1.21, 0.78], ["gbuf_terrain_cutout", 0.54, 0.36], ["gbuf_terrain_cutout_mipped", 0.33, 0.21], ["gbuf_entities", 0.27, 0.19], ["gbuf_block_entities", 0.16, 0.14], ["gbuf_particles_opaque", 0.058, 0.031], ["gbuf_hand", 0.042, 0.018], ["gbuf_sky_basic", 0.022, 0.009]] },
  { key: "DEFERRED", label: "Deferred", names: [["deferred_rt_reflections", 2.41, 0.014], ["deferred_lighting", 1.82, 0.012], ["deferred_cloud_raymarch", 1.58, 0.011], ["deferred_vol_fog_froxels", 1.07, 0.009], ["deferred_gtao_trace", 0.71, 0.009], ["deferred_sss_trace", 0.34, 0.006], ["deferred_reflect_resolve", 0.29, 0.005], ["deferred_cloud_reproject", 0.21, 0.005]] },
  { key: "TRANSLUCENT", label: "Translucent", names: [["trans_water", 0.63, 0.31], ["trans_water_refraction", 0.27, 0.006], ["trans_particles", 0.21, 0.17], ["trans_stained_glass", 0.091, 0.07], ["trans_entities", 0.074, 0.06]] },
  { key: "COMPOSITE", label: "Composite", names: [["post_dof_gather", 0.41, 0.005], ["post_taa_resolve", 0.36, 0.006], ["post_motion_blur", 0.22, 0.004], ["post_bloom_down_0", 0.14, 0.003], ["post_tonemap", 0.118, 0.003], ["post_lens_flare", 0.093, 0.004]] },
  { key: "FINAL", label: "Final", names: [["final_upscale_fsr", 0.24, 0.006], ["final_ui_composite", 0.031, 0.004], ["final", 0.022, 0.003]] },
  { key: "OTHER", label: "Other", names: [["debug_overlay", 0, 0.001], ["hand_depth_prepass", 0.017, 0.009]] },
] as const;

const definitions = stages.flatMap((stage) =>
  stage.names.map(([name, gpuBase, cpuBase], index) => ({
    name,
    stage: stage.key,
    stageLabel: stage.label,
    gpuBase,
    cpuBase,
    phase: Math.random() * Math.PI * 2,
    index,
  })),
);

export function useSimulatedMetrics(enabled: boolean): SimulatedMetricsState | null {
  const [state, setState] = useState<SimulatedMetricsState | null>(null);

  useEffect(() => {
    if (!enabled) {
      setState(null);
      return;
    }

    let frame = 418_221;
    let gameTimeNs = 2_731_884_120_331;
    const startedAt = Date.now();
    const update = () => {
      const elapsed = (Date.now() - startedAt) / 1000;
      const entries = definitions.map((definition) => ({
        name: definition.name,
        stage: definition.stage,
        stageLabel: definition.stageLabel,
        gpuMs: Math.max(0, definition.gpuBase * (1 + 0.1 * Math.sin(elapsed * 0.37 + definition.phase) + (Math.random() - 0.5) * 0.08)),
        cpuMs: Math.max(0, definition.cpuBase * (1 + (Math.random() - 0.5) * 0.08)),
      }));
      const totalGpu = entries.reduce((sum, entry) => sum + entry.gpuMs, 0);
      const fps = 1000 / (totalGpu + 1.6);
      frame += Math.round(fps / 10);
      gameTimeNs += 100_000_000;
      setState({
        connected: true,
        session: "local-simulation",
        shaderName: "ComplementaryReimagined_r5.4",
        error: null,
        latestFrame: { type: "frame_metrics", session: "local-simulation", frame, gameTimeNs, profilingActive: true, entries },
      });
    };

    update();
    const timer = window.setInterval(update, 100);
    return () => window.clearInterval(timer);
  }, [enabled]);

  return state;
}
