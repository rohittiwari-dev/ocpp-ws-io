"use client";

import { Cpu } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEmulatorStore } from "@/store/emulatorStore";

const BOOT_FIELDS: { key: string; label: string; required?: boolean }[] = [
  { key: "chargePointVendor", label: "Charge Point Vendor", required: true },
  { key: "chargePointModel", label: "Charge Point Model", required: true },
  { key: "chargePointSerialNumber", label: "CP Serial Number" },
  { key: "chargeBoxSerialNumber", label: "Charge Box Serial Number" },
  { key: "firmwareVersion", label: "Firmware Version" },
  { key: "iccid", label: "ICCID" },
  { key: "imsi", label: "IMSI" },
  { key: "meterType", label: "Meter Type" },
  { key: "meterSerialNumber", label: "Meter Serial Number" },
];

export function BootNotificationConfig() {
  const { config, updateBootNotification, status } = useEmulatorStore();
  const isConnected = status === "connected" || status === "connecting";
  const boot = config.bootNotification;

  return (
    <Card className="glass-panel border-0 text-white rounded-2xl">
      <CardHeader>
        <CardTitle className="text-lg font-bold flex items-center gap-2">
          <Cpu className="h-4 w-4 text-purple-400" /> Boot Notification
        </CardTitle>
        <CardDescription className="text-slate-400 text-xs">
          Hardware identity sent on connection
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {BOOT_FIELDS.map(({ key, label, required }) => (
          <div key={key} className="space-y-1">
            <Label className="text-slate-400 text-xs">
              {label}
              {required && <span className="text-red-400 ml-0.5">*</span>}
            </Label>
            <Input
              value={(boot as any)?.[key] ?? ""}
              disabled={isConnected}
              onChange={(e) =>
                updateBootNotification({ [key]: e.target.value } as any)
              }
              className="glass-input text-white h-8 text-sm"
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
