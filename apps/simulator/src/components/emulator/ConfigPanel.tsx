"use client";

import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clock,
  Cpu,
  CreditCard,
  FileText,
  FlaskConical,
  Gauge,
  Globe,
  HardDrive,
  Hash,
  KeyRound,
  Layers,
  MessageSquare,
  Plug,
  Search,
  Send,
  Server,
  Settings2,
  Shield,
  SlidersHorizontal,
  Smartphone,
  Tag,
  Terminal,
  Upload,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useActiveCharger } from "@/hooks/useActiveCharger";
import { ocppService } from "@/lib/ocppClient";

/* ═══════════════════════════════════════════
   CUSTOM DROPDOWN (replaces Select)
   ═══════════════════════════════════════════ */

function Dropdown({
  value,
  options,
  onChange,
  disabled,
  className,
}: {
  value: string;
  options: { label: string; value: string }[];
  onChange: (v: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} className={`relative ${className ?? ""}`}>
      <button
        disabled={disabled}
        onClick={() => !disabled && setOpen(!open)}
        className={`relative h-9 flex items-center gap-2 px-3 rounded-lg bg-surface-inset border border-b-default text-[12px] text-t-primary cursor-pointer transition-all hover:bg-surface-hover hover:border-b-strong ${
          disabled ? "opacity-40 pointer-events-none" : ""
        }`}
      >
        <span className="truncate">{selected?.label ?? value}</span>
        <ChevronDown
          className={`h-3 w-3 text-t-muted shrink-0 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-lg bg-surface-elevated border border-b-default shadow-xl max-h-52 overflow-y-auto custom-scrollbar">
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={`flex items-center justify-between px-3 py-2 text-[11px] cursor-pointer transition-colors ${
                opt.value === value
                  ? "text-indigo-400 bg-indigo-500/10"
                  : "text-t-secondary hover:bg-surface-hover"
              }`}
            >
              <span>{opt.label}</span>
              {opt.value === value && (
                <Check className="h-3.5 w-3.5 text-t-faint ml-auto shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   FIELD COMPONENT
   ═══════════════════════════════════════════ */

function Field({
  label,
  icon,
  required,
  hint,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-semibold text-t-muted uppercase tracking-widest flex items-center gap-1.5">
          {icon}
          {label}
          {required && <span className="text-rose-400">*</span>}
        </label>
        {hint && (
          <span className="text-[9px] text-t-faint font-mono">{hint}</span>
        )}
      </div>
      {children}
    </div>
  );
}

/* ═══════════════════════════════════════════
   SECTION CARD
   ═══════════════════════════════════════════ */

function SectionCard({
  title,
  icon,
  color,
  description,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  color: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`p-3.5 rounded-xl border border-b-subtle bg-surface-inset space-y-3`}
    >
      <div className="flex items-center gap-2">
        <span className={color}>{icon}</span>
        <span
          className={`text-[10px] font-bold uppercase tracking-[0.15em] ${color}`}
        >
          {title}
        </span>
      </div>
      {description && (
        <p className="text-[10px] text-t-faint -mt-1">{description}</p>
      )}
      {children}
    </div>
  );
}

/* ═══════════════════════════════════════════
   TAB NAVIGATION
   ═══════════════════════════════════════════ */

const TABS = [
  { id: "connection", label: "Connect", icon: Plug, color: "text-blue-400" },
  { id: "vendor", label: "Vendor", icon: Cpu, color: "text-cyan-400" },
  {
    id: "station",
    label: "Config",
    icon: SlidersHorizontal,
    color: "text-amber-400",
  },
  {
    id: "simulation",
    label: "Simulate",
    icon: FlaskConical,
    color: "text-pink-400",
  },
  {
    id: "auth",
    label: "Auth",
    icon: KeyRound,
    color: "text-emerald-400",
  },
  {
    id: "composer",
    label: "Send",
    icon: MessageSquare,
    color: "text-orange-400",
  },
] as const;

type TabId = (typeof TABS)[number]["id"];

/* ═══════════════════════════════════════════
   PROFILES SECTION
   ═══════════════════════════════════════════ */

function ProfilesSection() {
  const { savedProfiles, saveProfile, loadProfile, deleteProfile } =
    useActiveCharger();
  const [profileName, setProfileName] = useState("");

  const handleSave = () => {
    const name = profileName.trim();
    if (!name) return;
    saveProfile(name);
    setProfileName("");
  };

  return (
    <SectionCard
      title="Saved Profiles"
      icon={<HardDrive className="h-3.5 w-3.5" />}
      color="text-cyan-400"
      description="Save & restore config snapshots"
    >
      <div className="flex items-center gap-2">
        <Input
          value={profileName}
          onChange={(e) => setProfileName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          className="h-8 flex-1 bg-surface-inset border-b-default text-white text-[11px] rounded-lg focus-visible:ring-cyan-500/30"
          placeholder="Profile name…"
        />
        <Button
          onClick={handleSave}
          disabled={!profileName.trim()}
          className="h-8 px-3 bg-cyan-500/10 hover:bg-cyan-500/18 text-cyan-300 border border-cyan-500/20 font-bold text-[10px] uppercase tracking-wider rounded-lg cursor-pointer shrink-0"
        >
          Save
        </Button>
      </div>
      {savedProfiles.length > 0 && (
        <div className="space-y-1 max-h-40 overflow-y-auto custom-scrollbar mt-2">
          {savedProfiles.map((p) => (
            <div
              key={p.name}
              className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-white/2 border border-white/5"
            >
              <div className="min-w-0">
                <span className="text-[11px] font-medium text-slate-300 truncate block">
                  {p.name}
                </span>
                <span className="text-[9px] font-mono text-t-faint">
                  {new Date(p.createdAt).toLocaleDateString()}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => loadProfile(p.name)}
                  className="px-2 py-1 rounded text-[9px] font-bold text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/15 cursor-pointer transition-colors"
                >
                  Load
                </button>
                <button
                  onClick={() => deleteProfile(p.name)}
                  className="p-1 rounded text-t-muted hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

/* ═══════════════════════════════════════════
   CONNECTION TAB
   ═══════════════════════════════════════════ */

function ConnectionTab() {
  const { status, config, updateConfig } = useActiveCharger();
  const locked = status === "connected" || status === "connecting";

  return (
    <div className="space-y-4">
      <SectionCard
        title="WebSocket Endpoint"
        icon={<Globe className="h-3.5 w-3.5" />}
        color="text-blue-400"
      >
        <Field
          label="CSMS URL"
          icon={<Globe className="h-3 w-3 text-blue-400/60" />}
        >
          <Input
            value={config.endpoint}
            disabled={locked}
            onChange={(e) => updateConfig({ endpoint: e.target.value })}
            className="h-9 bg-surface-inset border-b-default text-white text-[12px] rounded-lg focus-visible:ring-blue-500/30"
            placeholder="ws://localhost:9000"
          />
        </Field>
      </SectionCard>

      <SectionCard
        title="Identity"
        icon={<Hash className="h-3.5 w-3.5" />}
        color="text-violet-400"
      >
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Charge Point ID"
            icon={<Hash className="h-3 w-3 text-violet-400/60" />}
          >
            <Input
              value={config.chargePointId}
              disabled={locked}
              onChange={(e) => updateConfig({ chargePointId: e.target.value })}
              className="h-9 bg-surface-inset border-b-default text-white text-[12px] rounded-lg focus-visible:ring-violet-500/30"
            />
          </Field>
          <Field
            label="OCPP Version"
            icon={<Layers className="h-3 w-3 text-violet-400/60" />}
          >
            <Dropdown
              value={config.ocppVersion}
              disabled={locked}
              options={[
                { label: "OCPP 1.6J", value: "ocpp1.6" },
                { label: "OCPP 2.0.1", value: "ocpp2.0.1" },
                { label: "OCPP 2.1", value: "ocpp2.1" },
              ]}
              onChange={(v) => updateConfig({ ocppVersion: v as any })}
            />
          </Field>
          <Field
            label="Default RFID Tag"
            icon={<Tag className="h-3 w-3 text-violet-400/60" />}
          >
            <Input
              value={config.rfidTag}
              onChange={(e) => updateConfig({ rfidTag: e.target.value })}
              className="h-9 bg-surface-inset border-b-default text-white text-[12px] rounded-lg focus-visible:ring-violet-500/30"
            />
          </Field>
          <Field
            label="Connectors"
            icon={<Plug className="h-3 w-3 text-violet-400/60" />}
          >
            <Dropdown
              value={String(config.numberOfConnectors)}
              disabled={locked}
              options={[
                { label: "1 Connector", value: "1" },
                { label: "2 Connectors", value: "2" },
              ]}
              onChange={(v) =>
                updateConfig({ numberOfConnectors: Number(v) as 1 | 2 })
              }
            />
          </Field>
        </div>
      </SectionCard>

      {/* Security Profile */}
      <SectionCard
        title="Security"
        icon={<Shield className="h-3.5 w-3.5" />}
        color="text-rose-400"
        description="OCPP Security Profile for connection auth"
      >
        <Field
          label="Security Profile"
          icon={<Shield className="h-3 w-3 text-rose-400/60" />}
        >
          <Dropdown
            value={String(config.securityProfile)}
            disabled={locked}
            options={[
              { label: "0 — No Security", value: "0" },
              { label: "1 — Basic Auth (password in URL)", value: "1" },
            ]}
            onChange={(v) =>
              updateConfig({ securityProfile: Number(v) as 0 | 1 })
            }
          />
        </Field>
        {config.securityProfile > 0 && (
          <Field
            label="Basic Auth Password"
            icon={<Shield className="h-3 w-3 text-rose-400/60" />}
          >
            <Input
              type="password"
              value={config.basicAuthPassword}
              disabled={locked}
              onChange={(e) =>
                updateConfig({ basicAuthPassword: e.target.value })
              }
              className="h-9 bg-surface-inset border-b-default text-white text-[12px] rounded-lg focus-visible:ring-rose-500/30"
              placeholder="Password..."
            />
          </Field>
        )}
      </SectionCard>

      {/* Config Profiles */}
      <ProfilesSection />
    </div>
  );
}

/* ═══════════════════════════════════════════
   BOOT NOTIFICATION TAB
   ═══════════════════════════════════════════ */

const BOOT_FIELDS: {
  key: string;
  label: string;
  icon: React.ReactNode;
  required?: boolean;
}[] = [
  {
    key: "chargePointVendor",
    label: "Vendor",
    icon: <Server className="h-3 w-3 text-cyan-400/60" />,
    required: true,
  },
  {
    key: "chargePointModel",
    label: "Model",
    icon: <HardDrive className="h-3 w-3 text-cyan-400/60" />,
    required: true,
  },
  {
    key: "chargePointSerialNumber",
    label: "CP Serial #",
    icon: <Hash className="h-3 w-3 text-cyan-400/60" />,
  },
  {
    key: "chargeBoxSerialNumber",
    label: "Box Serial #",
    icon: <Hash className="h-3 w-3 text-cyan-400/60" />,
  },
  {
    key: "firmwareVersion",
    label: "Firmware Ver.",
    icon: <Wrench className="h-3 w-3 text-cyan-400/60" />,
  },
  {
    key: "iccid",
    label: "ICCID",
    icon: <CreditCard className="h-3 w-3 text-cyan-400/60" />,
  },
  {
    key: "imsi",
    label: "IMSI",
    icon: <Smartphone className="h-3 w-3 text-cyan-400/60" />,
  },
  {
    key: "meterType",
    label: "Meter Type",
    icon: <Gauge className="h-3 w-3 text-cyan-400/60" />,
  },
  {
    key: "meterSerialNumber",
    label: "Meter Serial #",
    icon: <Hash className="h-3 w-3 text-cyan-400/60" />,
  },
];

function VendorTab() {
  const { status, config, updateBootNotification, updateVendorConfig } =
    useActiveCharger();
  const locked = status === "connected" || status === "connecting";
  const boot = config.bootNotification;
  const vendor = config.vendorConfig;

  return (
    <div className="space-y-4">
      <SectionCard
        title="Hardware Identity"
        icon={<Cpu className="h-3.5 w-3.5" />}
        color="text-cyan-400"
        description="Sent to CSMS via BootNotification on connection."
      >
        <div className="grid grid-cols-2 gap-3">
          {BOOT_FIELDS.map(({ key, label, icon, required }) => (
            <Field key={key} label={label} icon={icon} required={required}>
              <Input
                value={(boot as any)[key] ?? ""}
                disabled={locked}
                onChange={(e) =>
                  updateBootNotification({ [key]: e.target.value } as any)
                }
                className="h-9 bg-surface-inset border-b-default text-white text-[12px] font-mono rounded-lg focus-visible:ring-cyan-500/30"
              />
            </Field>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title="Vendor Custom Extensions"
        icon={<Server className="h-3.5 w-3.5" />}
        color="text-indigo-400"
        description="DataTransfer & Boot customData"
      >
        <div className="space-y-3">
          <Field
            label="Vendor ID"
            icon={<HardDrive className="h-3 w-3 text-indigo-400/60" />}
          >
            <Input
              value={vendor?.vendorId ?? ""}
              onChange={(e) => updateVendorConfig({ vendorId: e.target.value })}
              className="h-9 bg-surface-inset border-b-default text-white text-[12px] font-mono rounded-lg focus-visible:ring-indigo-500/30"
              placeholder="e.g. com.elmo.virtual"
            />
          </Field>
          <Field
            label="Custom Data Payload (JSON)"
            icon={<SlidersHorizontal className="h-3 w-3 text-indigo-400/60" />}
          >
            <textarea
              value={vendor?.customDataStr ?? "{}"}
              onChange={(e) =>
                updateVendorConfig({ customDataStr: e.target.value })
              }
              className="w-full h-24 bg-white/3 border border-white/8 text-white text-[11px] font-mono rounded-lg p-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500/30 resize-none custom-scrollbar"
              placeholder='{"customKey": "value"}'
              spellCheck={false}
            />
          </Field>

          <Button
            onClick={() => {
              import("@/lib/ocppClient").then((m) =>
                m.getService(config.chargePointId).sendDataTransfer(),
              );
            }}
            disabled={!vendor?.vendorId || locked !== true}
            className="w-full h-8 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/20 font-bold text-[10px] uppercase tracking-wider rounded-lg transition-colors mt-2"
          >
            {locked !== true
              ? "Connect to Send DataTransfer"
              : "Send DataTransfer"}
            <MessageSquare className="h-3 w-3 ml-2 shrink-0 opacity-70" />
          </Button>
        </div>
      </SectionCard>

      <SectionCard
        title="Simulated Vendor Errors"
        icon={<Plug className="h-3.5 w-3.5" />}
        color="text-rose-400"
        description="Overrides standard StatusNotification error codes"
      >
        <Field
          label="Vendor Error Code"
          icon={<MessageSquare className="h-3 w-3 text-rose-400/60" />}
        >
          <Input
            value={vendor?.vendorErrorCode ?? ""}
            onChange={(e) =>
              updateVendorConfig({ vendorErrorCode: e.target.value })
            }
            className="h-9 bg-surface-inset border-b-default text-white text-[12px] font-mono rounded-lg focus-visible:ring-rose-500/30"
            placeholder="e.g. 0x01B (Optional)"
          />
        </Field>
      </SectionCard>
    </div>
  );
}

/* ═══════════════════════════════════════════
   STATION CONFIG TAB
   ═══════════════════════════════════════════ */

// ── Helpers for UI Grouping ──
const GROUP_16_SECURITY = ["SecurityProfile", "AuthorizationKey"];
const GROUP_16_SMART_CHARGING = [
  "ChargeProfileMaxStackLevel",
  "MaxChargingProfilesInstalled",
  "ChargingScheduleAllowedChargingRateUnit",
  "ChargingScheduleMaxPeriods",
];
const GROUP_16_LOCAL_AUTH = [
  "LocalAuthListMaxLength",
  "SendLocalListMaxLength",
  "LocalAuthorizeOffline",
  "LocalPreAuthorize",
];

function StationConfigTab() {
  const { config, updateStationConfigKey, setDeviceVariable, deviceModel } =
    useActiveCharger();
  const is2x = config.ocppVersion !== "ocpp1.6";

  if (is2x) {
    // ── OCPP 2.x Device Model view ──
    const grouped = deviceModel.reduce(
      (acc, v) => {
        if (!acc[v.component]) acc[v.component] = [];
        acc[v.component].push(v);
        return acc;
      },
      {} as Record<string, typeof deviceModel>,
    );

    return (
      <div className="space-y-4">
        {Object.entries(grouped).map(([compName, vars]) => {
          const editableCount = vars.filter(
            (v) => v.mutability !== "ReadOnly",
          ).length;
          return (
            <SectionCard
              key={compName}
              title={compName}
              icon={<SlidersHorizontal className="h-3.5 w-3.5" />}
              color="text-amber-400"
              description={`${vars.length} vars · ${editableCount} writable`}
            >
              <div className="space-y-0.5 -mx-1">
                {vars.map((v) => (
                  <div
                    key={`${v.component}/${v.variable}`}
                    className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-white/3 transition-colors"
                  >
                    <div className="flex-1 min-w-0 flex items-center gap-1.5 mr-2">
                      <span
                        className={`text-[11px] font-mono truncate ${
                          v.mutability === "ReadOnly"
                            ? "text-t-faint"
                            : "text-t-secondary font-medium"
                        }`}
                        title={v.variable}
                      >
                        {v.variable}
                      </span>
                      {v.mutability === "ReadOnly" && (
                        <Badge
                          variant="outline"
                          className="text-[7px] px-1 py-0 h-3 text-amber-400/70 border-amber-400/15 bg-amber-400/5 shrink-0 font-mono"
                        >
                          RO
                        </Badge>
                      )}
                    </div>
                    <Input
                      value={v.value}
                      disabled={v.mutability === "ReadOnly"}
                      onChange={(e) =>
                        setDeviceVariable(
                          v.component,
                          v.variable,
                          e.target.value,
                        )
                      }
                      className="h-7 text-[10px] w-32 shrink-0 font-mono bg-surface-inset border-b-default text-white rounded-md focus-visible:ring-amber-500/30"
                    />
                  </div>
                ))}
              </div>
            </SectionCard>
          );
        })}
      </div>
    );
  }

  // ── OCPP 1.6 Station Config ──
  const keys = config.stationConfig;

  const grouped = keys.reduce(
    (acc, k) => {
      if (GROUP_16_SECURITY.includes(k.key)) acc.Security.push(k);
      else if (GROUP_16_SMART_CHARGING.includes(k.key))
        acc["Smart Charging"].push(k);
      else if (GROUP_16_LOCAL_AUTH.includes(k.key))
        acc["Local Auth List"].push(k);
      else acc["Core / Misc"].push(k);
      return acc;
    },
    {
      "Core / Misc": [],
      Security: [],
      "Smart Charging": [],
      "Local Auth List": [],
    } as Record<string, typeof keys>,
  );

  return (
    <div className="space-y-4">
      {Object.entries(grouped)
        .filter(([_, list]) => list.length > 0)
        .map(([groupName, groupKeys]) => {
          const editableCount = groupKeys.filter((k) => !k.readonly).length;
          return (
            <SectionCard
              key={groupName}
              title={groupName}
              icon={<SlidersHorizontal className="h-3.5 w-3.5" />}
              color="text-amber-400"
              description={`${groupKeys.length} keys · ${editableCount} editable`}
            >
              <div className="space-y-0.5 -mx-1">
                {groupKeys.map((k) => (
                  <div
                    key={k.key}
                    className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-white/3 transition-colors"
                  >
                    <div className="flex-1 min-w-0 flex items-center gap-1.5 mr-2">
                      <span
                        className={`text-[11px] font-mono truncate ${
                          k.readonly
                            ? "text-t-faint"
                            : "text-t-secondary font-medium"
                        }`}
                        title={k.key}
                      >
                        {k.key}
                      </span>
                      {k.readonly && (
                        <Badge
                          variant="outline"
                          className="text-[7px] px-1 py-0 h-3 text-amber-400/70 border-amber-400/15 bg-amber-400/5 shrink-0 font-mono"
                        >
                          RO
                        </Badge>
                      )}
                    </div>
                    <Input
                      value={k.value}
                      disabled={k.readonly}
                      onChange={(e) =>
                        updateStationConfigKey(k.key, e.target.value)
                      }
                      className="h-7 text-[10px] w-32 shrink-0 font-mono bg-surface-inset border-b-default text-white rounded-md focus-visible:ring-amber-500/30"
                    />
                  </div>
                ))}
              </div>
            </SectionCard>
          );
        })}
    </div>
  );
}

/* ═══════════════════════════════════════════
   SIMULATION TAB
   ═══════════════════════════════════════════ */

const FIRMWARE_STATUSES = [
  "NotDownloaded",
  "Downloading",
  "Downloaded",
  "Installing",
  "Installed",
  "SignatureError",
  "ChecksumError",
  "DownloadFailed",
  "InstallationFailed",
].map((s) => ({ label: s, value: s }));

function SimulationTab() {
  const { config, updateSimulation, isUploading, uploadSecondsLeft, status } =
    useActiveCharger();
  const { simulation } = config;
  const isConnected = status === "connected";

  return (
    <div className="space-y-4">
      {/* Diagnostics Upload */}
      <SectionCard
        title="Diagnostics Upload"
        icon={<FileText className="h-3.5 w-3.5" />}
        color="text-pink-400"
      >
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="File Name"
            icon={<FileText className="h-3 w-3 text-pink-400/60" />}
          >
            <Input
              value={simulation.diagnosticFileName}
              onChange={(e) =>
                updateSimulation({ diagnosticFileName: e.target.value })
              }
              className="h-9 bg-surface-inset border-b-default text-white text-[12px] rounded-lg focus-visible:ring-pink-500/30"
            />
          </Field>
          <Field
            label="Duration (s)"
            icon={<Clock className="h-3 w-3 text-pink-400/60" />}
          >
            <Input
              type="number"
              value={simulation.diagnosticUploadTime}
              onChange={(e) =>
                updateSimulation({
                  diagnosticUploadTime: Number(e.target.value),
                })
              }
              className="h-9 bg-surface-inset border-b-default text-white text-[12px] rounded-lg focus-visible:ring-pink-500/30"
            />
          </Field>
        </div>
        <Field label="Final Status">
          <Dropdown
            value={simulation.diagnosticStatus}
            options={[
              { label: "Uploaded", value: "Uploaded" },
              { label: "UploadFailed", value: "UploadFailed" },
            ]}
            onChange={(v) =>
              updateSimulation({
                diagnosticStatus: v as "Uploaded" | "UploadFailed",
              })
            }
          />
        </Field>

        {isUploading && (
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-cyan-500/8 border border-cyan-500/15 text-cyan-300 text-[11px] animate-pulse">
            <Upload className="h-3.5 w-3.5 animate-bounce shrink-0" />
            Uploading…{" "}
            <span className="font-mono font-bold">{uploadSecondsLeft}s</span>{" "}
            left
          </div>
        )}

        <Button
          size="sm"
          disabled={!isConnected || isUploading}
          onClick={() => ocppService.startDiagnosticsUpload()}
          className="w-full h-8 bg-pink-500/10 hover:bg-pink-500/18 text-pink-300 border border-pink-500/15 text-[10px] font-bold uppercase tracking-wider rounded-lg cursor-pointer"
        >
          <Upload className="mr-1.5 h-3 w-3" /> Trigger Upload
        </Button>
      </SectionCard>

      {/* Firmware */}
      <SectionCard
        title="Firmware"
        icon={<Shield className="h-3.5 w-3.5" />}
        color="text-emerald-400"
      >
        <Field
          label="Firmware Status"
          icon={<Shield className="h-3 w-3 text-emerald-400/60" />}
        >
          <Dropdown
            value={simulation.firmwareStatus}
            options={FIRMWARE_STATUSES}
            onChange={(v) =>
              updateSimulation({ firmwareStatus: v || undefined })
            }
          />
        </Field>
        <Button
          size="sm"
          disabled={!isConnected}
          onClick={() =>
            ocppService.sendFirmwareStatus(simulation.firmwareStatus)
          }
          className="w-full h-8 bg-emerald-500/10 hover:bg-emerald-500/18 text-emerald-300 border border-emerald-500/15 text-[10px] font-bold uppercase tracking-wider rounded-lg cursor-pointer"
        >
          <Shield className="mr-1.5 h-3 w-3" /> Send FirmwareStatus
        </Button>
      </SectionCard>

      {/* Auto Charging */}
      <SectionCard
        title="Auto Charging"
        icon={<FlaskConical className="h-3.5 w-3.5" />}
        color="text-violet-400"
        description="Configure the auto-charge state machine behavior"
      >
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Target kWh"
            icon={<Gauge className="h-3 w-3 text-violet-400/60" />}
          >
            <Input
              type="number"
              value={simulation.autoChargeTargetKWh}
              onChange={(e) =>
                updateSimulation({
                  autoChargeTargetKWh: Number(e.target.value),
                })
              }
              className="h-9 bg-surface-inset border-b-default text-white text-[12px] rounded-lg focus-visible:ring-violet-500/30"
            />
          </Field>
          <Field
            label="Duration (s)"
            icon={<Clock className="h-3 w-3 text-violet-400/60" />}
          >
            <Input
              type="number"
              value={simulation.autoChargeDurationSec}
              onChange={(e) =>
                updateSimulation({
                  autoChargeDurationSec: Number(e.target.value),
                })
              }
              className="h-9 bg-surface-inset border-b-default text-white text-[12px] rounded-lg focus-visible:ring-violet-500/30"
            />
          </Field>
        </div>
        <Field
          label="Meter Increment / tick (Wh)"
          icon={<Gauge className="h-3 w-3 text-violet-400/60" />}
        >
          <Input
            type="number"
            value={simulation.autoChargeMeterIncrement}
            onChange={(e) =>
              updateSimulation({
                autoChargeMeterIncrement: Number(e.target.value),
              })
            }
            className="h-9 bg-surface-inset border-b-default text-white text-[12px] rounded-lg focus-visible:ring-violet-500/30"
          />
        </Field>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={simulation.autoChargeSocEnabled}
            onChange={(e) =>
              updateSimulation({ autoChargeSocEnabled: e.target.checked })
            }
            className="accent-violet-500 h-3.5 w-3.5 rounded"
          />
          <span className="text-[11px] text-t-muted">
            Include SoC &amp; Temperature in MeterValues
          </span>
        </label>
      </SectionCard>

      {/* Response Latency */}
      <SectionCard
        title="Response Latency"
        icon={<Clock className="h-3.5 w-3.5" />}
        color="text-amber-400"
        description="Add artificial delay to all OCPP responses to test CSMS timeouts"
      >
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={30000}
            step={500}
            value={simulation.responseDelayMs}
            onChange={(e) =>
              updateSimulation({ responseDelayMs: Number(e.target.value) })
            }
            className="flex-1 accent-amber-500 h-1.5 cursor-pointer"
          />
          <span className="shrink-0 text-[11px] font-mono text-t-secondary tabular-nums w-14 text-right">
            {simulation.responseDelayMs >= 1000
              ? `${(simulation.responseDelayMs / 1000).toFixed(1)}s`
              : `${simulation.responseDelayMs}ms`}
          </span>
        </div>
        {simulation.responseDelayMs > 0 && (
          <p className="text-[10px] text-amber-400/60 mt-1">
            ⏱ All handler responses will be delayed by{" "}
            {simulation.responseDelayMs >= 1000
              ? `${(simulation.responseDelayMs / 1000).toFixed(1)}s`
              : `${simulation.responseDelayMs}ms`}
          </p>
        )}
      </SectionCard>

      {/* Fault Injection */}
      <FaultInjectionSection />

      {/* Raw Payload Injection */}
      <RawPayloadSection />
    </div>
  );
}

/* ═══════════════════════════════════════════
   FAULT INJECTION SECTION
   ═══════════════════════════════════════════ */

const FAULTS = [
  {
    code: "GroundFailure",
    label: "Ground Fault",
    color: "text-red-400 bg-red-500/10 border-red-500/20 hover:bg-red-500/20",
  },
  {
    code: "OverVoltage",
    label: "Over Voltage",
    color:
      "text-amber-400 bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/20",
  },
  {
    code: "PowerMeterFailure",
    label: "Meter Fail",
    color:
      "text-orange-400 bg-orange-500/10 border-orange-500/20 hover:bg-orange-500/20",
  },
  {
    code: "EVCommunicationError",
    label: "EV Comm Error",
    color:
      "text-pink-400 bg-pink-500/10 border-pink-500/20 hover:bg-pink-500/20",
  },
  {
    code: "ReaderFailure",
    label: "Reader Fail",
    color:
      "text-violet-400 bg-violet-500/10 border-violet-500/20 hover:bg-violet-500/20",
  },
  {
    code: "InternalError",
    label: "Internal Error",
    color:
      "text-rose-400 bg-rose-500/10 border-rose-500/20 hover:bg-rose-500/20",
  },
] as const;

function FaultInjectionSection() {
  const { status, config } = useActiveCharger();
  const isConnected = status === "connected";
  const [lastFault, setLastFault] = useState("");

  const inject = (code: string) => {
    for (let i = 1; i <= config.numberOfConnectors; i++) {
      ocppService.triggerFault(i, code);
    }
    setLastFault(code);
    setTimeout(() => setLastFault(""), 2000);
  };

  return (
    <SectionCard
      title="Fault Injection"
      icon={<AlertTriangle className="h-3.5 w-3.5" />}
      color="text-red-400"
      description="Simulate hardware faults — stops active transactions and sends Faulted status"
    >
      <div className="grid grid-cols-2 gap-2">
        {FAULTS.map((f) => (
          <button
            key={f.code}
            disabled={!isConnected}
            onClick={() => inject(f.code)}
            className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg border text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
              f.color
            } ${lastFault === f.code ? "ring-1 ring-white/30 scale-95" : ""}`}
          >
            <Zap className="h-3 w-3" />
            {f.label}
          </button>
        ))}
      </div>
      {lastFault && (
        <p className="text-[10px] text-red-400/80 mt-2 animate-pulse">
          ⚡ Injected fault:{" "}
          <span className="font-mono font-bold">{lastFault}</span>
        </p>
      )}
    </SectionCard>
  );
}

/* ═══════════════════════════════════════════
   RAW PAYLOAD INJECTION
   ═══════════════════════════════════════════ */

function RawPayloadSection() {
  const { status } = useActiveCharger();
  const isConnected = status === "connected";
  const [raw, setRaw] = useState('[2,"test-123","Heartbeat",{}]');
  const [sent, setSent] = useState(false);

  const handleSend = () => {
    if (!raw.trim()) return;
    ocppService.sendRawString(raw);
    setSent(true);
    setTimeout(() => setSent(false), 1500);
  };

  return (
    <SectionCard
      title="Raw Payload Injection"
      icon={<Terminal className="h-3.5 w-3.5" />}
      color="text-rose-400"
      description="Send arbitrary strings directly over the WebSocket — bypasses OCPP validation"
    >
      <textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        rows={3}
        spellCheck={false}
        className="w-full bg-black/30 border border-b-default rounded-lg p-3 font-mono text-[11px] text-t-secondary resize-y focus:outline-none focus:ring-1 focus:ring-rose-500/40 placeholder:text-t-faint"
        placeholder='[2,"uuid","Action",{...}]'
      />
      <Button
        size="sm"
        disabled={!isConnected || !raw.trim()}
        onClick={handleSend}
        className={`w-full h-8 text-[10px] font-bold uppercase tracking-wider rounded-lg cursor-pointer transition-all ${
          sent
            ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
            : "bg-rose-500/10 hover:bg-rose-500/18 text-rose-300 border border-rose-500/15"
        }`}
      >
        {sent ? (
          <>
            <Check className="mr-1.5 h-3 w-3" /> Sent!
          </>
        ) : (
          <>
            <Send className="mr-1.5 h-3 w-3" /> Inject Raw Payload
          </>
        )}
      </Button>
      <p className="text-[9px] text-t-faint mt-1">
        Tip: Use OCPP Call format{" "}
        <code className="text-rose-400/60">
          [2, &quot;id&quot;, &quot;Action&quot;, &#123;&#125;]
        </code>{" "}
        or send completely malformed data to test error handling.
      </p>
    </SectionCard>
  );
}
/* ═══════════════════════════════════════════
   LOCAL AUTH LIST TAB
   ═══════════════════════════════════════════ */

const STATUS_COLORS: Record<string, string> = {
  Accepted: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  Blocked: "text-red-400 bg-red-500/10 border-red-500/20",
  Expired: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  Invalid: "text-rose-400 bg-rose-500/10 border-rose-500/20",
  ConcurrentTx: "text-violet-400 bg-violet-500/10 border-violet-500/20",
};

function LocalAuthListTab() {
  const { localAuthList, localAuthListVersion } = useActiveCharger();
  const [search, setSearch] = useState("");

  const filtered = search.trim()
    ? localAuthList.filter(
        (e) =>
          e.idTag.toLowerCase().includes(search.toLowerCase()) ||
          (e.idTagInfo?.status ?? "")
            .toLowerCase()
            .includes(search.toLowerCase()),
      )
    : localAuthList;

  return (
    <div className="space-y-4">
      <SectionCard
        title="Local Authorization List"
        icon={<KeyRound className="h-3.5 w-3.5" />}
        color="text-emerald-400"
        description={`List version: ${localAuthListVersion} · ${localAuthList.length} entries`}
      >
        {/* Search */}
        {localAuthList.length > 0 && (
          <div className="relative mb-3">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-t-faint" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search idTag or status..."
              className="h-8 pl-8 bg-surface-inset border-b-default text-white text-[11px] rounded-lg focus-visible:ring-emerald-500/30"
            />
          </div>
        )}

        {/* Table */}
        {filtered.length > 0 ? (
          <div className="rounded-lg border border-b-default overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-[1fr_80px_90px] gap-2 px-3 py-1.5 bg-surface-inset text-[9px] font-bold text-t-faint uppercase tracking-wider">
              <span>ID Tag</span>
              <span>Status</span>
              <span>Expiry</span>
            </div>
            {/* Rows */}
            <div className="divide-y divide-white/5 max-h-[400px] overflow-y-auto custom-scrollbar">
              {filtered.map((entry) => {
                const status = entry.idTagInfo?.status ?? "Unknown";
                const expiry = entry.idTagInfo?.expiryDate;
                return (
                  <div
                    key={entry.idTag}
                    className="grid grid-cols-[1fr_80px_90px] gap-2 px-3 py-2 text-[11px] hover:bg-surface-hover transition-colors"
                  >
                    <span className="font-mono text-t-secondary truncate">
                      {entry.idTag}
                    </span>
                    <span
                      className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[9px] font-bold border ${
                        STATUS_COLORS[status] ??
                        "text-t-faint bg-white/5 border-white/10"
                      }`}
                    >
                      {status}
                    </span>
                    <span className="text-[9px] text-t-faint font-mono truncate">
                      {expiry ? new Date(expiry).toLocaleDateString() : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <KeyRound className="h-8 w-8 text-[#232636] mb-3" />
            <p className="text-[11px] text-t-muted font-semibold">
              {localAuthList.length === 0
                ? "No entries yet"
                : "No matching entries"}
            </p>
            <p className="text-[9px] text-t-faint mt-1">
              {localAuthList.length === 0
                ? "Connect to a CSMS and wait for a SendLocalList command"
                : "Try a different search term"}
            </p>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

/* ═══════════════════════════════════════════
   MESSAGE COMPOSER TAB
   ═══════════════════════════════════════════ */

const OCPP_ACTIONS = [
  "Authorize",
  "BootNotification",
  "DataTransfer",
  "DiagnosticsStatusNotification",
  "FirmwareStatusNotification",
  "Heartbeat",
  "MeterValues",
  "StartTransaction",
  "StatusNotification",
  "StopTransaction",
  "SecurityEventNotification",
  "LogStatusNotification",
  "SignCertificate",
];

interface ComposerHistory {
  action: string;
  payload: string;
  timestamp: string;
}

function MessageComposerTab() {
  const { status } = useActiveCharger();
  const isConnected = status === "connected";
  const [action, setAction] = useState("Heartbeat");
  const [payload, setPayload] = useState("{}");
  const [sending, setSending] = useState(false);
  const [jsonError, setJsonError] = useState("");
  const [history, setHistory] = useState<ComposerHistory[]>([]);

  const handleSend = async () => {
    setJsonError("");
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(payload);
    } catch {
      setJsonError("Invalid JSON");
      return;
    }
    setSending(true);
    setHistory((h) => [
      { action, payload, timestamp: new Date().toLocaleTimeString() },
      ...h.slice(0, 9),
    ]);
    await ocppService.sendRawCall(action, parsed);
    setSending(false);
  };

  const loadFromHistory = (item: ComposerHistory) => {
    setAction(item.action);
    setPayload(item.payload);
  };

  return (
    <div className="space-y-4">
      <SectionCard
        title="Send OCPP Message"
        icon={<MessageSquare className="h-3.5 w-3.5" />}
        color="text-orange-400"
        description="Send any CP → CSMS action with custom payload"
      >
        <Field
          label="Action"
          icon={<MessageSquare className="h-3 w-3 text-orange-400/60" />}
        >
          <div className="flex gap-2">
            <div className="flex-1">
              <Dropdown
                value={action}
                options={OCPP_ACTIONS.map((a) => ({ label: a, value: a }))}
                onChange={(v) => setAction(v)}
              />
            </div>
          </div>
        </Field>

        <Field label="Payload (JSON)">
          <textarea
            value={payload}
            onChange={(e) => {
              setPayload(e.target.value);
              setJsonError("");
            }}
            rows={6}
            spellCheck={false}
            className="w-full bg-black/30 border border-b-default rounded-lg p-3 font-mono text-[11px] text-t-secondary resize-y focus:outline-none focus:ring-1 focus:ring-orange-500/40 placeholder:text-t-faint"
            placeholder='{ "key": "value" }'
          />
          {jsonError && (
            <p className="text-[10px] text-rose-400 font-mono mt-1">
              {jsonError}
            </p>
          )}
        </Field>

        <Button
          disabled={!isConnected || sending}
          onClick={handleSend}
          className="w-full h-9 bg-orange-500/12 hover:bg-orange-500/22 text-orange-300 border border-orange-500/20 font-bold text-[11px] uppercase tracking-wider rounded-lg cursor-pointer gap-2"
        >
          <Send className="h-3.5 w-3.5" />
          {sending ? "Sending…" : "Send"}
        </Button>
      </SectionCard>

      {/* History */}
      {history.length > 0 && (
        <SectionCard
          title="History"
          icon={<Clock className="h-3.5 w-3.5" />}
          color="text-t-muted"
        >
          <div className="space-y-1 max-h-48 overflow-y-auto custom-scrollbar">
            {history.map((h, i) => (
              <button
                key={`${i}-${h.action}`}
                onClick={() => loadFromHistory(h)}
                className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-white/2 hover:bg-white/5 border border-white/5 transition-colors cursor-pointer text-left"
              >
                <span className="text-[11px] font-medium text-slate-300 truncate">
                  {h.action}
                </span>
                <span className="text-[9px] font-mono text-t-faint shrink-0">
                  {h.timestamp}
                </span>
              </button>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   CONFIG PANEL
   ═══════════════════════════════════════════ */

export function ConfigPanel({ onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<TabId>("connection");

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5 shrink-0">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-md bg-linear-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
            <Settings2 className="h-3 w-3 text-white" />
          </div>
          <span className="text-[13px] font-bold text-white">Config</span>
        </div>
        <button
          onClick={onClose}
          className="h-6 w-6 rounded-md flex items-center justify-center text-t-muted hover:text-white hover:bg-surface-hover transition-colors cursor-pointer"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Tab strip */}
      <div className="flex items-center gap-0.5 px-3 py-2 border-b border-white/5 shrink-0">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-semibold transition-all cursor-pointer ${
                active
                  ? `bg-surface-inset ${tab.color} border border-b-default`
                  : "text-t-muted hover:text-t-secondary hover:bg-surface-hover border border-transparent"
              }`}
            >
              <Icon className="h-3 w-3" />
              <span className="hidden xl:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-3">
        {activeTab === "connection" && <ConnectionTab />}
        {activeTab === "vendor" && <VendorTab />}
        {activeTab === "station" && <StationConfigTab />}
        {activeTab === "simulation" && <SimulationTab />}
        {activeTab === "auth" && <LocalAuthListTab />}
        {activeTab === "composer" && <MessageComposerTab />}
      </div>
    </div>
  );
}
