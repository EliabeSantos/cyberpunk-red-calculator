/**
 * Código de mesa: identifica a sessão/mesa do Calculator que deve receber
 * as rolagens de um servidor Discord (guildId → channelId).
 *
 * Guardado pelo cliente (localStorage) e enviado junto de cada rolagem.
 * Módulo puro — sem dependência de cliente/servidor, seguro para testes.
 */

/** 3–48 caracteres: letras minúsculas, números e hífen (começa com letra/número). */
const SESSION_CODE_PATTERN = /^[a-z0-9][a-z0-9-]{2,47}$/;

/** Normaliza um código de mesa; retorna `null` quando inválido. */
export function normalizeSessionCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toLowerCase();
  return SESSION_CODE_PATTERN.test(code) ? code : null;
}

/** Gera um código curto para uma nova mesa (ex.: `mesa-3f9a12c4`). */
export function generateSessionCode(): string {
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return `mesa-${suffix}`;
}
