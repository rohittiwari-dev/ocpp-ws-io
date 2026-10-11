import { IconSend } from "@tabler/icons-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Empty,
  Export,
  Feedback,
  JsonView,
  PageHeading,
  Refresh,
  Status,
} from "@/components/workspace";
import { useResource } from "@/hooks/use-resource";
import { api } from "@/lib/api";
import { time } from "@/lib/export";
import type { ConnectionRecord, JsonValue } from "@/types";
import type { CommandRecord, ServerInfo } from "@/types/operations";
import { COMMAND_PRESETS } from "@/types/presets";
export default function CommandsPage() {
  const [query] = useSearchParams();
  const stations = useResource<ConnectionRecord[]>("/connections", 5000);
  const server = useResource<ServerInfo>("/server", 10000);
  const history = useResource<CommandRecord[]>("/commands", 5000);
  const [identity, setIdentity] = useState(query.get("identity") ?? "");
  const [method, setMethod] = useState("TriggerMessage");
  const [payload, setPayload] = useState(
    '{\n  "requestedMessage": "Heartbeat"\n}',
  );
  const [timeout, setTimeout] = useState(30000);
  const [description, setDescription] = useState(
    "Ask the charger to report its heartbeat.",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [result, setResult] = useState<CommandRecord | null>(null);
  const station = stations.data?.find((item) => item.identity === identity);
  const presets = COMMAND_PRESETS.filter(
    (preset) => station && preset.protocols.includes(station.protocol),
  );
  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!station || station.status !== "online") {
      setError("Choose an online charger.");
      return;
    }
    let params: JsonValue;
    try {
      params = JSON.parse(payload) as JsonValue;
    } catch {
      setError(
        "Payload is not valid JSON. Check commas, quotes, and brackets.",
      );
      return;
    }
    if (!params || typeof params !== "object" || Array.isArray(params)) {
      setError("Payload must be a JSON object.");
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      setResult(
        await api.post<CommandRecord>("/commands", {
          identity,
          method,
          params,
          protocol: station.protocol,
          timeoutMs: timeout,
        }),
      );
      history.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Command failed");
    } finally {
      setBusy(false);
      setAcknowledged(false);
    }
  }
  return (
    <>
      <PageHeading
        title="Command center"
        description="Compose a request, choose a charger, and inspect its response."
      >
        <Refresh onClick={history.refresh} />
        <Export data={history.data ?? []} name="command-history" />
      </PageHeading>
      <Feedback {...stations} retry={stations.refresh} />
      <Feedback {...server} retry={server.refresh} />
      {server.data && !server.data.commandsEnabled && (
        <p className="error-banner">
          {server.data.attached
            ? "Commands are disabled in this deployment."
            : "Attach the board plugin to an OCPP server to enable commands."}
        </p>
      )}
      <div className="split-layout">
        <form className="form-panel" onSubmit={(event) => void send(event)}>
          <fieldset
            disabled={busy}
            style={{ border: 0, padding: 0, margin: 0 }}
          >
            <label className="field">
              <span>Target charger</span>
              <select
                required
                value={identity}
                onChange={(event) => {
                  setIdentity(event.target.value);
                  setAcknowledged(false);
                }}
              >
                <option value="">Choose an online charger</option>
                {(stations.data ?? [])
                  .filter((item) => item.status === "online")
                  .map((item) => (
                    <option key={item.identity} value={item.identity}>
                      {item.identity} / {item.protocol}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              <span>Start from a preset</span>
              <select
                key={station?.protocol ?? "none"}
                defaultValue=""
                onChange={(event) => {
                  const preset = presets[Number(event.target.value)];
                  if (preset) {
                    setMethod(preset.method);
                    setPayload(JSON.stringify(preset.params, null, 2));
                    setDescription(preset.description);
                    setAcknowledged(false);
                  }
                }}
              >
                <option value="" disabled>
                  Choose a protocol-compatible preset
                </option>
                {presets.map((preset, index) => (
                  <option key={preset.name} value={index}>
                    {preset.name}
                  </option>
                ))}
              </select>
              <small>{description}</small>
            </label>
            <label className="field">
              <span>OCPP action</span>
              <input
                className="text-input"
                required
                pattern="[A-Za-z][A-Za-z0-9_.:-]{0,127}"
                value={method}
                onChange={(event) => {
                  setMethod(event.target.value);
                  setAcknowledged(false);
                }}
              />
              <small>
                Custom actions are supported. Server validation and charger
                capabilities determine acceptance.
              </small>
            </label>
            <label className="field">
              <span>Request payload</span>
              <textarea
                aria-label="Request payload"
                required
                spellCheck={false}
                value={payload}
                onChange={(event) => {
                  setPayload(event.target.value);
                  setAcknowledged(false);
                }}
              />
            </label>
            <label className="field">
              <span>Timeout (milliseconds)</span>
              <input
                className="text-input"
                type="number"
                min={1000}
                max={120000}
                step={1000}
                required
                value={timeout}
                onChange={(event) => setTimeout(Number(event.target.value))}
              />
            </label>
            <label
              className="notice"
              style={{ display: "flex", gap: 9, alignItems: "flex-start" }}
            >
              <input
                type="checkbox"
                required
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              I reviewed the target and payload. This sends a real command to
              the charger.
            </label>
            <button
              className="button primary"
              disabled={
                !acknowledged ||
                !server.data?.commandsEnabled ||
                station?.status !== "online"
              }
            >
              <IconSend size={17} />
              {busy ? "Waiting for charger..." : "Send command"}
            </button>
          </fieldset>
          {error && (
            <p className="error-banner" role="alert">
              {error}
            </p>
          )}
        </form>
        <section>
          <div className="section-heading" style={{ marginTop: 0 }}>
            <h2>Response</h2>
            {result && (
              <Status tone={result.status === "succeeded" ? "mint" : "rose"}>
                {result.status}
              </Status>
            )}
          </div>
          {busy ? (
            <p className="notice" role="status">
              Waiting for the charger response, up to {timeout / 1000} seconds?
            </p>
          ) : result ? (
            <>
              <p className="notice">
                {result.method} / {result.identity} / {result.durationMs} ms
              </p>
              <JsonView value={result.result ?? result.error ?? null} />
              <p className="notice">
                A successful RPC means a response arrived. Inspect the response
                status to confirm whether the charger accepted the operation.
              </p>
            </>
          ) : (
            <Empty title="Ready when you are">
              The response and timing will appear here after you send a command.
            </Empty>
          )}
        </section>
      </div>
      <div className="section-heading">
        <h2>Command history</h2>
        <span className="muted">Last 200 requests / this process</span>
      </div>
      <Feedback {...history} retry={history.refresh} />
      <div className="table-panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Station</th>
                <th>Action</th>
                <th>Operator</th>
                <th>Result</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {(history.data ?? []).map((entry) => (
                <tr key={entry.id}>
                  <td className="nowrap muted">{time(entry.timestamp)}</td>
                  <td>{entry.identity}</td>
                  <td>{entry.method}</td>
                  <td>{entry.operator}</td>
                  <td>
                    <Status
                      tone={
                        entry.status === "failed"
                          ? "rose"
                          : entry.status === "succeeded"
                            ? "mint"
                            : "yellow"
                      }
                    >
                      {entry.status}
                    </Status>
                  </td>
                  <td>
                    <details className="payload-details">
                      <summary>Inspect</summary>
                      <JsonView value={entry} />
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!history.data?.length && (
          <Empty title="No commands sent">
            Requests sent from this board appear here with their outcome.
          </Empty>
        )}
      </div>
    </>
  );
}
