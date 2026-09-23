import { getDiscordConsent } from "@/lib/discord/consent";
import { isDiceRollKind, type DiscordRollPayload } from "@/lib/discord/types";
import type { Character, RollHistoryEntry } from "@/types/character";

/**
 * Converte a entrada de rolagem produzida pelo site no payload enviado ao backend.
 * O modificador é apenas a decomposição do total já calculado:
 * modifier = total - soma(dados). Nada é recalculado.
 */
export function buildRollPayload(
  entry: RollHistoryEntry,
  character: Character,
): DiscordRollPayload | null {
  if (!isDiceRollKind(entry.type)) return null;
  if (entry.rolls.length === 0) return null;

  const diceTotal = entry.rolls.reduce((sum, value) => sum + value, 0);
  const playerName =
    character.identity.player.trim() || character.identity.name.trim() || "Jogador";

  return {
    kind: entry.type,
    playerName,
    rollType: entry.label,
    expression: entry.expression,
    rolls: entry.rolls,
    modifier: entry.total - diceTotal,
    total: entry.total,
  };
}

/** Retorna a primeira entrada de rolagem que surgiu entre duas versões da ficha. */
export function findNewRollEntry(
  previous: Character | null,
  next: Character,
): RollHistoryEntry | null {
  const knownIds = new Set((previous?.rollHistory ?? []).map((entry) => entry.id));
  return next.rollHistory.find((entry) => !knownIds.has(entry.id)) ?? null;
}

/**
 * Envia a rolagem já calculada para o backend publicar no Discord.
 * Fire-and-forget: uma falha nunca afeta a rolagem no site.
 * Sem consentimento explícito ("granted"), nada sai do navegador.
 */
export function notifyDiscordRoll(entry: RollHistoryEntry, character: Character): void {
  if (getDiscordConsent() !== "granted") return;

  const payload = buildRollPayload(entry, character);
  if (!payload) return;

  try {
    void fetch("/api/discord/roll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {
      // Silencioso: o Discord é apenas um espelho da rolagem.
    });
  } catch {
    // Silencioso por design.
  }
}
