"use client";

import {
  Clock,
  Cpu,
  CreditCard,
  FileText,
  FlaskConical,
  Gauge,
  Globe,
  HardDrive,
  Hash,
  Layers,
  Plug,
  Server,
  Settings2,
  Shield,
  SlidersHorizontal,
  Smartphone,
  Tag,
  Upload,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useActiveCharger } from "@/hooks/useActiveCharger";
import { ocppService } from "@/lib/ocppClient";

interface ConfigSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/* ─────────────────────────────── FIELD COMPONENT ────────────────────────── */
function Field({
  label,
  icon,
  required,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-slate-400 text-[11px] font-medium flex items-center gap-1.5">
        {icon}
        {label}
        {required && <span className="text-red-400">*</span>}
      </Label>
      {children}
    </div>
  );
}

/* ─────────────────────────────── CONNECTION ─────────────────────────────── */
function ConnectionTab() {
  const { status, config, updateConfig } = useActiveCharger();
  const disabled = status === "connected" || status === "connecting";

  return (
    <div className="space-y-6">
      <div className="p-4 rounded-2xl bg-linear-to-br from-blue-500/10 to-indigo-500/5 border border-blue-500/15">
        <p className="text-xs font-semibold text-blue-300 uppercase tracking-wider mb-4 flex items-center gap-2">
          <Globe className="h-3.5 w-3.5" /> WebSocket Endpoint
        </p>
        <Field
          label="CSMS URL"
          icon={<Globe className="h-3 w-3 text-blue-400" />}
        >
          <Input
            value={config.endpoint}
            disabled={disabled}
            onChange={(e) => updateConfig({ endpoint: e.target.value })}
            className="glass-input text-white h-10"
            placeholder="ws://localhost:9000"
          />
        </Field>
      </div>

      <div className="p-4 rounded-2xl bg-linear-to-br from-purple-500/10 to-violet-500/5 border border-purple-500/15">
        <p className="text-xs font-semibold text-purple-300 uppercase tracking-wider mb-4 flex items-center gap-2">
          <Hash className="h-3.5 w-3.5" /> Identity
        </p>
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Charge Point ID"
            icon={<Hash className="h-3 w-3 text-purple-400" />}
          >
            <Input
              value={config.chargePointId}
              disabled={disabled}
              onChange={(e) => updateConfig({ chargePointId: e.target.value })}
              className="glass-input text-white h-10"
            />
          </Field>
          <Field
            label="OCPP Version"
            icon={<Layers className="h-3 w-3 text-purple-400" />}
          >
            <Select
              value={config.ocppVersion}
              disabled={disabled}
              onValueChange={(v: any) => updateConfig({ ocppVersion: v })}
            >
              <SelectTrigger className="glass-input text-white h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 text-white border-white/10">
                <SelectItem value="ocpp1.6">OCPP 1.6 JSON</SelectItem>
                <SelectItem value="ocpp2.0.1">OCPP 2.0.1</SelectItem>
                <SelectItem value="ocpp2.1">OCPP 2.1</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field
            label="Default RFID Tag"
            icon={<Tag className="h-3 w-3 text-purple-400" />}
          >
            <Input
              value={config.rfidTag}
              onChange={(e) => updateConfig({ rfidTag: e.target.value })}
              className="glass-input text-white h-10"
            />
          </Field>
          <Field
            label="Connectors"
            icon={<Plug className="h-3 w-3 text-purple-400" />}
          >
            <Select
              value={String(config.numberOfConnectors)}
              disabled={disabled}
              onValueChange={(v) =>
                updateConfig({ numberOfConnectors: Number(v) as 1 | 2 })
              }
            >
              <SelectTrigger className="glass-input text-white h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 text-white border-white/10">
                <SelectItem value="1">1 Connector</SelectItem>
                <SelectItem value="2">2 Connectors</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────── BOOT NOTIFICATION ──────────────────────── */
const BOOT_FIELDS: {
  key: string;
  label: string;
  icon: React.ReactNode;
  required?: boolean;
}[] = [
  {
    key: "chargePointVendor",
    label: "Vendor",
    icon: <Server className="h-3 w-3 text-cyan-400" />,
    required: true,
  },
  {
    key: "chargePointModel",
    label: "Model",
    icon: <HardDrive className="h-3 w-3 text-cyan-400" />,
    required: true,
  },
  {
    key: "chargePointSerialNumber",
    label: "CP Serial Number",
    icon: <Hash className="h-3 w-3 text-cyan-400" />,
  },
  {
    key: "chargeBoxSerialNumber",
    label: "Box Serial Number",
    icon: <Hash className="h-3 w-3 text-cyan-400" />,
  },
  {
    key: "firmwareVersion",
    label: "Firmware Version",
    icon: <Wrench className="h-3 w-3 text-cyan-400" />,
  },
  {
    key: "iccid",
    label: "ICCID",
    icon: <CreditCard className="h-3 w-3 text-cyan-400" />,
  },
  {
    key: "imsi",
    label: "IMSI",
    icon: <Smartphone className="h-3 w-3 text-cyan-400" />,
  },
  {
    key: "meterType",
    label: "Meter Type",
    icon: <Gauge className="h-3 w-3 text-cyan-400" />,
  },
  {
    key: "meterSerialNumber",
    label: "Meter Serial #",
    icon: <Hash className="h-3 w-3 text-cyan-400" />,
  },
];

function BootNotificationTab() {
  const { status, config, updateBootNotification } = useActiveCharger();
  const disabled = status === "connected" || status === "connecting";
  const boot = config.bootNotification;

  return (
    <div className="p-4 rounded-2xl bg-linear-to-br from-cyan-500/10 to-teal-500/5 border border-cyan-500/15 space-y-4">
      <p className="text-xs font-semibold text-cyan-300 uppercase tracking-wider flex items-center gap-2">
        <Cpu className="h-3.5 w-3.5" /> Hardware Identity
      </p>
      <p className="text-[11px] text-t-muted -mt-2">
        These fields are sent to the CSMS on connection via{" "}
        <code className="text-cyan-400/80 font-mono">BootNotification</code>.
      </p>
      <div className="grid grid-cols-2 gap-4">
        {BOOT_FIELDS.map(({ key, label, icon, required }) => (
          <Field key={key} label={label} icon={icon} required={required}>
            <Input
              value={(boot as any)[key] ?? ""}
              disabled={disabled}
              onChange={(e) =>
                updateBootNotification({ [key]: e.target.value } as any)
              }
              className="glass-input text-white h-10"
            />
          </Field>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────── STATION CONFIG ─────────────────────────── */
function StationConfigTab() {
  const { config, updateStationConfigKey } = useActiveCharger();
  const keys = config.stationConfig;
  const editableCount = keys.filter((k) => !k.readonly).length;

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-2xl bg-linear-to-br from-amber-500/10 to-orange-500/5 border border-amber-500/15">
        <p className="text-xs font-semibold text-amber-300 uppercase tracking-wider flex items-center gap-2 mb-1">
          <SlidersHorizontal className="h-3.5 w-3.5" /> Configuration Keys
        </p>
        <p className="text-[11px] text-t-muted mb-4">
          {keys.length} total keys · {editableCount} editable · Returned by{" "}
          <code className="text-amber-400/80 font-mono">GetConfiguration</code>
        </p>

        <div className="space-y-1">
          {keys.map((k) => (
            <div
              key={k.key}
              className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-surface-hover transition-colors group"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-xs font-mono truncate ${
                      k.readonly ? "text-t-faint" : "text-t-secondary"
                    }`}
                  >
                    {k.key}
                  </span>
                  {k.readonly && (
                    <Badge
                      variant="outline"
                      className="text-[8px] px-1 py-0 h-3.5 text-amber-400/80 border-amber-400/20 bg-amber-400/5 shrink-0 font-mono"
                    >
                      RO
                    </Badge>
                  )}
                </div>
              </div>
              <Input
                value={k.value}
                disabled={k.readonly}
                onChange={(e) => updateStationConfigKey(k.key, e.target.value)}
                className="glass-input text-white h-8 text-xs w-40 shrink-0 font-mono"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────── SIMULATION ─────────────────────────────── */
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
];

function SimulationTab() {
  const { config, updateSimulation, isUploading, uploadSecondsLeft, status } =
    useActiveCharger();
  const { simulation } = config;
  const isConnected = status === "connected";

  return (
    <div className="space-y-5">
      {/* Diagnostics */}
      <div className="p-4 rounded-2xl bg-linear-to-br from-pink-500/10 to-rose-500/5 border border-pink-500/15 space-y-4">
        <p className="text-xs font-semibold text-pink-300 uppercase tracking-wider flex items-center gap-2">
          <FileText className="h-3.5 w-3.5" /> Diagnostics Upload
        </p>
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="File Name"
            icon={<FileText className="h-3 w-3 text-pink-400" />}
          >
            <Input
              value={simulation.diagnosticFileName}
              onChange={(e) =>
                updateSimulation({ diagnosticFileName: e.target.value })
              }
              className="glass-input text-white h-10"
            />
          </Field>
          <Field
            label="Upload Duration (s)"
            icon={<Clock className="h-3 w-3 text-pink-400" />}
          >
            <Input
              type="number"
              value={simulation.diagnosticUploadTime}
              onChange={(e) =>
                updateSimulation({
                  diagnosticUploadTime: Number(e.target.value),
                })
              }
              className="glass-input text-white h-10"
            />
          </Field>
        </div>
        <Field label="Final Status">
          <Select
            value={simulation.diagnosticStatus}
            onValueChange={(v) =>
              updateSimulation({
                diagnosticStatus: v as "Uploaded" | "UploadFailed",
              })
            }
          >
            <SelectTrigger className="glass-input text-white h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 text-white border-white/10">
              <SelectItem value="Uploaded">Uploaded</SelectItem>
              <SelectItem value="UploadFailed">UploadFailed</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {isUploading && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-sm animate-pulse">
            <Upload className="h-4 w-4 animate-bounce shrink-0" />
            Uploading…{" "}
            <span className="font-mono font-bold">{uploadSecondsLeft}s</span>{" "}
            remaining
          </div>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={!isConnected || isUploading}
          onClick={() => ocppService.startDiagnosticsUpload()}
          className="w-full h-10 glass-input text-pink-300 hover:text-pink-200 hover:bg-pink-500/10 border-pink-500/20"
        >
          <Upload className="mr-2 h-4 w-4" /> Trigger Diagnostics Upload
        </Button>
      </div>

      {/* Firmware */}
      <div className="p-4 rounded-2xl bg-linear-to-br from-emerald-500/10 to-teal-500/5 border border-emerald-500/15 space-y-4">
        <p className="text-xs font-semibold text-emerald-300 uppercase tracking-wider flex items-center gap-2">
          <Shield className="h-3.5 w-3.5" /> Firmware
        </p>
        <Field
          label="Firmware Status"
          icon={<Shield className="h-3 w-3 text-emerald-400" />}
        >
          <Select
            value={simulation.firmwareStatus}
            onValueChange={(v) =>
              updateSimulation({ firmwareStatus: v || undefined })
            }
          >
            <SelectTrigger className="glass-input text-white h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 text-white border-white/10">
              {FIRMWARE_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Button
          size="sm"
          variant="outline"
          disabled={!isConnected}
          onClick={() =>
            ocppService.sendFirmwareStatus(simulation.firmwareStatus)
          }
          className="w-full h-10 glass-input text-emerald-300 hover:text-emerald-200 hover:bg-emerald-500/10 border-emerald-500/20"
        >
          <Shield className="mr-2 h-4 w-4" /> Send FirmwareStatusNotification
        </Button>
      </div>
    </div>
  );
}

/* ────────────────────────────── MAIN CONFIG SHEET ────────────────────────── */
export function ConfigSheet({ open, onOpenChange }: ConfigSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="min-w-[560px] max-w-[90vw] p-0 border-l border-b-default bg-[oklch(0.07_0.015_270/0.98)] backdrop-blur-3xl text-white flex flex-col"
      >
        <SheetHeader className="px-6 py-4 border-b border-b-default shrink-0">
          <SheetTitle className="text-white flex items-center gap-2.5 text-lg font-bold">
            <div className="h-7 w-7 rounded-lg bg-linear-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <Settings2 className="h-4 w-4 text-white" />
            </div>
            Configuration
          </SheetTitle>
        </SheetHeader>

        <Tabs
          defaultValue="connection"
          className="flex flex-col flex-1 overflow-hidden"
        >
          <div className="px-6 pt-4 shrink-0">
            <TabsList className="w-full grid grid-cols-4 bg-surface-inset border border-b-default rounded-2xl p-1.5 min-h-fit">
              <TabsTrigger
                value="connection"
                className="rounded-xl flex items-center cursor-pointer gap-2 py-2.5 data-[state=active]:bg-blue-500/15 data-[state=active]:text-blue-300 data-[state=active]:shadow-[0_0_10px_rgba(59,130,246,0.1)] text-t-muted text-xs font-medium transition-all"
              >
                <Plug className="h-3.5 w-3.5" /> Connect
              </TabsTrigger>
              <TabsTrigger
                value="boot"
                className="rounded-xl flex items-center cursor-pointer gap-2 py-2.5 data-[state=active]:bg-cyan-500/15 data-[state=active]:text-cyan-300 data-[state=active]:shadow-[0_0_10px_rgba(6,182,212,0.1)] text-t-muted text-xs font-medium transition-all"
              >
                <Cpu className="h-3.5 w-3.5" /> Boot
              </TabsTrigger>
              <TabsTrigger
                value="station"
                className="rounded-xl flex items-center cursor-pointer gap-2 py-2.5 data-[state=active]:bg-amber-500/15 data-[state=active]:text-amber-300 data-[state=active]:shadow-[0_0_10px_rgba(245,158,11,0.1)] text-t-muted text-xs font-medium transition-all"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" /> Config
              </TabsTrigger>
              <TabsTrigger
                value="simulation"
                className="rounded-xl flex items-center cursor-pointer gap-2 py-2.5 data-[state=active]:bg-pink-500/15 data-[state=active]:text-pink-300 data-[state=active]:shadow-[0_0_10px_rgba(236,72,153,0.1)] text-t-muted text-xs font-medium transition-all"
              >
                <FlaskConical className="h-3.5 w-3.5" /> Simulate
              </TabsTrigger>
            </TabsList>
          </div>

          <ScrollArea className="flex-1 overflow-auto mt-2">
            <div className="px-6 py-4">
              <TabsContent value="connection" className="mt-0">
                <ConnectionTab />
              </TabsContent>
              <TabsContent value="boot" className="mt-0">
                <BootNotificationTab />
              </TabsContent>
              <TabsContent value="station" className="mt-0">
                <StationConfigTab />
              </TabsContent>
              <TabsContent value="simulation" className="mt-0">
                <SimulationTab />
              </TabsContent>
            </div>
          </ScrollArea>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
