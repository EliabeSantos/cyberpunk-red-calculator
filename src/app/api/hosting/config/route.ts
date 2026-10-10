import { readFile, writeFile, rename, mkdir, chmod } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { Pool } from "pg";

import { errorResponse, ok, readJson } from "@/lib/mesa/http";
import { authenticateHostAdmin } from "@/lib/hostingAdminAuth";

export const runtime = "nodejs";

type HostingMode = "local" | "supabase";

function currentMode(): HostingMode | null {
  const mode = process.env.MESA_HOSTING_MODE?.trim().toLowerCase();
  return mode === "local" || mode === "supabase" ? mode : null;
}

function configFile(): string | null {
  return process.env.MESA_HOSTING_MODE_FILE?.trim() || process.env.MESA_HOST_ENV_FILE?.trim() || null;
}

function availableModes(): HostingMode[] {
  const modes: HostingMode[] = [];
  if (process.env.MESA_LOCAL_DATABASE_URL?.trim()) modes.push("local");
  if (process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) modes.push("supabase");
  return modes;
}

async function hasActiveSessions(): Promise<boolean> {
  const mode = currentMode();
  if (mode === "local") {
    const url = process.env.MESA_LOCAL_DATABASE_URL?.trim();
    if (!url) return true;
    const pool = new Pool({ connectionString: url, max: 1 });
    try {
      const result = await pool.query("select exists(select 1 from public.mesa_sessions where status = 'active') as active");
      return Boolean(result.rows[0]?.active);
    } finally {
      await pool.end();
    }
  }
  if (mode === "supabase") {
    const { getSupabaseAdmin } = await import("@/lib/supabaseAdmin");
    const result = await getSupabaseAdmin().from("mesa_sessions").select("id").eq("status", "active").limit(1);
    if (result.error) throw new Error("Não foi possível verificar mesas ativas no Supabase.");
    return result.data.length > 0;
  }
  return false;
}

async function replaceMode(file: string, mode: HostingMode): Promise<void> {
  const source = await readFile(file, "utf8");
  const line = `MESA_HOSTING_MODE=${mode}`;
  const lines = source.split(/\r?\n/).filter((item) => !item.startsWith("MESA_HOSTING_MODE="));
  lines.unshift(line);
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(temporary, `${lines.filter(Boolean).join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, file);
  await chmod(file, 0o600).catch(() => undefined);
}

function unauthorizedResponse(status: 401 | 429, retryAfter?: number): Response {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (retryAfter) headers.set("Retry-After", String(retryAfter));
  return Response.json({ ok: false, error: status === 429 ? "hosting_admin_rate_limited" : "hosting_admin_unauthorized" }, { status, headers });
}

async function requireHostAdmin(request: Request): Promise<Response | null> {
  const result = await authenticateHostAdmin(request);
  return result.ok ? null : unauthorizedResponse(result.status, result.retryAfter);
}

export async function GET(): Promise<Response> {
  // O estado do ambiente não contém credenciais. A alteração continua
  // protegida abaixo por authenticateHostAdmin.
  return ok({
    mode: currentMode(),
    availableModes: availableModes(),
    configurable: Boolean(configFile()),
    restartRequired: false,
  });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const unauthorized = await requireHostAdmin(request);
    if (unauthorized) return unauthorized;
    const body = await readJson(request);
    const mode = String(body.mode ?? "").trim().toLowerCase() as HostingMode;
    if (mode !== "local" && mode !== "supabase") {
      return Response.json({ error: "hosting_mode_invalid" }, { status: 400 });
    }
    if (!availableModes().includes(mode)) {
      return Response.json({ error: "hosting_mode_unavailable", mode }, { status: 409 });
    }
    const file = configFile();
    if (!file) return Response.json({ error: "hosting_mode_not_configurable" }, { status: 409 });
    if (currentMode() === mode) return ok({ mode, availableModes: availableModes(), configurable: true, restartRequired: false });
    if (await hasActiveSessions()) return Response.json({ error: "hosting_mode_active_sessions" }, { status: 409 });
    await replaceMode(file, mode);
    // Hosting mode is selected during process startup. Do not claim that the
    // running process changed modes after only editing its env file.
    return ok({ mode: currentMode(), pendingMode: mode, availableModes: availableModes(), configurable: true, restartRequired: true });
  } catch (error) {
    return errorResponse(error);
  }
}
