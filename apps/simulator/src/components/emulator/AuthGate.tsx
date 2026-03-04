"use client";

import {
  BatteryCharging,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  User,
  Zap,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

/* ── Auth context ── */
const AuthCtx = createContext<{ logout: () => void } | null>(null);
export const useAuth = () => useContext(AuthCtx);

/* ═══════════════════════════════════════════
   LOGIN PAGE
   ═══════════════════════════════════════════ */
function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError("Please fill in all fields.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (data.ok) {
        onSuccess();
      } else {
        setError(data.error ?? "Invalid credentials.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#0b0d14] p-4 relative overflow-hidden">
      {/* Background blobs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-[#8b5cf6]/5 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full bg-[#0ea5e9]/5 blur-[100px] pointer-events-none" />

      <div className="w-full max-w-sm flex flex-col gap-6">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <div className="h-14 w-14 rounded-2xl bg-linear-to-br from-[#8b5cf6] to-[#7c3aed] flex items-center justify-center shadow-[0_0_40px_rgba(139,92,246,0.3)]">
            <BatteryCharging className="text-white h-6 w-6" />
          </div>
          <div className="text-center">
            <h1 className="text-[17px] font-bold text-white tracking-tight">
              OCPP Emulator
            </h1>
            <p className="text-[11px] text-[#4a5568] mt-0.5">
              Sign in to access the simulator
            </p>
          </div>
        </div>

        {/* Card */}
        <div className="bg-[#181a24] border border-[#232636] rounded-2xl p-6 flex flex-col gap-4">
          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[#26101a] border border-[#6b1e28] text-[#fda4af] text-[11px] font-medium">
              <Zap className="h-3.5 w-3.5 shrink-0 text-[#f43f5e]" />
              {error}
            </div>
          )}

          <form onSubmit={submit} className="flex flex-col gap-3">
            {/* Username */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[9px] font-bold uppercase tracking-widest text-[#4a5568]">
                Username
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#3d4459] pointer-events-none" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    setError("");
                  }}
                  placeholder="Enter username"
                  autoComplete="username"
                  autoFocus
                  className="w-full h-10 pl-9 pr-3 rounded-lg text-[12px] text-white font-medium bg-[#0f1117] border border-[#232636] placeholder:text-[#2e3445] outline-none focus:border-[#8b5cf6] focus:shadow-[0_0_0_3px_rgba(139,92,246,0.1)] transition-all"
                />
              </div>
            </div>

            {/* Password */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[9px] font-bold uppercase tracking-widest text-[#4a5568]">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#3d4459] pointer-events-none" />
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError("");
                  }}
                  placeholder="Enter password"
                  autoComplete="current-password"
                  className="w-full h-10 pl-9 pr-10 rounded-lg text-[12px] text-white font-medium bg-[#0f1117] border border-[#232636] placeholder:text-[#2e3445] outline-none focus:border-[#8b5cf6] focus:shadow-[0_0_0_3px_rgba(139,92,246,0.1)] transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#3d4459] hover:text-[#6b7898] transition-colors cursor-pointer"
                >
                  {showPw ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="mt-1 w-full h-10 rounded-lg flex items-center justify-center gap-2 font-bold text-[12px] tracking-wide bg-linear-to-r from-[#8b5cf6] to-[#7c3aed] text-white shadow-[0_0_16px_rgba(139,92,246,0.25)] hover:shadow-[0_0_24px_rgba(139,92,246,0.4)] transition-all disabled:opacity-60 cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Signing in…
                </>
              ) : (
                "Sign In"
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-[9px] text-[#2e3445]">
          Session persists for 10 days
        </p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   AUTH GATE
   ═══════════════════════════════════════════ */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const authEnabled = process.env.NEXT_PUBLIC_ALLOW_AUTH === "true";

  // "unknown" = haven't checked yet (avoids flash)
  const [state, setState] = useState<"unknown" | "authed" | "login">("unknown");

  const verify = useCallback(async () => {
    try {
      // Hit a lightweight check endpoint — if cookie is valid the POST succeeds without creds
      const res = await fetch("/api/auth/check");
      setState(res.ok ? "authed" : "login");
    } catch {
      setState("login");
    }
  }, []);

  useEffect(() => {
    if (!authEnabled) {
      setState("authed");
      return;
    }
    verify();
  }, [authEnabled, verify]);

  const logout = useCallback(async () => {
    await fetch("/api/auth", { method: "DELETE" });
    setState("login");
  }, []);

  if (state === "unknown") {
    // Show nothing while checking to avoid flash
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-[#0b0d14]">
        <Loader2 className="h-6 w-6 text-[#8b5cf6] animate-spin" />
      </div>
    );
  }

  if (state === "login") {
    return <LoginPage onSuccess={() => setState("authed")} />;
  }

  return <AuthCtx.Provider value={{ logout }}>{children}</AuthCtx.Provider>;
}
