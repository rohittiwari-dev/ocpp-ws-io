import {
  IconActivity,
  IconAlertCircle,
  IconChevronRight,
  IconCommand,
  IconHelpCircle,
  IconLayoutDashboard,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLogout,
  IconMenu2,
  IconMessage,
  IconMoon,
  IconPlug,
  IconRoute,
  IconSettings,
  IconShieldCheck,
  IconSun,
  IconTerminal2,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import { useTheme } from "@/components/theme-provider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useResource } from "@/hooks/use-resource";
import { useAuth } from "@/lib/auth";
import { useSSELatest } from "@/lib/sse";
import { cn } from "@/lib/utils";
import type { ConnectionRecord, TelemetrySnapshot } from "@/types";

const navigation = [
  { to: "/overview", icon: IconLayoutDashboard, label: "Overview" },
  { to: "/connections", icon: IconPlug, label: "Chargers" },
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
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("ocpp_board_sidebar_collapsed") === "true";
    }
    return false;
  });
  const [logoutError, setLogoutError] = useState("");
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const stations = useResource<ConnectionRecord[]>("/connections", 10000);
  const stream = useSSELatest<TelemetrySnapshot>("/telemetry/stream");

  const handleConfirmLogout = () => {
    setIsLoggingOut(true);
    setLogoutError("");
    logout().catch((error: Error) => {
      setLogoutError(error.message);
      setIsLoggingOut(false);
    });
  };

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        localStorage.setItem("ocpp_board_sidebar_collapsed", String(next));
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() === "b" &&
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey
      ) {
        event.preventDefault();
        toggleCollapsed();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleCollapsed]);

  const active =
    navigation.find((item) => location.pathname.startsWith(item.to))?.label ??
    (location.pathname.startsWith("/connection/") ? "Chargers" : "Workspace");

  const closeMenu = () => setMenuOpen(false);
  const isIconRail = collapsed && !menuOpen;

  return (
    <div className={cn("workspace", isIconRail && "is-collapsed")}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      {/* Mobile Top Header */}
      <div className="mobile-top">
        <NavLink
          to="/connections"
          className="brand flex items-center gap-2 justify-center"
        >
          <span
            aria-hidden="true"
            style={{
              width: 28,
              height: 28,
              display: "inline-block",
              backgroundImage: "url('/logo.svg')",
              backgroundPosition: "center",
              backgroundRepeat: "no-repeat",
              backgroundSize: "contain",
            }}
          />
          OCPP Board
        </NavLink>
        <button
          type="button"
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
          type="button"
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={closeMenu}
        />
      )}

      {/* Primary Sidebar Rail */}
      <aside
        className={cn(
          "primary-rail",
          isIconRail && "is-collapsed",
          menuOpen && "is-open",
        )}
        aria-label="Main navigation"
      >
        {/* Interactive Sidebar Rail Strip (right edge) */}
        <div
          className="sidebar-rail"
          role="button"
          tabIndex={0}
          title={
            collapsed ? "Click to expand sidebar" : "Click to collapse sidebar"
          }
          aria-label="Toggle sidebar rail"
          onClick={toggleCollapsed}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              toggleCollapsed();
            }
          }}
        />

        {/* Sidebar Header with Brand & Open/Close Button */}
        <div className="rail-header">
          <NavLink
            to="/connections"
            className="brand flex items-center gap-2 justify-center"
            onClick={closeMenu}
            title="OCPP Board"
          >
            <span
              aria-hidden="true"
              style={{
                width: 28,
                height: 28,
                display: "inline-block",
                backgroundImage: "url('/logo.svg')",
                backgroundPosition: "center",
                backgroundRepeat: "no-repeat",
                backgroundSize: "contain",
              }}
            />
            {!isIconRail && <span className="brand-text">OCPP Board</span>}
          </NavLink>
        </div>

        {/* Main Navigation */}
        <nav aria-label="Primary">
          {navigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={closeMenu}
              title={isIconRail ? item.label : undefined}
              className={({ isActive }) => cn("nav-item", isActive && "active")}
            >
              <item.icon size={20} stroke={1.6} className="nav-icon" />
              {!isIconRail && <span>{item.label}</span>}
              {item.to === "/connections" &&
                stations.data &&
                (isIconRail ? (
                  <span
                    className="count-dot"
                    title={`${stations.data.length} chargers`}
                  >
                    {stations.data.length > 99 ? "99+" : stations.data.length}
                  </span>
                ) : (
                  <span className="count-badge">{stations.data.length}</span>
                ))}
            </NavLink>
          ))}
        </nav>

        <div className="rail-divider" />

        {/* Secondary Links */}
        <nav aria-label="Secondary">
          <NavLink
            to="/integrations"
            onClick={closeMenu}
            title={isIconRail ? "Integrations" : undefined}
            className={({ isActive }) => cn("nav-item", isActive && "active")}
          >
            <IconCommand size={20} className="nav-icon" />
            {!isIconRail && <span>Integrations</span>}
          </NavLink>
          <NavLink
            to="/settings"
            onClick={closeMenu}
            title={isIconRail ? "Workspace" : undefined}
            className={({ isActive }) => cn("nav-item", isActive && "active")}
          >
            <IconSettings size={20} className="nav-icon" />
            {!isIconRail && <span>Workspace</span>}
          </NavLink>
          {/* <NavLink
            to="/help"
            onClick={closeMenu}
            title={isIconRail ? "Help & Docs" : undefined}
            className={({ isActive }) =>
              cn("nav-item hidden", isActive && "active")
            }
          >
            <IconHelpCircle size={20} className="nav-icon" />
            {!isIconRail && <span>Help & Docs</span>}
          </NavLink> */}
        </nav>

        {/* Sidebar Footer */}
        <div className="rail-bottom">
          {!isIconRail ? (
            <>
              {/* <div className="operator hidden!">
                <span className="avatar tone-lavender">
                  {user.slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <strong>{user}</strong>
                  <small>Operator workspace</small>
                </div>
              </div> */}
              <button
                type="button"
                className="nav-item"
                title="Sign out"
                onClick={() => {
                  setLogoutError("");
                  setShowLogoutDialog(true);
                }}
              >
                <IconLogout size={20} className="nav-icon" />
                <span>Sign out</span>
              </button>
              {logoutError && <p role="alert">{logoutError}</p>}
              <NavLink
                to="/help"
                onClick={closeMenu}
                className={({ isActive }) =>
                  cn("nav-item", isActive && "active")
                }
                title="Help & shortcuts"
              >
                <IconHelpCircle size={20} className="nav-icon" />
                <span>Help & shortcuts</span>
              </NavLink>
              <button
                type="button"
                className="theme-toggle"
                role="switch"
                aria-checked={theme === "dark"}
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              >
                <IconMoon size={19} />
                Dark mode
                <span className={`switch ${theme === "dark" ? "on" : ""}`} />
              </button>
            </>
          ) : (
            <>
              <div className="operator" title={`Signed in as ${user}`}>
                <span className="avatar tone-lavender">
                  {user.slice(0, 1).toUpperCase()}
                </span>
              </div>
              <button
                type="button"
                className="nav-item compact"
                title={
                  theme === "dark"
                    ? "Switch to light mode"
                    : "Switch to dark mode"
                }
                aria-label="Toggle theme"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              >
                {theme === "dark" ? (
                  <IconSun size={20} className="nav-icon" />
                ) : (
                  <IconMoon size={20} className="nav-icon" />
                )}
              </button>
              <NavLink
                to="/help"
                onClick={closeMenu}
                className={({ isActive }) =>
                  cn("nav-item compact", isActive && "active")
                }
                title="Help & shortcuts"
                aria-label="Help & shortcuts"
              >
                <IconHelpCircle size={20} className="nav-icon" />
              </NavLink>
              <button
                type="button"
                className="nav-item compact"
                title="Sign out"
                aria-label="Sign out"
                onClick={() => {
                  setLogoutError("");
                  setShowLogoutDialog(true);
                }}
              >
                <IconLogout size={20} className="nav-icon" />
              </button>
            </>
          )}
        </div>
      </aside>

      {/* Main Workspace Area */}
      <main id="main-content" className="main-workspace">
        <header className="workspace-top">
          <div className="top-nav-left">
            <button
              type="button"
              className="sidebar-trigger-btn"
              title={
                collapsed
                  ? "Expand sidebar (Ctrl+B)"
                  : "Collapse sidebar (Ctrl+B)"
              }
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-pressed={!collapsed}
              onClick={toggleCollapsed}
            >
              {" "}
              {collapsed ? (
                <IconLayoutSidebarLeftExpand size={18} />
              ) : (
                <IconLayoutSidebarLeftCollapse size={18} />
              )}
            </button>
            <div className="top-breadcrumb">
              <span>Network</span>
              <IconChevronRight size={14} />
              <span>{active}</span>
            </div>
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

      {/* Sign Out Confirmation Dialog */}
      <AlertDialog
        open={showLogoutDialog}
        onOpenChange={(open) => {
          if (!isLoggingOut) {
            setShowLogoutDialog(open);
            if (!open) setLogoutError("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-destructive/10 text-destructive shrink-0">
                <IconLogout size={22} />
              </div>
              <div>
                <AlertDialogTitle>Sign out of workspace?</AlertDialogTitle>
                <span className="text-xs text-muted-foreground font-mono">
                  Operator: {user}
                </span>
              </div>
            </div>
            <AlertDialogDescription className="mt-2 text-xs text-muted-foreground leading-relaxed">
              Are you sure you want to end your current session? You will be
              returned to the sign-in screen and any live message stream views
              or filters will be cleared.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {logoutError && (
            <div
              className="notice text-xs text-rose flex items-center gap-1.5 p-2 rounded-lg bg-rose/10 border border-rose/20"
              role="alert"
            >
              <IconAlertCircle size={14} />
              <span>{logoutError}</span>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLoggingOut}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isLoggingOut}
              onClick={handleConfirmLogout}
            >
              {isLoggingOut ? "Signing out..." : "Sign out"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
