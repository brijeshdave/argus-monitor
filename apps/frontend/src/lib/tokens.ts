/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * localStorage token + cached-user store. Cached user enables no-flicker
 * hydration on page reload while /api/me revalidates in the background.
 */

/** The authenticated user, as returned by the backend (login + /api/me). */
export interface AuthUser {
  id: string;
  username: string;
  displayName?: string | null;
  email?: string | null;
}

const K_ACCESS = "argus.accessToken";
const K_REFRESH = "argus.refreshToken";
const K_USER = "argus.user";

export function getAccess(): string | null {
  return localStorage.getItem(K_ACCESS);
}

export function getRefresh(): string | null {
  return localStorage.getItem(K_REFRESH);
}

export function setTokens(access: string, refresh: string): void {
  localStorage.setItem(K_ACCESS, access);
  localStorage.setItem(K_REFRESH, refresh);
}

export function getCachedUser(): AuthUser | null {
  const raw = localStorage.getItem(K_USER);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function setCachedUser(user: AuthUser): void {
  localStorage.setItem(K_USER, JSON.stringify(user));
}

/** Wipe all auth state (tokens + cached user). */
export function clear(): void {
  localStorage.removeItem(K_ACCESS);
  localStorage.removeItem(K_REFRESH);
  localStorage.removeItem(K_USER);
}
