/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Fetch client. Attaches the bearer token, transparently refreshes once on 401
 * (retrying the original request), and surfaces a typed ApiError on failure.
 */
import { getAccess, getRefresh, setTokens, clear } from "@/lib/tokens";

/** Non-2xx HTTP error carrying the parsed response body for callers to inspect. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown) {
    super(`API ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

type SessionExpiredHandler = () => void;

let onSessionExpired: SessionExpiredHandler = () => {
  // Default: hard-clear local state. The auth layer overrides this to also
  // flip in-memory state to "anon" and route to /login.
  clear();
};

/** Register the handler invoked when a refresh fails (session is unrecoverable). */
export function setOnSessionExpired(cb: SessionExpiredHandler): void {
  onSessionExpired = cb;
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Attempt a single token refresh. Returns the new access token or null. */
let refreshInFlight: Promise<string | null> | null = null;

async function refreshTokens(): Promise<string | null> {
  // De-dupe concurrent refreshes so a burst of 401s triggers only one call.
  if (refreshInFlight) return refreshInFlight;

  const refreshToken = getRefresh();
  if (!refreshToken) return null;

  refreshInFlight = (async () => {
    try {
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return null;
      const body = (await parseBody(res)) as {
        accessToken?: string;
        refreshToken?: string;
      } | null;
      if (!body?.accessToken || !body?.refreshToken) return null;
      setTokens(body.accessToken, body.refreshToken);
      return body.accessToken;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

function buildInit(init: RequestInit | undefined, access: string | null): RequestInit {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type") && init?.body != null) {
    headers.set("Content-Type", "application/json");
  }
  if (access) headers.set("Authorization", `Bearer ${access}`);
  return { ...init, headers };
}

/**
 * Core request. `path` must already include the `/api` prefix. On 401 we try one
 * refresh + retry; if that fails we notify the session-expired handler and throw.
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, buildInit(init, getAccess()));

  if (res.status === 401) {
    const newAccess = await refreshTokens();
    if (newAccess) {
      const retry = await fetch(path, buildInit(init, newAccess));
      if (!retry.ok) throw new ApiError(retry.status, await parseBody(retry));
      return (await parseBody(retry)) as T;
    }
    onSessionExpired();
    throw new ApiError(401, await parseBody(res));
  }

  if (!res.ok) throw new ApiError(res.status, await parseBody(res));
  return (await parseBody(res)) as T;
}

export const api = {
  get<T>(path: string): Promise<T> {
    return apiFetch<T>(path, { method: "GET" });
  },
  post<T>(path: string, body?: unknown): Promise<T> {
    return apiFetch<T>(path, {
      method: "POST",
      body: body == null ? undefined : JSON.stringify(body),
    });
  },
  patch<T>(path: string, body?: unknown): Promise<T> {
    return apiFetch<T>(path, {
      method: "PATCH",
      body: body == null ? undefined : JSON.stringify(body),
    });
  },
  put<T>(path: string, body?: unknown): Promise<T> {
    return apiFetch<T>(path, {
      method: "PUT",
      body: body == null ? undefined : JSON.stringify(body),
    });
  },
  del<T>(path: string): Promise<T> {
    return apiFetch<T>(path, { method: "DELETE" });
  },
};
