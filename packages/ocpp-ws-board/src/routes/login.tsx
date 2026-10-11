import {
  IconBolt,
  IconEye,
  IconEyeOff,
  IconLock,
  IconMoon,
  IconSun,
} from "@tabler/icons-react";
import { type FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { useTheme } from "@/components/theme-provider";
import { Status } from "@/components/workspace";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const { session, isLoading, login } = useAuth();
  const { theme, setTheme } = useTheme();
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (isLoading)
    return (
      <div className="loading-state full-height">Checking your session...</div>
    );
  if (session?.authenticated) return <Navigate to="/connections" replace />;

  const tokenMode = session?.authMode === "token" || !session?.authMode;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(
        tokenMode
          ? { token }
          : { username, password, ...(token ? { token } : {}) },
      );
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Unable to sign in",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <section className="login-story" aria-label="Platform Overview">
        <div className="brand">
          <IconBolt size={34} fill="currentColor" />
          <span>OCPP Board</span>
        </div>
        <h1>
          Your charging network.
          <br />
          Clearly connected.
        </h1>
        <p>
          Follow station activity, inspect every exchange, and keep your
          operations moving.
        </p>
        <div className="login-badges">
          <Status tone="mint">CSMS Gateway Online</Status>
          <Status tone="blue">OCPP 1.6-J &bull; 2.0.1 &bull; 2.1</Status>
        </div>
      </section>

      <section className="login-console" aria-label="Operator Authentication">
        <button
          type="button"
          className="button icon-button login-theme-toggle"
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <IconSun size={18} /> : <IconMoon size={18} />}
        </button>

        <form className="login-form" onSubmit={(event) => void submit(event)}>
          <IconLock size={28} className="muted" />
          <h2>Welcome back</h2>
          <p>Sign in to your operator workspace.</p>

          {tokenMode ? (
            <div className="field">
              <label htmlFor="token">Access token</label>
              <div className="input-wrap">
                <input
                  id="token"
                  className="text-input"
                  type={showToken ? "text" : "password"}
                  required
                  value={token}
                  autoComplete="current-password"
                  placeholder="Enter bearer token..."
                  onChange={(event) => setToken(event.target.value)}
                />
                <button
                  type="button"
                  className="toggle-vis"
                  aria-label={
                    showToken ? "Hide access token" : "Show access token"
                  }
                  onClick={() => setShowToken(!showToken)}
                >
                  {showToken ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="field">
                <label htmlFor="username">Username</label>
                <input
                  id="username"
                  className="text-input"
                  required
                  value={username}
                  autoComplete="username"
                  placeholder="Operator username"
                  onChange={(event) => setUsername(event.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="password">Password</label>
                <div className="input-wrap">
                  <input
                    id="password"
                    className="text-input"
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    autoComplete="current-password"
                    placeholder="Operator password"
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <button
                    type="button"
                    className="toggle-vis"
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
                      <IconEyeOff size={16} />
                    ) : (
                      <IconEye size={16} />
                    )}
                  </button>
                </div>
              </div>

              {session?.authMode === "custom" && (
                <div className="field">
                  <label htmlFor="custom-token">Token (optional)</label>
                  <div className="input-wrap">
                    <input
                      id="custom-token"
                      className="text-input"
                      type={showToken ? "text" : "password"}
                      value={token}
                      placeholder="Optional bearer token..."
                      onChange={(event) => setToken(event.target.value)}
                    />
                    <button
                      type="button"
                      className="toggle-vis"
                      aria-label={showToken ? "Hide token" : "Show token"}
                      onClick={() => setShowToken(!showToken)}
                    >
                      {showToken ? (
                        <IconEyeOff size={16} />
                      ) : (
                        <IconEye size={16} />
                      )}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {error && (
            <p className="error-banner" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="button primary" disabled={busy}>
            {busy ? "Signing in..." : "Sign in"}
          </button>

          <p className="notice">
            Use the credentials configured by your server administrator.
          </p>
        </form>
      </section>
    </div>
  );
}
