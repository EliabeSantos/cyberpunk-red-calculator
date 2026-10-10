import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";

export const HOST_ADMIN_TOKEN_HEADER = "x-host-admin-token";

let failedAttempts = 0;
let lockedUntil = 0;

function configuredTokenFile(): string | null {
  return process.env.MESA_HOST_ADMIN_TOKEN_FILE?.trim() || null;
}

async function configuredToken(): Promise<string | null> {
  const file = configuredTokenFile();
  if (file) {
    try {
      const token = (await readFile(file, "utf8")).trim();
      return token || null;
    } catch {
      return null;
    }
  }
  // Container deployments may inject a secret through the process environment.
  // The Windows installer uses the protected file above instead.
  return process.env.MESA_HOST_ADMIN_TOKEN?.trim() || null;
}

function presentedToken(request: Request): string | null {
  const bearer = request.headers.get("authorization");
  if (bearer?.startsWith("Bearer ")) return bearer.slice("Bearer ".length);
  return request.headers.get(HOST_ADMIN_TOKEN_HEADER);
}

function sameSecret(actual: string, expected: string): boolean {
  const actualDigest = createHash("sha256").update(actual).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

export type HostAdminAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 429; retryAfter?: number };

/**
 * Authenticates only the host administrator. Mesa player/GM tokens are never
 * considered here, and request routing headers are intentionally ignored.
 */
export async function authenticateHostAdmin(request: Request): Promise<HostAdminAuthResult> {
  const now = Date.now();
  if (lockedUntil > now) {
    return { ok: false, status: 429, retryAfter: Math.ceil((lockedUntil - now) / 1000) };
  }

  const presented = presentedToken(request);
  const configured = await configuredToken();
  if (presented && configured && sameSecret(presented, configured)) {
    failedAttempts = 0;
    lockedUntil = 0;
    return { ok: true };
  }

  failedAttempts += 1;
  if (failedAttempts >= 5) {
    failedAttempts = 0;
    lockedUntil = now + 30_000;
    return { ok: false, status: 429, retryAfter: 30 };
  }
  return { ok: false, status: 401 };
}
