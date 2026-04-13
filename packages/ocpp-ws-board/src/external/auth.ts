import type {
  AuthResult,
  BoardAuthConfig,
  LoginCredentials,
  SessionInfo,
} from "./types.js";

const sessions = new Map<string, SessionInfo>();
const DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24 hours

export function createAuthLayer(config: BoardAuthConfig) {
  const ttl =
    config.mode !== "none" ? ((config as any).sessionTtlMs ?? DEFAULT_TTL) : 0;

  async function authenticate(creds: LoginCredentials): Promise<AuthResult> {
    switch (config.mode) {
      case "token":
        return creds.token === config.token ? { name: "Admin" } : false;

      case "credentials":
        return creds.username === config.username &&
          creds.password === config.password
          ? { name: creds.username }
          : false;

      case "custom":
        return config.validate(creds);

      case "none":
        return { name: "dev" };
    }
  }

  function createSession(user: { id?: string; name: string }): string {
    const id = crypto.randomUUID();
    sessions.set(id, {
      user,
      expiresAt: Date.now() + ttl,
    });
    return id;
  }

  function getSession(sessionId: string): SessionInfo | null {
    const s = sessions.get(sessionId);
    if (!s) return null;
    if (Date.now() > s.expiresAt) {
      sessions.delete(sessionId);
      return null;
    }
    return s;
  }

  function destroySession(sessionId: string): void {
    sessions.delete(sessionId);
  }

  function getAuthMode(): string {
    return config.mode === "none" ? "disabled" : config.mode;
  }

  function requiresAuth(): boolean {
    return config.mode !== "none";
  }

  return {
    authenticate,
    createSession,
    getSession,
    destroySession,
    getAuthMode,
    requiresAuth,
  };
}

// ─── Cookie Helpers ───────────────────────────────────────────────

export function parseSessionCookie(
  cookieHeader: string | null | undefined,
): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/board-session=([^;]+)/);
  return match?.[1] ?? null;
}

export function sessionCookieHeader(sessionId: string, maxAge = 86400): string {
  return `board-session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearSessionCookieHeader(): string {
  return "board-session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
}
