import { useEffect, useState } from "react";
import { API_BASE } from "./api";

/**
 * Hook that subscribes to an SSE endpoint and accumulates events.
 */
export function useSSE<T>(url: string, eventName = "message", enabled = true) {
  const [data, setData] = useState<T[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    setConnected(false);
    if (!enabled) return;
    const es = new EventSource(`${API_BASE}${url}`, { withCredentials: true });

    es.addEventListener("connected", () => setConnected(true));
    es.addEventListener(eventName, (e) => {
      try {
        const parsed = JSON.parse(e.data) as T;
        setData((prev) => [parsed, ...prev].slice(0, 200));
      } catch {
        // ignore parse errors
      }
    });

    es.onerror = () => setConnected(false);

    return () => es.close();
  }, [url, eventName, enabled]);

  return { data, connected };
}

/**
 * Hook that subscribes to an SSE endpoint and keeps only the latest event.
 */
export function useSSELatest<T>(url: string, eventName = "telemetry") {
  const [data, setData] = useState<T | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource(`${API_BASE}${url}`, { withCredentials: true });

    es.addEventListener("connected", () => setConnected(true));
    es.addEventListener(eventName, (e) => {
      try {
        setData(JSON.parse(e.data) as T);
      } catch {
        // ignore
      }
    });

    es.onerror = () => setConnected(false);

    return () => es.close();
  }, [url, eventName]);

  return { data, connected };
}
