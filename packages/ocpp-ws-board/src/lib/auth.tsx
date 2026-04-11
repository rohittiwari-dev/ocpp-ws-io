import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { api } from "./api";

interface SessionData {
  authenticated: boolean;
  user?: { id?: string; name: string };
  authMode?: string;
}

interface AuthContextType {
  session: SessionData | null;
  isLoading: boolean;
  login: (credentials: {
    token?: string;
    username?: string;
    password?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
}

// biome-ignore lint/style/noNonNullAssertion: admin
const AuthContext = createContext<AuthContextType>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    api
      .get<SessionData>("/auth/session")
      .then(setSession)
      .catch(() => setSession({ authenticated: false }))
      .finally(() => setIsLoading(false));
  }, []);

  const login = async (credentials: {
    token?: string;
    username?: string;
    password?: string;
  }) => {
    await api.post("/auth/login", credentials);
    const newSession = await api.get<SessionData>("/auth/session");
    setSession(newSession);
  };

  const logout = async () => {
    await api.post("/auth/logout");
    // Re-fetch session so authMode is preserved from the server
    const freshSession = await api
      .get<SessionData>("/auth/session")
      .catch(() => ({ authenticated: false }) as SessionData);
    setSession(freshSession);
  };

  return (
    <AuthContext.Provider value={{ session, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
