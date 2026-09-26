/**
 * Publicador de rolagens da TELA DO GM para a mesa (navegador).
 *
 * O GM não tem ficha ligada à mesa (ele comanda inimigos), então seus
 * dados entram no registro como "relatório": log só, sem debitar Action
 * de combatente algum — na CPR o GM controla inimigos livremente.
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

function publish(sessionId: string, roll: MesaRollSummary): void {
  void sendMesaRoll(sessionId, roll).catch(() => {});
}

/** Ataque de inimigo rolado na tela do GM (Encounters / Enemies). */
export function publishMesaGmAttack(
  actor: string,
  label: string,
  expression: string,
  total: number,
  rolls: number[],
): void {
  const m = getActiveMembership();
  if (!m) return;
  publish(m.sessionId, build(actor, "attack", label, expression, total, rolls));
}

/** Teste de perícia de inimigo rolado na tela do GM. */
export function publishMesaGmSkill(
  actor: string,
  label: string,
  expression: string,
  total: number,
  rolls: number[],
): void {
  const m = getActiveMembership();
  if (!m) return;
  publish(m.sessionId, build(actor, "skill_check", label, expression, total, rolls));
}

/** Dano de inimigo rolado na tela do GM. */
export function publishMesaGmDamage(
  actor: string,
  label: string,
  expression: string,
  total: number,
  rolls: number[],
): void {
  const m = getActiveMembership();
  if (!m) return;
  publish(m.sessionId, build(actor, "damage", label, expression, total, rolls));
}

/** Iniciativa do encontro rolada na tela do GM (tabela completa). */
export function publishMesaGmInitiative(actor: string, total: number): void {
  const m = getActiveMembership();
  if (!m) return;
  publish(m.sessionId, build(actor, "free_roll", "Iniciativa", "1d10", total, [total]));
}
