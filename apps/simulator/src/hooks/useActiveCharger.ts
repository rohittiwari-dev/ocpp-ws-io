"use client";

import { useCallback } from "react";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import {
  type BootNotificationConfig,
  type ConnectorState,
  type EmulatorConfig,
  type LocalAuthEntry,
  makeDefaultSlot,
  type OCPPLog,
  type SimulationConfig,
  useEmulatorStore,
} from "@/store/emulatorStore";

/**
 * Returns a fully-bound active-charger state object for the currently active charger.
 * All existing components can import this instead of useEmulatorStore()
 * and work unchanged — no internal refactor needed.
 */
export function useActiveCharger() {
  const store = useEmulatorStore();
  const id = store.activeChargerId;

  // Fallback slot so we never crash during first hydration frame
  const slot = store.chargers.find((c) => c.id === id) ?? makeDefaultSlot(1);
  const runtime = slot.runtime;

  /* ── Bound actions ── */
  const updateConfig = useCallback(
    (cfg: Partial<EmulatorConfig>) => store.updateConfig(id, cfg),
    [id, store],
  );
  const updateBootNotification = useCallback(
    (fields: Partial<BootNotificationConfig>) =>
      store.updateBootNotification(id, fields),
    [id, store],
  );
  const updateStationConfigKey = useCallback(
    (key: string, value: string) =>
      store.updateStationConfigKey(id, key, value),
    [id, store],
  );
  const updateSimulation = useCallback(
    (fields: Partial<SimulationConfig>) => store.updateSimulation(id, fields),
    [id, store],
  );
  const setStatus = useCallback(
    (status: "disconnected" | "connecting" | "connected" | "faulted") =>
      store.setStatus(id, status),
    [id, store],
  );

  const updateConnector = useCallback(
    (connId: number, data: Partial<ConnectorState>) =>
      store.updateConnector(id, connId, data),
    [id, store],
  );
  const resetConnector = useCallback(
    (connId: number) => store.resetConnector(id, connId),
    [id, store],
  );
  const addLog = useCallback(
    (log: Omit<OCPPLog, "id" | "timestamp">) => store.addLog(id, log),
    [id, store],
  );
  const clearLogs = useCallback(() => store.clearLogs(id), [id, store]);
  const setIsUploading = useCallback(
    (val: boolean) => store.setIsUploading(id, val),
    [id, store],
  );
  const setUploadSecondsLeft = useCallback(
    (val: number) => store.setUploadSecondsLeft(id, val),
    [id, store],
  );
  const setLocalAuthList = useCallback(
    (list: LocalAuthEntry[], version: number) =>
      store.setLocalAuthList(id, list, version),
    [id, store],
  );
  const setConnectedAt = useCallback(
    (ts: number | null) => store.setConnectedAt(id, ts),
    [id, store],
  );
  const saveProfile = useCallback(
    (name: string) => store.saveProfile(id, name),
    [id, store],
  );
  const loadProfile = useCallback(
    (name: string) => store.loadProfile(id, name),
    [id, store],
  );
  const deleteProfile = useCallback(
    (name: string) => store.deleteProfile(id, name),
    [id, store],
  );

  return {
    // Slot identity
    id: slot.id,
    label: slot.label,
    // Config
    config: slot.config,
    savedProfiles: slot.savedProfiles,
    // Runtime
    ...runtime,
    // Bound actions
    updateConfig,
    updateBootNotification,
    updateStationConfigKey,
    updateSimulation,
    setStatus,
    updateConnector,
    resetConnector,
    addLog,
    clearLogs,
    setIsUploading,
    setUploadSecondsLeft,
    setLocalAuthList,
    setConnectedAt,
    saveProfile,
    loadProfile,
    deleteProfile,
  };
}
