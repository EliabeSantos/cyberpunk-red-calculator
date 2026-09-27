/**
 * Publicador de rolagens da TELA DO GM para a mesa (navegador).
 *
 * O GM não tem ficha ligada à mesa, então a rolagem não pertence a nenhum
 * jogador — quem paga é decidido pelo servidor (`planRollDebit`):
 *
 *   • **com `key`** (a tela do ENCONTRO, que está vinculada à mesa) a rolagem
 *     é DO INIMIGO: o servidor debita a Action da linha dele (`source_key`) e
 *     escreve o Registro com o nome do inimigo;
 *   • **sem `key`** (catálogo de inimigos, GM rolando de fora) é relatório
 *     puro — log só, sem debitar Action de combatente algum, na CPR o Mestre
 *     comanda inimigos livremente.
 *
 * Fire-and-forget: sem mesa ativa, falha de rede ou sessão encerrada
 * não quebram nada da tela do GM.
 */
import { getActiveMembership } from "@/lib/mesa/membershipStore";
import { sendMesaRoll } from "@/lib/mesa/client";
import type { MesaRollSummary } from "@/lib/mesa/rollPolicy";

const MAX_ACTOR = 60;

function build(
  actor: string,
  type: MesaRollSummary["type"],
  label: string,
  expression: string,
  total: number,
  rolls: number[],
): MesaRollSummary {
  return {
    type,
    label: label.slice(0, 60),
    expression: expression.slice(0, 120),
    total: Math.round(total),
    rolls: rolls.filter((v) => Number.isFinite(v)).slice(0, 40),
  };
}

function publish(sessionId: string, roll: MesaRollSummary, key?: string | null): void {
  void sendMesaRoll(sessionId, roll, key).catch(() => {});
}

/** Ataque de inimigo rolado na tela do GM (Encounters / Enemies). */
export function publishMesaGmAttack(
  actor: string,
  label: string,
  expression: string,
  total: number,
  rolls: number[],
  key?: string | null,
): void {
  const m = getActiveMembership();
  if (!m) return;
  publish(m.sessionId, build(actor, "attack", label, expression, total, rolls), key);
}

/** Teste de perícia de inimigo rolado na tela do GM. */
export function publishMesaGmSkill(
  actor: string,
  label: string,
  expression: string,
  total: number,
  rolls: number[],
  key?: string | null,
): void {
  const m = getActiveMembership();
  if (!m) return;
  publish(m.sessionId, build(actor, "skill_check", label, expression, total, rolls), key);
}

/**
 * **Evasão** de inimigo rolada na tela do GM (Encounters).
 *
 * Vai como `type: "evasion"` — mesma chave que a ficha do jogador usa, então o
 * servidor cobra do inimigo a mesma Action que um jogador pagaria por esquivar
 * (`MESA_ROLL_ACTION.evasion = "other"`).
 */
export function publishMesaGmEvasion(
  actor: string,
  label: string,
  expression: string,
  total: number,
  rolls: number[],
  key?: string | null,
): void {
  const m = getActiveMembership();
  if (!m) return;
  publish(m.sessionId, build(actor, "evasion", label, expression, total, rolls), key);
}

/** Dano de inimigo rolado na tela do GM (custo zero — já é parte do ataque). */
export function publishMesaGmDamage(
  actor: string,
  label: string,
  expression: string,
  total: number,
  rolls: number[],
  key?: string | null,
): void {
  const m = getActiveMembership();
  if (!m) return;
  publish(m.sessionId, build(actor, "damage", label, expression, total, rolls), key);
}

/** Iniciativa do encontro rolada na tela do GM (tabela completa). */
export function publishMesaGmInitiative(actor: string, total: number, key?: string | null): void {
  const m = getActiveMembership();
  if (!m) return;
  publish(m.sessionId, build(actor, "free_roll", "Iniciativa", "1d10", total, [total]), key);
}
