/**
 * Contrato de dados enviado do site para o backend/Discord.
 *
 * Estes valores são produzidos pelo sistema de rolagem existente.
 * O Discord apenas os reproduz: ele nunca calcula nem gera dados.
 */

/** Tipos de rolagem de dados; `received_damage` e `humanity_loss` ficam de fora. */
export type DiscordRollKind = "attack" | "skill_check" | "evasion" | "damage" | "free_roll";

export interface DiscordRollPayload {
  /** Código da mesa que originou a rolagem — usado para rotear ao servidor certo. */
  sessionCode: string;
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

/** IDs do Discord (snowflakes) são numéricos. */
export function isSnowflake(value: unknown): value is string {
  return typeof value === "string" && /^\d{10,25}$/.test(value);
}

/** Valida o payload recebido pelo backend antes de repassá-lo ao bot. */
export function isDiscordRollPayload(value: unknown): value is DiscordRollPayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.sessionCode === "string" &&
    payload.sessionCode.length > 0 &&
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

// ─── Diretório do bot e configuração de mesa (painel) ───

export interface DiscordDirectoryChannel {
  id: string;
  name: string;
  /** O bot consegue enviar mensagens neste canal (View Channel + Send Messages). */
  canSend: boolean;
}

export interface DiscordDirectoryGuild {
  id: string;
  name: string;
  channels: DiscordDirectoryChannel[];
}

/** Servidores Discord onde o único bot está instalado. */
export interface DiscordBotDirectory {
  botReady: boolean;
  /** Link público para instalar o bot em um servidor (permissões mínimas). */
  inviteUrl: string;
  guilds: DiscordDirectoryGuild[];
}

/** Visão completa devolvida ao painel de configuração da mesa. */
export interface DiscordConfigView extends DiscordBotDirectory {
  sessionCode: string;
  current: { guildId: string; channelId: string } | null;
}

export interface DiscordConfigRequest {
  sessionCode: string;
  guildId: string;
  channelId: string;
}

export function isDiscordConfigRequest(value: unknown): value is DiscordConfigRequest {
  if (typeof value !== "object" || value === null) return false;
  const request = value as Record<string, unknown>;
  return (
    typeof request.sessionCode === "string" &&
    request.sessionCode.length > 0 &&
    isSnowflake(request.guildId) &&
    isSnowflake(request.channelId)
  );
}
