/**
 * Contrato de dados enviado do site para o backend/Discord.
 *
 * Estes valores são produzidos pelo sistema de rolagem existente.
 * O Discord apenas os reproduz: ele nunca calcula nem gera dados.
 */

/** Tipos de rolagem de dados; `received_damage` e `humanity_loss` ficam de fora. */
export type DiscordRollKind = "attack" | "skill_check" | "evasion" | "damage" | "free_roll";

export interface DiscordRollPayload {
  kind: DiscordRollKind;
  playerName: string;
  rollType: string;
  expression: string;
  rolls: number[];
  modifier: number;
  total: number;
}

const ROLL_KINDS: readonly DiscordRollKind[] = [
  "attack",
  "skill_check",
  "evasion",
  "damage",
  "free_roll",
];

export function isDiceRollKind(value: unknown): value is DiscordRollKind {
  return typeof value === "string" && ROLL_KINDS.includes(value as DiscordRollKind);
}

/** Valida o payload recebido pelo backend antes de repassá-lo ao bot. */
export function isDiscordRollPayload(value: unknown): value is DiscordRollPayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Record<string, unknown>;
  return (
    isDiceRollKind(payload.kind) &&
    typeof payload.playerName === "string" &&
    payload.playerName.length > 0 &&
    typeof payload.rollType === "string" &&
    payload.rollType.length > 0 &&
    typeof payload.expression === "string" &&
    Array.isArray(payload.rolls) &&
    payload.rolls.length > 0 &&
    payload.rolls.every((roll) => Number.isInteger(roll)) &&
    Number.isInteger(payload.modifier) &&
    Number.isInteger(payload.total)
  );
}
