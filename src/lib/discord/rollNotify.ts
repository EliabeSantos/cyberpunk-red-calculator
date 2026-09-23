import { getDiscordConsent } from "@/lib/discord/consent";
import { getSessionCode } from "@/lib/discord/session";
import {
  isDiceRollKind,
  type DiscordInitiativePayload,
  type DiscordInitiativeRow,
  type DiscordMessagePayload,
  type DiscordRollPayload,
} from "@/lib/discord/types";
import type { Character, RollHistoryEntry } from "@/types/character";

/**
 * Converte a entrada de rolagem produzida pelo site no payload enviado ao backend.
 * O modificador é apenas a decomposição do total já calculado:
 * modifier = total - soma(dados). Nada é recalculado.
 * `sessionCode` identifica a mesa (vazio = mesa ainda não configurada).
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
    sessionCode: getSessionCode() ?? "",
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
 * Nada é enviado sem consentimento explícito ("granted") nem sem código de mesa.
 */
export function notifyDiscordRoll(entry: RollHistoryEntry, character: Character): void {
  if (getDiscordConsent() !== "granted") return;

  const payload = buildRollPayload(entry, character);
  if (!payload) return;
  // Sem mesa definida não há servidor de destino — não envia nada.
  if (!payload.sessionCode) return;

  postToDiscord(payload);
}

/**
 * Fire-and-forget compartilhado entre jogador e GM: uma falha nunca afeta
 * o site. O Discord é apenas um espelho do que já foi calculado aqui.
 */
function postToDiscord(body: DiscordMessagePayload): void {
  try {
    void fetch("/api/discord/roll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {
      // Silencioso por design.
    });
  } catch {
    // Silencioso por design.
  }
}

// ─── Encontros do GM: mesmos portões e o mesmo espelho ───

/**
 * Recorte de um participante de encontro necessário para montar o payload.
 * Estrutural de propósito: este módulo não depende do gmStorage.
 */
export interface EnemyRollSource {
  name: string;
  archetype: string;
  weaponName: string;
  attackBase: number;
  damageExpression: string;
  lastAttackRoll: { diceRolls: number[]; diceTotal: number; total: number; critical: boolean; fumble: boolean } | null;
  lastDamageRoll: { rolls: number[]; total: number } | null;
}

function enemyLabel(participant: EnemyRollSource): string {
  return participant.name.trim() || participant.archetype.trim() || "Inimigo";
}

/**
 * Payload do ataque do inimigo a partir do último resultado já calculado.
 * Mesma decomposição do lado do jogador: modificador = total - soma(dados),
 * que aqui equivale exatamente ao ataqueBase.
 */
export function buildEnemyAttackPayload(participant: EnemyRollSource): DiscordRollPayload | null {
  const roll = participant.lastAttackRoll;
  if (!roll || roll.diceRolls.length === 0) return null;

  const diceTotal = roll.diceRolls.reduce((sum, value) => sum + value, 0);
  const weapon = participant.weaponName.trim();

  return {
    sessionCode: getSessionCode() ?? "",
    kind: "attack",
    playerName: enemyLabel(participant),
    rollType: weapon || "Ataque",
    expression: "1d10",
    rolls: roll.diceRolls,
    modifier: roll.total - diceTotal,
    total: roll.total,
  };
}

/** Payload do dano do inimigo; modificador absorve bônus da expressão (ex.: 1d6+3 → +3). */
export function buildEnemyDamagePayload(participant: EnemyRollSource): DiscordRollPayload | null {
  const roll = participant.lastDamageRoll;
  if (!roll || roll.rolls.length === 0) return null;

  const diceTotal = roll.rolls.reduce((sum, value) => sum + value, 0);
  const weapon = participant.weaponName.trim();

  return {
    sessionCode: getSessionCode() ?? "",
    kind: "damage",
    playerName: enemyLabel(participant),
    rollType: weapon ? `Dano de ${weapon}` : "Dano",
    expression: participant.damageExpression,
    rolls: roll.rolls,
    modifier: roll.total - diceTotal,
    total: roll.total,
  };
}

/** Envia o ataque do inimigo — mesmos portões: consentimento + código de mesa. */
export function notifyEnemyAttack(participant: EnemyRollSource): void {
  if (getDiscordConsent() !== "granted") return;
  const payload = buildEnemyAttackPayload(participant);
  if (!payload || !payload.sessionCode) return;
  postToDiscord(payload);
}

/** Envia o dano do inimigo — mesmos portões: consentimento + código de mesa. */
export function notifyEnemyDamage(participant: EnemyRollSource): void {
  if (getDiscordConsent() !== "granted") return;
  const payload = buildEnemyDamagePayload(participant);
  if (!payload || !payload.sessionCode) return;
  postToDiscord(payload);
}

/**
 * Envia a iniciativa de TODO o encontro em UMA única mensagem-resumo.
 * `rows` vem na ordem (decrescente) que o site exibe — o Discord só reproduz.
 */
export function notifyEnemyInitiative(encounterName: string, rows: DiscordInitiativeRow[]): void {
  if (getDiscordConsent() !== "granted") return;
  if (rows.length === 0) return;

  const sessionCode = getSessionCode() ?? "";
  if (!sessionCode) return;

  const payload: DiscordInitiativePayload = {
    sessionCode,
    kind: "initiative",
    encounterName: encounterName.trim() || "Encontro",
    rows,
  };
  postToDiscord(payload);
}
