/**
 * Política das rolagens da ficha NA MESA — módulo PURO, compartilhado.
 *
 * Quando o jogador está em uma mesa, o dado que ele rola na CharacterSheet é
 * a ação da mesa: debita do orçamento (Combat Engine) e entra no Registro do
 * combate para todo mundo ver. Aqui fica SÓ a política — quais rolagens vão
 * para a mesa e quanto custa cada uma —; quem valida de verdade é o servidor
 * (`registerRoll`), com a mesma `resolveAction` do botão ATAQUE.
 *
 * Puro de propósito: o navegador importa para decidir o que enviar e os
 * testes cobrem as regras sem tocar no banco nem em `store.ts`
 * (que levaria `@supabase/supabase-js` + service role para o bundle).
 */

import type { CombatActionType } from "@/lib/combatEngine";
import type { RollHistoryEntry } from "@/types/character";

/** Tipos do histórico da ficha que têm significado dentro da mesa. */
export type MesaRollKind =
  | "attack"
  | "skill_check"
  | "evasion"
  | "damage"
  | "received_damage"
  | "free_roll";

const MESA_ROLL_KINDS: readonly string[] = [
  "attack",
  "skill_check",
  "evasion",
  "damage",
  "received_damage",
  "free_roll",
];

export function isMesaRollKind(value: unknown): value is MesaRollKind {
  return typeof value === "string" && MESA_ROLL_KINDS.includes(value);
}

/**
 * Quanto cada rolagem custa na economia da mesa.
 *
 * `null` = só entra no registro, sem mexer nas Actions: dano e dano recebido
 * pertencem ao mesmo ataque (não podem cobrar uma segunda Action) e a rolagem
 * livre/iniciativa não é ação de combate.
 */
export const MESA_ROLL_ACTION: Record<MesaRollKind, CombatActionType | null> = {
  attack: "attack",
  skill_check: "other",
  evasion: "other",
  damage: null,
  received_damage: null,
  free_roll: null,
};

export interface MesaRollSummary {
  /** Mesmo nome do campo na ficha e no payload da requisição: `type`. */
  type: MesaRollKind;
  label: string;
  expression: string;
  total: number;
  rolls: number[];
}

const MAX_LABEL = 60;
const MAX_EXPRESSION = 120;
const MAX_ROLLS = 40;
const MAX_TOTAL = 10000;
const MAX_EVENT_TEXT = 200;

type RollHistorySlice = Pick<RollHistoryEntry, "type" | "label" | "expression" | "total" | "rolls">;

/**
 * Extrai o resumo de uma entrada do histórico da ficha.
 * `null` = essa rolagem não vai para a mesa (ex.: humanidade).
 */
export function summarizeRoll(
  entry: RollHistorySlice | Partial<RollHistorySlice> | null | undefined,
): MesaRollSummary | null {
  if (!entry || !isMesaRollKind(entry.type)) return null;

  const label = typeof entry.label === "string" && entry.label.trim() ? entry.label.trim() : "Rolagem";
  const expression = typeof entry.expression === "string" ? entry.expression.trim() : "";
  const total = Number(entry.total);
  const rolls = Array.isArray(entry.rolls) ? entry.rolls : [];

  return {
    type: entry.type,
    label: label.slice(0, MAX_LABEL),
    expression: expression.slice(0, MAX_EXPRESSION),
    total: Number.isFinite(total) ? Math.round(total) : 0,
    rolls: rolls.filter((value) => Number.isFinite(Number(value))).slice(0, MAX_ROLLS),
  };
}

export type ParseMesaRollResult =
  | { ok: true; roll: MesaRollSummary }
  | { ok: false; reason: string };

/**
 * Valida o payload vindo do navegador. O servidor nunca confia no cliente:
 * tipo fora da lista, corpo malformado ou total absurdo são recusados antes
 * de qualquer leitura no banco.
 */
export function parseMesaRoll(raw: unknown): ParseMesaRollResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "Corpo da rolagem inválido." };
  }
  const roll = summarizeRoll(raw as Partial<RollHistorySlice>);
  if (!roll) return { ok: false, reason: "Tipo de rolagem que não vai para a mesa." };
  if (Math.abs(roll.total) > MAX_TOTAL) return { ok: false, reason: "Total de rolagem fora do intervalo." };
  return { ok: true, roll };
}

/**
 * Sufixo honesto no registro quando a rolagem ERA uma ação e o servidor não
 * deixou debitá-la. A rolagem aconteceu na ficha e não pode ser desfeita aqui —
 * o registro conta o porquê em vez de esconder.
 */
export function rollDenialNote(reason: string | null | undefined): string {
  switch (reason) {
    case "not_your_turn":
      return "fora do seu turno";
    case "insufficient_actions":
      return "sem Actions sobrando";
    case "not_allowed":
      return "sem combatente vinculado";
    case "combatant_defeated":
      return "fora do combate";
    case "initiative_not_started":
      return "iniciativa não rolada";
    case "combat_finished":
    case "combat_not_active":
      return "sem combate ativo";
    case null:
    case undefined:
      return "";
    default:
      return "não contou";
  }
}

/**
 * Texto do evento no Registro do combate.
 * `note` entra só quando a rolagem não virou ação — as rolagens sem custo
 * (dano, livre) jamais ganham sufixo.
 */
export function formatRollEvent(actor: string, roll: MesaRollSummary, note = ""): string {
  const who = actor.trim() || "Jogador";
  const parts = [`${who}: ${roll.label} ${roll.total}`];
  if (roll.expression) parts.push(`(${roll.expression})`);
  if (note) parts.push(`· ${note}`);
  const text = parts.join(" ");
  return text.length > MAX_EVENT_TEXT ? `${text.slice(0, MAX_EVENT_TEXT - 1)}…` : text;
}
