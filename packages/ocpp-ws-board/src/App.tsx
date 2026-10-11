import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ThemeProvider } from "@/components/theme-provider";
import { BASE_PATH } from "@/lib/api";
import { AuthProvider } from "@/lib/auth";
import AuthLayout from "@/routes/AuthLayout";
import CommandsPage from "@/routes/commands";
import ConnectionPage from "@/routes/connection";
import ConnectionsPage from "@/routes/connections";
import DiagnosticsPage from "@/routes/diagnostics";
import HelpPage from "@/routes/help";
import IntegrationsPage from "@/routes/integrations";
import LoginPage from "@/routes/login";
import MessagesPage from "@/routes/messages";
import OverviewPage from "@/routes/overview";
import SecurityPage from "@/routes/security";
import SettingsPage from "@/routes/settings";

const TelemetryPage = lazy(() => import("@/routes/telemetry"));

export default function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <AuthProvider>
        <BrowserRouter basename={BASE_PATH || "/"}>
          <Suspense
            fallback={<div className="loading-state">Loading view...</div>}
          >
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<AuthLayout />}>
                <Route path="/overview" element={<OverviewPage />} />
                <Route path="/connections" element={<ConnectionsPage />} />
                <Route
                  path="/connection/view/:identity"
                  element={<ConnectionPage />}
                />
                <Route path="/messages" element={<MessagesPage />} />
                <Route path="/telemetry" element={<TelemetryPage />} />
                <Route path="/security" element={<SecurityPage />} />
                <Route path="/commands" element={<CommandsPage />} />
                <Route path="/diagnostics" element={<DiagnosticsPage />} />
                <Route path="/integrations" element={<IntegrationsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/help" element={<HelpPage />} />
                <Route
                  path="/workspace"
                  element={<Navigate to="/settings" replace />}
                />
                <Route
                  path="*"
                  element={<Navigate to="/connections" replace />}
                />
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
