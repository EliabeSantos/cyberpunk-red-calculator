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
import type { SkillCheckActionContext } from "@/lib/combat/contract";
import type { RollHistoryEntry } from "@/types/character";
export type { SkillCheckActionContext } from "@/lib/combat/contract";

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
  skill_check: null,
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
  skillCheckContext?: SkillCheckActionContext;
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
    ...(entry.type === "skill_check" && isSkillCheckActionContext((entry as { skillCheckContext?: unknown }).skillCheckContext)
      ? { skillCheckContext: (entry as { skillCheckContext: SkillCheckActionContext }).skillCheckContext }
      : {}),
  };
}

export function isSkillCheckActionContext(value: unknown): value is SkillCheckActionContext {
  return value === "free" || value === "action" || value === "reaction";
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
  if (roll.type === "skill_check") {
    const context = (raw as { skillCheckContext?: unknown }).skillCheckContext;
    if (context !== undefined && !isSkillCheckActionContext(context)) {
      return { ok: false, reason: "Contexto de Skill Check inválido." };
    }
  }
  if (Math.abs(roll.total) > MAX_TOTAL) return { ok: false, reason: "Total de rolagem fora do intervalo." };
  return { ok: true, roll };
}

/** O que ESTA rolagem pode mexer na economia da mesa. */
export interface RollDebitPlan {
  /** Passa pela validação do servidor (`resolveAction`) e consome Action. */
  canDebit: boolean;
  /** Motivo de "não contou" quando a rolagem era uma ação e ficou por isso mesmo. */
  denial: string | null;
}

/**
 * Quem paga por esta rolagem (decisão de 27/09/2026).
 *
 * O encontro do Mestre agora manda as ações dos INIMIGOS para a mesa: quando
 * ele rola o ataque em `/gm/encounters` com a chave do participante (`key` →
 * `source_key`), o débito sai da linha do inimigo na mesa. Sem chave — tela de
 * catálogo de inimigos, GM rolando de fora — a rolagem continua sendo
 * RELATÓRIO: entra no Registro e não mexe em Action de ninguém (na CPR o Mestre
 * comanda inimigos livremente). Dano, dano recebido e rolagem livre nunca
 * custam: já são parte do mesmo ataque.
 */
export function planRollDebit(input: {
  role: "gm" | "player";
  actionType: CombatActionType | null;
  /** A rolagem veio identificando um inimigo do encontro (`key`)? */
  hasKey: boolean;
  /** Existe a linha correspondente neste combate? */
  targetFound: boolean;
}): RollDebitPlan {
  // Sem custo não há o que debitar nem o que justificar no Registro.
  if (input.actionType === null) return { canDebit: false, denial: null };

  if (input.role === "gm") {
    // Com chave e linha encontrada o inimigo paga; nos outros casos (sem
    // chave, inimigo fora deste combate ou migração pendente) é relatório —
    // sem débito e sem nota, como era antes do vínculo encontro↔mesa.
    return { canDebit: input.hasKey && input.targetFound, denial: null };
  }

  // Jogador: só o combatente dele é debitado. Sem linha vinculada o dado
  // entra no Registro sem custo (a ficha local nunca é bloqueada por isso).
  return { canDebit: input.targetFound, denial: null };
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

/**
 * Player não transforma o resultado rolado no navegador em prova autoritativa.
 * O log ainda registra a intenção/ocorrência, mas a mensagem é derivada pelo
 * servidor somente do participante autenticado e do tipo validado.
 */
export function formatPlayerRollEvent(actor: string, roll: MesaRollSummary, note = ""): string {
  const who = actor.trim() || "Jogador";
  const kind = roll.type === "skill_check"
    ? `Skill Check${roll.skillCheckContext ? ` (${roll.skillCheckContext})` : ""}`
    : roll.type === "evasion" ? "Evasão" : roll.type === "attack" ? "Ataque" : "Rolagem";
  const suffix = note ? ` · ${note}` : "";
  return `${who}: ${kind}${suffix}`.slice(0, MAX_EVENT_TEXT);
}
