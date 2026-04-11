import {
  IconActivity,
  IconBolt,
  IconChevronRight,
  IconLayout,
  IconLogout,
  IconMessage,
  IconMoon,
  IconPlug,
  IconShieldExclamation,
  IconSun,
} from "@tabler/icons-react";
import { Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import { useTheme } from "@/components/theme-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  icon: React.ElementType;
  label: string;
  gradient: string;
  glow: string;
}

const navItems: NavItem[] = [
  {
    to: "/overview",
    icon: IconLayout,
    label: "Overview",
    gradient: "from-violet-500 to-indigo-500",
    glow: "shadow-violet-500/25",
  },
  {
    to: "/connections",
    icon: IconPlug,
    label: "Connections",
    gradient: "from-emerald-500 to-teal-500",
    glow: "shadow-emerald-500/25",
  },
  {
    to: "/messages",
    icon: IconMessage,
    label: "Messages",
    gradient: "from-rose-500 to-pink-500",
    glow: "shadow-rose-500/25",
  },
  {
    to: "/telemetry",
    icon: IconActivity,
    label: "Telemetry",
    gradient: "from-amber-500 to-orange-500",
    glow: "shadow-amber-500/25",
  },
  {
    to: "/security",
    icon: IconShieldExclamation,
    label: "Security",
    gradient: "from-red-500 to-orange-500",
    glow: "shadow-red-500/25",
  },
];

export default function AuthLayout() {
  const { session, isLoading, logout } = useAuth();
  const location = useLocation();
  const { theme, setTheme } = useTheme();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="size-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shadow-lg shadow-primary/25">
            <IconBolt className="size-5" />
          </div>
          <Spinner className="size-5 text-primary" />
        </div>
      </div>
    );
  }

  if (!session?.authenticated) {
    return <Navigate to="/login" replace />;
  }

  const userInitial = session.user?.name
    ? session.user.name.charAt(0).toUpperCase()
    : "A";

  const activeItem = navItems.find((n) => location.pathname.startsWith(n.to));

  return (
    <SidebarProvider defaultOpen={true}>
      <Sidebar
        collapsible="icon"
        className="glass-sidebar border-none"
        variant="sidebar"
      >
        {/* ── Logo ─────────────────────────────────────── */}
        <SidebarHeader className="pb-0 pt-4 px-4">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                size="lg"
                tooltip="ocpp-ws-io"
                className="hover:bg-transparent! px-0 gap-3"
              >
                {/* gradient icon */}
                <div className="relative flex items-center justify-center size-9 rounded-xl shrink-0 overflow-hidden">
                  <div className="absolute inset-0 bg-linear-to-br from-violet-600 to-indigo-600" />
                  <div className="absolute inset-0 bg-linear-to-br from-white/20 to-transparent" />
                  <IconBolt className="relative size-5 text-white drop-shadow" />
                </div>
                <div className="flex flex-col gap-0">
                  <span className="font-heading font-black text-sm tracking-tighter leading-tight">
                    ocpp-ws-io
                  </span>
                  <span className="text-[10px] font-semibold text-primary/70 tracking-widest uppercase leading-tight">
                    Dashboard
                  </span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>

          {/* divider with gradient */}
          <div className="mt-4 mb-1 h-px bg-linear-to-r from-transparent via-primary/20 to-transparent" />
        </SidebarHeader>

        {/* ── Nav ──────────────────────────────────────── */}
        <SidebarContent className="px-2 py-2">
          <SidebarGroup className="p-0">
            <div className="px-2 mb-2 text-[9px] font-bold tracking-[0.18em] uppercase text-muted-foreground/50 group-data-[collapsible=icon]:hidden">
              Main Menu
            </div>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {navItems.map((item) => {
                  const isActive = location.pathname.startsWith(item.to);
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton
                        render={<NavLink to={item.to} />}
                        isActive={isActive}
                        tooltip={item.label}
                        className={cn(
                          "relative h-10 rounded-xl gap-3 transition-all duration-200 font-medium text-sm",
                          "group-data-[collapsible=icon]:size-10! group-data-[collapsible=icon]:p-0! group-data-[collapsible=icon]:justify-center",
                        )}
                      >
                        {/* icon pill */}
                        <div
                          className={cn(
                            "relative flex items-center justify-center size-6 rounded-lg shrink-0 transition-all duration-200",
                            isActive
                              ? `bg-linear-to-br ${item.gradient} shadow-md ${item.glow} text-white`
                              : `bg-linear-to-br ${item.gradient} opacity-40 group-hover/menu-button:opacity-70 text-white`,
                          )}
                        >
                          <item.icon className="size-3.5" />
                          {isActive && (
                            <div className="absolute inset-0 rounded-lg bg-white/20" />
                          )}
                        </div>
                        <span
                          className={cn(
                            "transition-colors",
                            isActive
                              ? "text-foreground font-semibold"
                              : "text-sidebar-foreground/70 group-hover/menu-button:text-sidebar-foreground",
                          )}
                        >
                          {item.label}
                        </span>
                        {isActive && (
                          <IconChevronRight className="size-3 ml-auto opacity-30 shrink-0" />
                        )}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        {/* ── Footer ───────────────────────────────────── */}
        <SidebarFooter className="px-2 pb-3 gap-1">
          {/* Theme toggle */}
          <div className="mx-2 mb-1 h-px bg-linear-to-r from-transparent via-border/60 to-transparent" />

          <SidebarMenu className="gap-0.5">
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip={theme === "dark" ? "Light mode" : "Dark mode"}
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                className="h-9 rounded-xl gap-3 text-sm font-medium transition-all duration-200 text-muted-foreground group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:p-0! group-data-[collapsible=icon]:justify-center"
              >
                <div className="flex items-center justify-center size-6 rounded-lg bg-muted/60 shrink-0">
                  {theme === "dark" ? (
                    <IconSun className="size-3.5 text-amber-500" />
                  ) : (
                    <IconMoon className="size-3.5 text-indigo-500" />
                  )}
                </div>
                <span>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>

            {/* User */}
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <SidebarMenuButton
                      size="lg"
                      tooltip={session.user?.name ?? "Admin"}
                      className="h-12 rounded-xl gap-3 transition-all duration-200 group-data-[collapsible=icon]:size-10! group-data-[collapsible=icon]:p-0! group-data-[collapsible=icon]:justify-center mt-1"
                    />
                  }
                >
                  {/* gradient avatar */}
                  <div className="relative flex items-center justify-center size-8 rounded-xl shrink-0 overflow-hidden">
                    <div className="absolute inset-0 bg-linear-to-br from-violet-500 to-indigo-600" />
                    <span className="relative text-xs font-bold text-white">
                      {userInitial}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0 leading-snug">
                    <span className="text-sm font-semibold truncate">
                      {session.user?.name ?? "Admin"}
                    </span>
                    <span className="text-[10px] text-muted-foreground capitalize font-medium tracking-wide">
                      {session.authMode} auth
                    </span>
                  </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="top"
                  align="start"
                  className="w-56 glass rounded-xl border-border/30 shadow-xl"
                >
                  <DropdownMenuGroup>
                    <div className="px-3 py-3 flex items-center gap-3">
                      <div className="relative flex items-center justify-center size-9 rounded-lg overflow-hidden shrink-0">
                        <div className="absolute inset-0 bg-linear-to-br from-violet-500 to-indigo-600" />
                        <span className="relative text-sm font-bold text-white">
                          {userInitial}
                        </span>
                      </div>
                      <div>
                        <div className="font-semibold text-sm">
                          {session.user?.name ?? "Admin"}
                        </div>
                        <div className="text-[11px] text-muted-foreground capitalize">
                          Administrator
                        </div>
                      </div>
                    </div>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator className="bg-border/30" />
                  <DropdownMenuGroup className="p-1">
                    <DropdownMenuItem
                      onClick={logout}
                      variant="destructive"
                      className="cursor-pointer font-medium rounded-lg"
                    >
                      <IconLogout className="size-4" />
                      Sign Out
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      {/* ── Main content ─────────────────────────────── */}
      <SidebarInset className="relative flex-1 bg-transparent dark:bg-transparent overflow-hidden">
        {/* Ambient gradient blobs */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
          <div className="absolute -top-[10%] -left-[5%] w-[40vw] h-[40vh] rounded-full bg-violet-600/30 blur-[130px] animate-blob" />
          <div className="absolute top-[30%] -right-[10%] w-[35vw] h-[60vh] rounded-full bg-rose-500/25 blur-[120px] animate-blob animation-delay-2000" />
          <div className="absolute -bottom-[20%] left-[10%] w-[50vw] h-[40vh] rounded-full bg-orange-600/30 blur-[140px] animate-blob animation-delay-4000" />
          <div className="absolute top-[40%] left-[30%] w-[30vw] h-[30vh] rounded-full bg-red-500/15 blur-[140px] animate-blob" />
        </div>

        {/* Dot grid */}
        <div className="absolute inset-0 bg-dot-pattern mask-[radial-gradient(ellipse_at_center,black_40%,transparent_80%)] opacity-[0.15] pointer-events-none -z-10" />

        {/* ── Top bar ─────────────────────────── */}
        <header className="sticky top-0 z-50 flex h-14 items-center gap-3 px-4">
          {/* separator */}
          <div className="h-4 w-px bg-border/50" />

          {/* breadcrumb */}
          {activeItem && (
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "flex items-center justify-center size-5 rounded-md bg-linear-to-br text-white shadow-sm",
                  activeItem.gradient,
                )}
              >
                <activeItem.icon className="size-3" />
              </div>
              <span className="text-sm font-semibold text-foreground/80">
                {activeItem.label}
              </span>
            </div>
          )}

          {/* right-side live indicator */}
          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <span className="relative flex size-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full size-1.5 bg-emerald-500" />
              </span>
              <span className="text-[10px] font-semibold text-emerald-500 tracking-wide uppercase">
                Live
              </span>
            </div>
          </div>
        </header>

        <div className="relative p-6 max-w-[1600px] w-full mx-auto animate-in fade-in duration-500">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
