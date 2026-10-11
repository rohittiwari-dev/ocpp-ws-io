export function downloadJson<T>(name: string, data: T) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${name}-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function time(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unavailable" : date.toLocaleString();
}
export function duration(seconds: number) {
  return seconds >= 86400
    ? `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`
    : seconds >= 3600
      ? `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
      : `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
}
