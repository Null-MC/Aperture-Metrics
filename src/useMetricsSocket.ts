import { useEffect, useMemo, useState } from "react";
import type { ApertureMessage, FrameMetricsMessage } from "./types";

export type MetricsSocketState = {
  connected: boolean;
  session: string | null;
  shaderName: string | null;
  latestFrame: FrameMetricsMessage | null;
  error: string | null;
};

const DEFAULT_WS_URL = "ws://127.0.0.1:17866";

export function useMetricsSocket(): MetricsSocketState {
  const socketUrl = useMemo(() => {
    if (typeof window === "undefined") {
      return DEFAULT_WS_URL;
    }

    const host = window.location.hostname;
    if (!host || host === "127.0.0.1" || host === "localhost") {
      return DEFAULT_WS_URL;
    }
    return `ws://${host}:17866`;
  }, []);

  const [connected, setConnected] = useState(false);
  const [session, setSession] = useState<string | null>(null);
  const [shaderName, setShaderName] = useState<string | null>(null);
  const [latestFrame, setLatestFrame] = useState<FrameMetricsMessage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let socket: WebSocket | null = null;

    const scheduleReconnect = () => {
      if (!active || reconnectTimer != null) {
        return;
      }

      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, 1000);
    };

    const connect = () => {
      if (!active) {
        return;
      }

      socket = new WebSocket(socketUrl);

      socket.onopen = () => {
        setConnected(true);
        setError(null);
      };

      socket.onclose = () => {
        setConnected(false);
        scheduleReconnect();
      };

      socket.onerror = () => {
        setError(`Failed to connect to local Aperture websocket at ${socketUrl}.`);
      };

      socket.onmessage = (event) => {
        try {
          const payload: ApertureMessage = JSON.parse(event.data as string);
          if (payload && payload.type === "hello" && typeof payload.session === "string") {
            setSession(payload.session);
            setShaderName(typeof payload.shaderName === "string" ? payload.shaderName : null);
            return;
          }

          if (payload && payload.type === "frame_metrics") {
            setLatestFrame(payload as FrameMetricsMessage);
            if (typeof payload.session === "string") {
              setSession(payload.session);
            }
          }
        } catch {
          // Ignore malformed payloads.
        }
      };
    };

    connect();

    return () => {
      active = false;
      if (reconnectTimer != null) {
        clearTimeout(reconnectTimer);
      }
      socket?.close();
    };
  }, [socketUrl]);

  return { connected, session, shaderName, latestFrame, error };
}
