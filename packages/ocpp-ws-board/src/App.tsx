import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/lib/auth";
import AuthLayout from "@/routes/AuthLayout";
import ConnectionPage from "@/routes/connection";
import ConnectionsPage from "@/routes/connections";
import LoginPage from "@/routes/login";
import MessagesPage from "@/routes/messages";
import OverviewPage from "@/routes/overview";
import SecurityPage from "@/routes/security";
import TelemetryPage from "@/routes/telemetry";

export default function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <AuthProvider>
        <BrowserRouter>
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
              <Route path="*" element={<Navigate to="/overview" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
