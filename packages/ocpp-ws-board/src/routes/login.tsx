import { IconBolt, IconLock } from "@tabler/icons-react";
import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
export default function LoginPage() {
  const { session, isLoading, login } = useAuth();
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (isLoading)
    return (
      <div className="loading-state full-height">Checking your session...</div>
    );
  if (session?.authenticated) return <Navigate to="/connections" replace />;
  const tokenMode = session?.authMode === "token" || !session?.authMode;
  async function submit(event: React.FormEvent<HTMLFormElement>) {
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
      <section className="login-story">
        <div className="brand">
          <IconBolt size={34} fill="currentColor" />
          OCPP Board
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
      </section>
      <form className="login-form" onSubmit={(event) => void submit(event)}>
        <IconLock size={27} className="muted" />
        <h2>Welcome back</h2>
        <p>Sign in to your operator workspace.</p>
        {tokenMode ? (
          <label className="field">
            <span>Access token</span>
            <input
              className="text-input"
              type="password"
              required
              value={token}
              autoComplete="current-password"
              onChange={(event) => setToken(event.target.value)}
            />
          </label>
        ) : (
          <>
            <label className="field">
              <span>Username</span>
              <input
                className="text-input"
                required
                value={username}
                autoComplete="username"
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                className="text-input"
                type="password"
                required
                value={password}
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {session?.authMode === "custom" && (
              <label className="field">
                <span>Token (optional)</span>
                <input
                  className="text-input"
                  type="password"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                />
              </label>
            )}
          </>
        )}
        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          {busy ? "Signing in..." : "Sign in"}
        </button>
        <p className="notice">
          Use the credentials configured by your server administrator.
        </p>
      </form>
    </div>
  );
}
