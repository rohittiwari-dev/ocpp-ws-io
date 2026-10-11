import {
  IconActivity,
  IconBolt,
  IconChevronRight,
  IconCircleCheck,
  IconCommand,
  IconHelpCircle,
  IconLayoutDashboard,
  IconLogout,
  IconMenu2,
  IconMessage,
  IconMoon,
  IconPlug,
  IconRoute,
  IconSettings,
  IconShieldCheck,
  IconTerminal2,
  IconX,
} from "@tabler/icons-react";
import { useState } from "react";
import { Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import { useTheme } from "@/components/theme-provider";
import { useResource } from "@/hooks/use-resource";
import { useAuth } from "@/lib/auth";
import { useSSELatest } from "@/lib/sse";
import type { ConnectionRecord, TelemetrySnapshot } from "@/types";

const navigation = [
  { to: "/overview", icon: IconLayoutDashboard, label: "Overview" },
  { to: "/connections", icon: IconPlug, label: "Stations" },
  { to: "/messages", icon: IconMessage, label: "Messages" },
  { to: "/commands", icon: IconTerminal2, label: "Commands" },
  { to: "/telemetry", icon: IconActivity, label: "Telemetry" },
  { to: "/security", icon: IconShieldCheck, label: "Security" },
  { to: "/diagnostics", icon: IconRoute, label: "Diagnostics" },
];
export default function AuthLayout() {
  const { session, isLoading, logout } = useAuth();
  if (isLoading)
    return (
      <div className="loading-state full-height">Opening your workspace...</div>
    );
  if (!session?.authenticated) return <Navigate to="/login" replace />;
  return <Workspace user={session.user?.name ?? "Operator"} logout={logout} />;
}
function Workspace({
  user,
  logout,
}: {
  user: string;
  logout: () => Promise<void>;
}) {
  const location = useLocation();
  const { theme, setTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const stations = useResource<ConnectionRecord[]>("/connections", 10000);
  const stream = useSSELatest<TelemetrySnapshot>("/telemetry/stream");
  const active =
    navigation.find((item) => location.pathname.startsWith(item.to))?.label ??
    (location.pathname.startsWith("/connection/") ? "Stations" : "Workspace");
  const counts = (status: string) =>
    (stations.data ?? []).filter((station) => station.status === status).length;
  const closeMenu = () => setMenuOpen(false);
  return (
    <div className="workspace">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <div className="mobile-top">
        <NavLink to="/connections" className="brand">
          <IconBolt size={28} fill="currentColor" />
          OCPP Board
        </NavLink>
        <button
          className="button icon-button"
          aria-label={menuOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? <IconX /> : <IconMenu2 />}
        </button>
      </div>
      {menuOpen && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={closeMenu}
        />
      )}
      <aside
        className={`primary-rail ${menuOpen ? "is-open" : ""}`}
        aria-label="Main navigation"
      >
        <NavLink to="/connections" className="brand" onClick={closeMenu}>
          <IconBolt size={31} fill="currentColor" />
          <span>OCPP Board</span>
        </NavLink>
        <nav>
          {navigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={closeMenu}
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""}`
              }
            >
              <item.icon size={20} stroke={1.6} />
              <span>{item.label}</span>
              {item.to === "/connections" && stations.data && (
                <span className="count-badge">{stations.data.length}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="rail-divider" />
        <NavLink
          to="/integrations"
          onClick={closeMenu}
          className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
        >
          <IconCommand size={20} />
          Integrations
        </NavLink>
        <NavLink
          to="/settings"
          onClick={closeMenu}
          className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
        >
          <IconSettings size={20} />
          Workspace
        </NavLink>
        <div className="rail-bottom">
          <div className="operator">
            <span className="avatar tone-lavender">
              {user.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong>{user}</strong>
              <small>Operator workspace</small>
            </div>
          </div>
          <button
            className="nav-item"
            onClick={() =>
              void logout().catch((error: Error) =>
                setLogoutError(error.message),
              )
            }
          >
            <IconLogout size={20} />
            Sign out
          </button>
          {logoutError && <p role="alert">{logoutError}</p>}
          <NavLink to="/settings#help" onClick={closeMenu} className="nav-item">
            <IconHelpCircle size={20} />
            Help & shortcuts
          </NavLink>
          <button
            className="theme-toggle"
            role="switch"
            aria-checked={theme === "dark"}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            <IconMoon size={19} />
            Dark mode
            <span className={`switch ${theme === "dark" ? "on" : ""}`} />
          </button>
        </div>
      </aside>
      <aside className="context-rail" aria-label="Station views">
        <h2>Network</h2>
        <div className="segmented">
          <NavLink to="/connections" end>
            All stations
          </NavLink>
          <NavLink to="/connections?view=favorites">Starred</NavLink>
        </div>
        <div className="context-group">
          <h3>Station views</h3>
          <NavLink to="/connections" className="context-link">
            <IconPlug size={18} />
            All stations<span>{stations.data?.length ?? "\u2014"}</span>
          </NavLink>
          <NavLink to="/connections?status=online" className="context-link">
            <span className="status-dot mint" />
            Online
            <span className="count-badge tone-mint">{counts("online")}</span>
          </NavLink>
          <NavLink to="/connections?status=offline" className="context-link">
            <span className="status-dot" />
            Offline<span>{counts("offline")}</span>
          </NavLink>
          <NavLink to="/connections?view=attention" className="context-link">
            <span className="status-dot rose" />
            Needs attention
            <span className="count-badge tone-rose">
              {
                (stations.data ?? []).filter(
                  (station) =>
                    station.errorCount || station.status === "evicted",
                ).length
              }
            </span>
          </NavLink>
        </div>
        <div className="context-group">
          <h3>Protocols</h3>
          {["ocpp1.6", "ocpp2.0.1", "ocpp2.1"].map((protocol) => (
            <NavLink
              key={protocol}
              to={`/connections?protocol=${protocol}`}
              className="context-link"
            >
              <span className="tree-branch" />
              OCPP {protocol.replace("ocpp", "")}
              <span>
                {
                  (stations.data ?? []).filter(
                    (station) => station.protocol === protocol,
                  ).length
                }
              </span>
            </NavLink>
          ))}
        </div>
        <div className="context-group">
          <h3>Recently connected</h3>
          {(stations.data ?? [])
            .toSorted((a, b) => b.connectedAt.localeCompare(a.connectedAt))
            .slice(0, 5)
            .map((station) => (
              <NavLink
                className="context-link recent-station"
                key={station.identity}
                to={`/connection/view/${encodeURIComponent(station.identity)}`}
              >
                <span
                  className={`status-dot ${station.status === "online" ? "mint" : ""}`}
                />
                <span className="truncate">{station.identity}</span>
              </NavLink>
            ))}
          {!stations.data?.length && (
            <p className="context-note">
              Stations appear when they connect to your server.
            </p>
          )}
        </div>
        <div className="context-bottom">
          <IconCircleCheck size={18} />
          <span>
            Public core API bindings
            <br />
            <small>OCPP 1.6 / 2.0.1 / 2.1</small>
          </span>
        </div>
      </aside>
      <main id="main-content" className="main-workspace">
        <header className="workspace-top">
          <div>
            Network
            <IconChevronRight size={14} />
            <span>{active}</span>
          </div>
          <span className="stream-status">
            <span
              className={`status-dot ${stream.connected ? "mint" : "yellow"}`}
            />
            {stream.connected
              ? "Live updates connected"
              : "Connecting to live updates..."}
          </span>
        </header>
        <div className="page-content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
