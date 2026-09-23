/**
 * Consentimento do usuário para enviar rolagens ao Discord.
 * Guardado no localStorage (mesmo prefixo do storage.ts) no cliente.
 * Sem consentimento explícito ("granted"), nenhuma informação é enviada.
 */

export type DiscordConsent = "granted" | "denied";

const DISCORD_CONSENT_KEY = "cyberpunk-red-toolkit:discord-consent:v1";

function canUseStorage() {
  return typeof window !== "undefined";
}

/** `null` significa que o usuário ainda nunca respondeu ao pedido. */
export function getDiscordConsent(): DiscordConsent | null {
  if (!canUseStorage()) return null;
  try {
    const value = window.localStorage.getItem(DISCORD_CONSENT_KEY);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    return null;
  }
}

export function setDiscordConsent(consent: DiscordConsent): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(DISCORD_CONSENT_KEY, consent);
  } catch {
    // Sem armazenamento disponível a escolha não persiste; o pedido aparecerá de novo.
  }
}
