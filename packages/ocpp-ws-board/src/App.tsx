import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ThemeProvider } from "@/components/theme-provider";
import { BASE_PATH } from "@/lib/api";
import { AuthProvider } from "@/lib/auth";
import AuthLayout from "@/routes/AuthLayout";

const LoginPage = lazy(() => import("@/routes/login"));
const OverviewPage = lazy(() => import("@/routes/overview"));
const ConnectionsPage = lazy(() => import("@/routes/connections"));
const ConnectionPage = lazy(() => import("@/routes/connection"));
const MessagesPage = lazy(() => import("@/routes/messages"));
const TelemetryPage = lazy(() => import("@/routes/telemetry"));
const SecurityPage = lazy(() => import("@/routes/security"));
const CommandsPage = lazy(() => import("@/routes/commands"));
const DiagnosticsPage = lazy(() => import("@/routes/diagnostics"));
const IntegrationsPage = lazy(() => import("@/routes/integrations"));
const SettingsPage = lazy(() => import("@/routes/settings"));
const HelpPage = lazy(() => import("@/routes/help"));

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
