import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
export function useResource<T>(path: string, interval = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [revision, setRevision] = useState(0);
  const activePath = useRef(path);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision intentionally triggers manual refresh.
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    if (activePath.current !== path) {
      setData(null);
      setLoading(true);
      activePath.current = path;
    }
    const read = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await api.get<T>(path, controller.signal);
        if (!controller.signal.aborted) {
          setData(result);
          setError("");
          setUpdatedAt(new Date());
        }
      } catch (failure) {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error ? failure.message : "Request failed",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
        pending = false;
      }
    };
    void read();
    const timer =
      interval > 0
        ? window.setInterval(() => {
            if (!document.hidden) void read();
          }, interval)
        : undefined;
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [path, interval, revision]);
  return { data, error, loading, refresh, updatedAt };
}
