const REMOTE_SERVER_KEY = "cyberpunk-red-toolkit:mesa-remote-server:v1";

/** Normaliza uma origem HTTP(S) explicitamente escolhida pelo usuário. */
export function normalizeMesaServerUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url.href.replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function getConfiguredMesaServerUrl(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return normalizeMesaServerUrl(window.localStorage.getItem(REMOTE_SERVER_KEY));
  } catch {
    return null;
  }
}

export function setConfiguredMesaServerUrl(raw: string): string | null {
  const normalized = normalizeMesaServerUrl(raw);
  if (typeof window !== "undefined") {
    try {
      if (normalized) window.localStorage.setItem(REMOTE_SERVER_KEY, normalized);
      else window.localStorage.removeItem(REMOTE_SERVER_KEY);
    } catch {
      // A configuração continua apenas na sessão quando o storage está bloqueado.
    }
  }
  return normalized;
}

export function isElectronRenderer(): boolean {
  return typeof navigator !== "undefined" && /Electron/i.test(navigator.userAgent);
}
