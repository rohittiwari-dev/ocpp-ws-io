import {
  IconArrowsExchange,
  IconBook,
  IconBrandGithub,
  IconCheck,
  IconCode,
  IconCopy,
  IconCpu,
  IconExternalLink,
  IconKeyboard,
  IconLifebuoy,
  IconPlug,
  IconSearch,
  IconTerminal2,
} from "@tabler/icons-react";
import { useState } from "react";
import { PageHeading } from "@/components/workspace";

interface ShortcutItem {
  keys: string[];
  description: string;
  context: string;
}

const SHORTCUT_GROUPS: {
  category: string;
  icon: typeof IconKeyboard;
  items: ShortcutItem[];
}[] = [
  {
    category: "Global Navigation",
    icon: IconKeyboard,
    items: [
      {
        keys: ["Tab"],
        description: "Move focus to next interactive element",
        context: "Everywhere",
      },
      {
        keys: ["Shift", "Tab"],
        description: "Move focus to previous interactive element",
        context: "Everywhere",
      },
      {
        keys: ["Enter"],
        description: "Activate focused button or link",
        context: "Everywhere",
      },
      {
        keys: ["Space"],
        description: "Toggle switch, checkbox, or button",
        context: "Everywhere",
      },
    ],
  },
  {
    category: "Message Inspector",
    icon: IconArrowsExchange,
    items: [
      {
        keys: ["Space"],
        description: "Pause / resume real-time message stream",
        context: "Messages view",
      },
      {
        keys: ["Esc"],
        description: "Collapse expanded message inspection drawer",
        context: "Messages table",
      },
      {
        keys: ["Enter"],
        description: "Expand / collapse highlighted message row",
        context: "Messages table",
      },
    ],
  },
  {
    category: "Command Center",
    icon: IconTerminal2,
    items: [
      {
        keys: ["Ctrl", "Enter"],
        description: "Submit / dispatch formulated RPC command",
        context: "Command composer",
      },
      {
        keys: ["Esc"],
        description: "Dismiss modal or confirmation panel",
        context: "Confirmation dialogs",
      },
    ],
  },
  {
    category: "Search & Filtering",
    icon: IconSearch,
    items: [
      {
        keys: ["/"],
        description: "Focus the search / filter input field",
        context: "Fleet & tables",
      },
      {
        keys: ["Esc"],
        description: "Clear active filter search text",
        context: "Filter search box",
      },
    ],
  },
];

const PLAYBOOKS = [
  {
    id: "commissioning",
    title: "Charger Commissioning Lifecycle",
    badge: "Commissioning",
    tone: "mint",
    description:
      "Essential message sequences during charging station bootstrap and authorization.",
    steps: [
      {
        phase: "Step 1: WebSocket Handshake",
        detail:
          "Charger connects to ws:// or wss:// endpoint negotiating ocpp1.6 or ocpp2.0.1 subprotocol header.",
      },
      {
        phase: "Step 2: BootNotification [CALL]",
        detail:
          "Station sends chargePointVendor, chargePointModel, and firmwareVersion. CSMS replies with status: 'Accepted' and interval.",
      },
      {
        phase: "Step 3: StatusNotification [CALL]",
        detail:
          "Station reports initial connector statuses (Available, Preparing, Charging, Faulted) with errorCode: 'NoError'.",
      },
      {
        phase: "Step 4: Heartbeat & MeterValues Loop",
        detail:
          "Periodic Heartbeat keeps TCP connection warm while MeterValues streams ongoing session energy consumption.",
      },
    ],
  },
  {
    id: "rpc-dispatch",
    title: "Command Execution & RPC Safety",
    badge: "Operations",
    tone: "blue",
    description:
      "Operational guardrails when issuing remote commands to active charging stations.",
    steps: [
      {
        phase: "Step 1: Station Online Verification",
        detail:
          "Verify the target station has active status: 'online' and an open WebSocket connection.",
      },
      {
        phase: "Step 2: Action Preset Selection",
        detail:
          "Select a preset (e.g. RemoteStartTransaction, Reset, UnlockConnector) matching the station's negotiated protocol.",
      },
      {
        phase: "Step 3: Payload JSON Inspection",
        detail:
          "Validate required fields: connectorId, idTag, or reset type ('Soft' vs 'Hard'). Ensure syntax validity.",
      },
      {
        phase: "Step 4: Confirmation & Result Verification",
        detail:
          "Review the confirmation warning before dispatch. Check return CALLRESULT status: 'Accepted' vs 'Rejected'.",
      },
    ],
  },
  {
    id: "diagnostics",
    title: "Diagnostics & Failure Triage",
    badge: "Reliability",
    tone: "lavender",
    description:
      "Investigating charger communication drops, protocol errors, and latency spikes.",
    steps: [
      {
        phase: "Step 1: Inspect Diagnostics Log",
        detail:
          "Review /diagnostics for CALLERROR frames, unexpected close codes (1006, 1011), and WebSocket drops.",
      },
      {
        phase: "Step 2: Filter Security Events",
        detail:
          "Inspect /security for unauthorized connection attempts, missing HTTP Basic credentials, or TLS verification errors.",
      },
      {
        phase: "Step 3: Correlate Exchange Messages",
        detail:
          "Use the Messages filter to isolate a specific messageId to trace request-response latency and timeouts.",
      },
    ],
  },
];

const OCPP_FRAME_SPECS = [
  {
    code: "2",
    type: "CALL",
    direction: "Client ➔ Server / Server ➔ Client",
    signature: '[2, "<MessageId>", "<Action>", { ...payload }]',
    notes:
      "Initiates a remote action. MessageId must be a unique UUID/string generated by the caller.",
  },
  {
    code: "3",
    type: "CALLRESULT",
    direction: "Receiver ➔ Caller",
    signature: '[3, "<MessageId>", { ...payload }]',
    notes:
      "Successful response matching the request MessageId. Contains action-specific result fields.",
  },
  {
    code: "4",
    type: "CALLERROR",
    direction: "Receiver ➔ Caller",
    signature:
      '[4, "<MessageId>", "<ErrorCode>", "<Description>", { ...details }]',
    notes:
      "Indicates protocol, validation, or internal failure. ErrorCode must follow standard specifications.",
  },
];

const ERROR_CODES = [
  {
    code: "NotImplemented",
    description: "Requested Action is not known by Receiver.",
  },
  {
    code: "NotSupported",
    description: "Requested Action is recognized but not supported.",
  },
  {
    code: "InternalError",
    description:
      "An internal error occurred and action could not be completed.",
  },
  {
    code: "ProtocolError",
    description: "Payload did not conform to protocol framing or structure.",
  },
  {
    code: "SecurityError",
    description: "Security check failed (authentication, authorization, TLS).",
  },
  {
    code: "FormationViolation",
    description: "Payload is syntactically incorrect or not valid JSON.",
  },
  {
    code: "PropertyConstraintViolation",
    description: "Field value violates length, regex, or bounds constraint.",
  },
  {
    code: "TypeConstraintViolation",
    description:
      "Field data type is incorrect (e.g. string instead of integer).",
  },
];

export default function HelpPage() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey((prev) => (prev === key ? null : prev));
    }, 2000);
  };

  return (
    <>
      <PageHeading
        title="Help & Shortcuts Center"
        description="Keyboard shortcuts cheat sheet, operational playbooks, and OCPP protocol specification reference."
      />

      {/* ── Section 1: Keyboard Shortcuts Cheat Sheet ─────────────── */}
      <section className="help-section">
        <div className="section-heading">
          <div className="flex items-center gap-2">
            <IconKeyboard size={20} className="text-primary" />
            <h2>Keyboard navigation & shortcuts</h2>
          </div>
          <span className="text-xs text-muted-foreground">
            Fast keyboard interaction across the workspace
          </span>
        </div>

        <div className="help-shortcuts-grid">
          {SHORTCUT_GROUPS.map((group) => {
            const GroupIcon = group.icon;
            return (
              <div key={group.category} className="help-shortcut-card">
                <div className="help-shortcut-card-header">
                  <div className="flex items-center gap-2">
                    <GroupIcon size={16} className="text-primary" />
                    <strong>{group.category}</strong>
                  </div>
                </div>
                <div className="help-shortcut-list">
                  {group.items.map((item, idx) => (
                    <div
                      key={`${group.category}-${idx}`}
                      className="help-shortcut-row"
                    >
                      <div className="help-shortcut-keys">
                        {item.keys.map((k, ki) => (
                          <span key={ki}>
                            <kbd className="help-key-badge">{k}</kbd>
                            {ki < item.keys.length - 1 && (
                              <span className="help-key-plus">+</span>
                            )}
                          </span>
                        ))}
                      </div>
                      <div className="help-shortcut-desc">
                        <span>{item.description}</span>
                        <span className="help-shortcut-context">
                          {item.context}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Section 2: Operational Playbooks ─────────────────────── */}
      <section className="help-section">
        <div className="section-heading">
          <div className="flex items-center gap-2">
            <IconBook size={20} className="text-mint" />
            <h2>Operational playbooks & workflows</h2>
          </div>
          <span className="text-xs text-muted-foreground">
            Step-by-step procedures for fleet operators
          </span>
        </div>

        <div className="help-playbooks-grid">
          {PLAYBOOKS.map((pb) => (
            <div key={pb.id} className="help-playbook-card">
              <div className="help-playbook-header">
                <div>
                  <span className={`telemetry-kpi-tag badge-${pb.tone}`}>
                    {pb.badge}
                  </span>
                  <h3 className="help-playbook-title">{pb.title}</h3>
                </div>
              </div>
              <p className="help-playbook-desc">{pb.description}</p>
              <div className="help-playbook-steps">
                {pb.steps.map((st, si) => (
                  <div key={si} className="help-step-item">
                    <div className="help-step-number">{si + 1}</div>
                    <div className="help-step-content">
                      <strong>{st.phase}</strong>
                      <p>{st.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Section 3: OCPP Frame Specification Reference ────────── */}
      <section className="help-section">
        <div className="section-heading">
          <div className="flex items-center gap-2">
            <IconCode size={20} className="text-blue" />
            <h2>OCPP frame specification reference</h2>
          </div>
          <span className="text-xs text-muted-foreground">
            OCPP-J 1.6 & 2.0.1 message format structures
          </span>
        </div>

        <div className="table-scroll mb-6">
          <table className="telemetry-sample-table">
            <thead>
              <tr>
                <th style={{ width: 80 }}>Type ID</th>
                <th style={{ width: 140 }}>Frame Type</th>
                <th style={{ width: 220 }}>Direction</th>
                <th>Array Structure</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {OCPP_FRAME_SPECS.map((spec) => (
                <tr key={spec.code}>
                  <td>
                    <span className="help-key-badge font-mono">
                      {spec.code}
                    </span>
                  </td>
                  <td>
                    <strong className="font-mono text-primary">
                      {spec.type}
                    </strong>
                  </td>
                  <td className="text-xs text-muted-foreground">
                    {spec.direction}
                  </td>
                  <td>
                    <code className="font-mono text-xs text-mint bg-card px-2 py-1 rounded border border-border">
                      {spec.signature}
                    </code>
                  </td>
                  <td className="text-xs text-muted-foreground">
                    {spec.notes}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Standard Error Codes */}
        <div className="help-error-codes-panel">
          <div className="flex items-center justify-between mb-3">
            <strong className="text-sm">Standard OCPP Error Codes</strong>
            <span className="text-xs text-muted-foreground">
              Returned in [4, messageId, errorCode, description, details]
            </span>
          </div>
          <div className="help-error-codes-grid">
            {ERROR_CODES.map((err) => (
              <div key={err.code} className="help-error-code-item">
                <code className="font-mono text-xs text-rose font-bold">
                  {err.code}
                </code>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {err.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Section 4: Documentation & Developer Links ───────────── */}
      <section className="help-section">
        <div className="section-heading">
          <div className="flex items-center gap-2">
            <IconLifebuoy size={20} className="text-teal" />
            <h2>Documentation & developer resources</h2>
          </div>
          <span className="text-xs text-muted-foreground">
            Guides, source repositories, and specifications
          </span>
        </div>

        <div className="help-resources-grid">
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            className="help-resource-card"
          >
            <div className="help-resource-icon bg-lavender/10 text-lavender">
              <IconBrandGithub size={22} />
            </div>
            <div className="help-resource-body">
              <div className="flex items-center gap-1.5">
                <strong>ocpp-ws-io Repository</strong>
                <IconExternalLink size={14} className="text-muted-foreground" />
              </div>
              <p>
                Core protocol engine, plugin APIs, cluster adapters, and release
                notes.
              </p>
            </div>
          </a>

          <a
            href="https://www.openchargealliance.org"
            target="_blank"
            rel="noreferrer"
            className="help-resource-card"
          >
            <div className="help-resource-icon bg-mint/10 text-mint">
              <IconPlug size={22} />
            </div>
            <div className="help-resource-body">
              <div className="flex items-center gap-1.5">
                <strong>Open Charge Alliance (OCA)</strong>
                <IconExternalLink size={14} className="text-muted-foreground" />
              </div>
              <p>
                Official specification documentation for OCPP 1.6-J and OCPP
                2.0.1 editions.
              </p>
            </div>
          </a>

          <div className="help-resource-card">
            <div className="help-resource-icon bg-blue/10 text-blue">
              <IconCpu size={22} />
            </div>
            <div className="help-resource-body">
              <div className="flex items-center justify-between">
                <strong>Local Diagnostic Endpoint</strong>
                <button
                  type="button"
                  className="button secondary sm"
                  onClick={() => handleCopy("/api/diagnostics", "res-diag")}
                >
                  {copiedKey === "res-diag" ? (
                    <>
                      <IconCheck size={12} className="text-mint" /> Copied
                    </>
                  ) : (
                    <>
                      <IconCopy size={12} /> Copy
                    </>
                  )}
                </button>
              </div>
              <p>
                Query raw JSON health status via{" "}
                <code className="font-mono text-xs bg-card px-1.5 py-0.5 rounded border border-border">
                  /api/diagnostics
                </code>
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
