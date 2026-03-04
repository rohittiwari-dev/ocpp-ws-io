"use client";

import { useActiveCharger } from "@/hooks/useActiveCharger";
import { ConnectorPanel } from "./ConnectorPanel";

export function ConnectorsView() {
  const { config } = useActiveCharger();

  return (
    <div className="flex-1">
      <div
        className={`grid gap-5 ${
          config.numberOfConnectors === 2
            ? "grid-cols-1 lg:grid-cols-2"
            : "grid-cols-1 max-w-2xl"
        }`}
      >
        <ConnectorPanel connectorId={1} />
        {config.numberOfConnectors === 2 && <ConnectorPanel connectorId={2} />}
      </div>
    </div>
  );
}
