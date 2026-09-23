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

// ─── Iniciativa de encontro (mensagem-resumo única) ───

/** Uma linha da tabela de iniciativa — rolagem, bônus e total já calculados pelo site. */
export interface DiscordInitiativeRow {
  /** Nome do participante exibido na tela do GM (inimigo). */
  name: string;
  /** Dado único rolado (d10). */
  roll: number;
  /** Bônus de REF somado pelo site. */
  ref: number;
  /** Total final (roll + ref), igual ao exibido na tela. */
  total: number;
}

/**
 * Payload de UMA mensagem com a ordem de iniciativa completa do encontro.
 * O site rola, soma e ordena; o Discord apenas reproduz a tabela.
 * Uma mensagem por inimigo encheria o canal e esbarraria no rate limit (5/5s).
 */
export interface DiscordInitiativePayload {
  sessionCode: string;
  kind: "initiative";
  /** Nome do encontro — contexto da mensagem. */
  encounterName: string;
  rows: DiscordInitiativeRow[];
}

/** Mensagens aceitas pelo endpoint de espelho: rolagem única ou resumo de iniciativa. */
export type DiscordMessagePayload = DiscordRollPayload | DiscordInitiativePayload;

export function isDiscordInitiativeRow(value: unknown): value is DiscordInitiativeRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.name === "string" &&
    row.name.length > 0 &&
    Number.isInteger(row.roll) &&
    Number.isInteger(row.ref) &&
    Number.isInteger(row.total)
  );
}

export function isDiscordInitiativePayload(value: unknown): value is DiscordInitiativePayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.sessionCode === "string" &&
    payload.sessionCode.length > 0 &&
    payload.kind === "initiative" &&
    typeof payload.encounterName === "string" &&
    payload.encounterName.length > 0 &&
    Array.isArray(payload.rows) &&
    payload.rows.length > 0 &&
    payload.rows.every(isDiscordInitiativeRow)
  );
}

/** Aceita qualquer uma das duas mensagens; uma falha de forma nunca publica. */
export function isDiscordMessagePayload(value: unknown): value is DiscordMessagePayload {
  if (typeof value !== "object" || value === null) return false;
  return (value as Record<string, unknown>).kind === "initiative"
    ? isDiscordInitiativePayload(value)
    : isDiscordRollPayload(value);
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
