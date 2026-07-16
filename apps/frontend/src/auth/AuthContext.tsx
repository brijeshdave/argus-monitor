/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Auth provider + useAuth hook. Holds the authenticated user, permission set and
 * session status; revalidates against /api/me on mount with no-flicker hydration.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, setOnSessionExpired } from "@/lib/api";
import {
  clear,
  getAccess,
  getCachedUser,
  setCachedUser,
  setTokens,
  type AuthUser,
} from "@/lib/tokens";

type AuthStatus = "loading" | "authed" | "anon";

/** Shape returned by GET /api/me. */
interface MeResponse {
  user: AuthUser;
  permissions: string[];
  attributes: Record<string, unknown>;
  isOwner: boolean;
  mustSetup2fa?: boolean;
  /** True when authenticated with a display-device token (wallboard-only). */
  isDevice?: boolean;
}

/** Shape returned by POST /api/auth/login. */
interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

interface AuthContextValue {
  user: AuthUser | null;
  permissions: string[];
  isOwner: boolean;
  /** True for a paired display device: it may ONLY render its wallboard. */
  isDevice: boolean;
  /** True when policy requires 2FA but the user has not enrolled yet. */
  mustSetup2fa: boolean;
  status: AuthStatus;
  /** Pass `code` when the server has asked for a second factor. */
  login: (username: string, password: string, code?: string) => Promise<void>;
  logout: () => Promise<void>;
  has: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const hasToken = Boolean(getAccess());
  const [user, setUser] = useState<AuthUser | null>(hasToken ? getCachedUser() : null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [isDevice, setIsDevice] = useState(false);
  const [mustSetup2fa, setMustSetup2fa] = useState(false);
  const [status, setStatus] = useState<AuthStatus>(hasToken ? "loading" : "anon");

  // Guards against state updates after unmount during the mount revalidation.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const applyMe = useCallback((me: MeResponse) => {
    setUser(me.user);
    setPermissions(me.permissions);
    setIsOwner(me.isOwner);
    setIsDevice(me.isDevice === true);
    setMustSetup2fa(Boolean(me.mustSetup2fa));
    setCachedUser(me.user);
    setStatus("authed");
  }, []);

  const becomeAnon = useCallback(() => {
    setUser(null);
    setPermissions([]);
    setIsDevice(false);
    setIsOwner(false);
    setMustSetup2fa(false);
    setStatus("anon");
  }, []);

  // Clean expired-session handling: clear local state without a server round-trip
  // (the refresh already failed) and drop straight to anon — no zombie state.
  useEffect(() => {
    setOnSessionExpired(() => {
      clear();
      if (mounted.current) becomeAnon();
    });
  }, [becomeAnon]);

  // On mount: if a token exists, revalidate it against /api/me.
  useEffect(() => {
    if (!getAccess()) {
      becomeAnon();
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const me = await api.get<MeResponse>("/api/me");
        if (!cancelled && mounted.current) applyMe(me);
      } catch {
        // apiFetch handles 401 (→ onSessionExpired). Any other failure: drop to anon.
        if (!cancelled && mounted.current) {
          clear();
          becomeAnon();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Run exactly once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    async (username: string, password: string, code?: string) => {
      const res = await api.post<LoginResponse>("/api/auth/login", { username, password, code });
      setTokens(res.accessToken, res.refreshToken);
      setCachedUser(res.user);
      // Hydrate the full permission set from /api/me; fall back to the login user.
      try {
        const me = await api.get<MeResponse>("/api/me");
        applyMe(me);
      } catch {
        setUser(res.user);
        setPermissions([]);
        setIsOwner(false);
        setStatus("authed");
      }
    },
    [applyMe],
  );

  const logout = useCallback(async () => {
    const refreshToken = localStorage.getItem("argus.refreshToken");
    try {
      if (refreshToken) await api.post("/api/auth/logout", { refreshToken });
    } catch {
      // best effort — local sign-out proceeds regardless
    }
    clear();
    becomeAnon();
  }, [becomeAnon]);

  const has = useCallback(
    (permission: string) => isOwner || permissions.includes(permission),
    [isOwner, permissions],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ user, permissions, isOwner, isDevice, mustSetup2fa, status, login, logout, has }),
    [user, permissions, isOwner, isDevice, mustSetup2fa, status, login, logout, has],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
