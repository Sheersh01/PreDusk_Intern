const AUTH_KEY = "extracthub_dummy_auth";
const DEFAULT_SESSION_HOURS = 8;
const SESSION_HOURS_KEY = "extracthub_dummy_session_hours";

type StoredAuth = {
  username: string;
  loggedInAt: string;
};

function getSessionHours(): number {
  const raw = localStorage.getItem(SESSION_HOURS_KEY);
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_SESSION_HOURS;
}

function isExpired(loggedInAt: string): boolean {
  const started = new Date(loggedInAt).getTime();
  if (!Number.isFinite(started)) return true;
  const ttlMs = getSessionHours() * 60 * 60 * 1000;
  return Date.now() - started >= ttlMs;
}

function readStoredAuth(): StoredAuth | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAuth;
    if (!parsed?.username) return null;
    if (isExpired(parsed.loggedInAt)) {
      localStorage.removeItem(AUTH_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function isAuthenticated(): boolean {
  return !!readStoredAuth();
}

export function getCurrentUsername(): string | null {
  return readStoredAuth()?.username ?? null;
}

export function loginDummy(username: string): void {
  const trimmed = username.trim();
  const payload: StoredAuth = {
    username: trimmed || "guest",
    loggedInAt: new Date().toISOString(),
  };
  localStorage.setItem(AUTH_KEY, JSON.stringify(payload));
}

export function logoutDummy(): void {
  localStorage.removeItem(AUTH_KEY);
}

export function getAuthEnvironmentLabel(): string {
  const host = window.location.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1") {
    return "Local Mode";
  }
  return "Demo Mode";
}
