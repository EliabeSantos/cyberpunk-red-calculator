import "client-only";

import { normalizeSessionCode } from "@/lib/discord/sessionCode";

/**
 * Código da mesa no navegador (localStorage).
 * É a chave que associa as rolagens deste navegador a um servidor Discord —
 * a vinculação guildId → channelId vive no servidor, nunca aqui.
 */

const SESSION_CODE_KEY = "cyberpunk-red-toolkit:session-code:v1";

function canUseStorage() {
  return typeof window !== "undefined";
}

/** Código da mesa atual, ou `null` se ainda não houver um válido. */
export function getSessionCode(): string | null {
  if (!canUseStorage()) return null;
  try {
    return normalizeSessionCode(window.localStorage.getItem(SESSION_CODE_KEY));
  } catch {
    return null;
  }
}

/** Define o código da mesa. Retorna `false` e não salva se o valor for inválido. */
export function setSessionCode(code: string): boolean {
  const normalized = normalizeSessionCode(code);
  if (!canUseStorage() || !normalized) return false;
  try {
    window.localStorage.setItem(SESSION_CODE_KEY, normalized);
    return true;
  } catch {
    return false;
  }
}

export function clearSessionCode(): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.removeItem(SESSION_CODE_KEY);
  } catch {
    // Sem armazenamento não há o que limpar.
  }
}
