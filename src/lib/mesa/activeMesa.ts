/**
 * F1.12.7 — **"Mesa ativa" do botão "Mesa"** — módulo de decisão (PURO nas
 * regras + uma função fina que só consulta o servidor).
 *
 *     Player clica "Mesa"
 *           ↓
 *     activeMesaCandidate(membershipStore)   ← MESMA assinatura de sempre
 *           ↓
 *     ┌──────────┴──────────┐
 *   jogador ou Mestre  sem Mesa / sessão que não responde
 *     ↓                         ↓
 *     SERVER OK                 fluxo atual (entrada/seleção/criação)
 *     ↓
 *     navigate → /mesa/<uuid>
 *     stale    → removeMembership() + fluxo atual
 *
 * Três regras seguem a restrição da etapa:
 *
 *  • **fonte única**: a candidata vem do `membershipStore` (o mesmo snapshot
 *    que o `MesaEntry`, o `CharacterToolkit` e o `MesaEncounterStart` leem).
 *    Aqui não mora nenhuma cópia de Mesa, só a decisão sobre ela;
 *  • **Mesa ativa = assinatura que aponta para uma sessão VÁLIDA e ATIVA**:
 *    `sessionId` em forma de uuid E confirmada pelo servidor. Sem as duas
 *    coisas não há navegação — não se manda o jogador para uma Mesa inválida;
 *  • **stale é limpo com a infraestrutura existente**: `removeMembership`,
 *    a mesma regra usada pela tela dedicada ao validar a sessão —
 *    e a lista de códigos que significa "assinatura morta" é a MESMA
 *    (`STALE_CODES` no `membershipStore`, fonte única desde o F1.12.8).
 *
 * O que NÃO acontece aqui: nenhuma alteração de `/api/mesa/join`, nenhuma
 * tabela, nenhum token novo, nenhum estado de Mesa paralelo. A tela dedicada
 * substitui o dock/modal legado.
 */

import { fetchMesaState, MesaApiError } from "@/lib/mesa/client";
import {
  getMembershipSnapshot,
  removeMembership,
  STALE_CODES,
  type StoredMembership,
} from "@/lib/mesa/membershipStore";
import { isMesaSessionId, playerMesaHref } from "@/lib/mesa/mesaRoute";
import type { MesaState } from "@/lib/mesa/types";

export interface ActiveMesaCandidate {
  joinCode: string;
  sessionId: string;
  role: "gm" | "player";
}

/** Confirmou Mesa viva para o jogador: só falta navegar. */
export interface NavigateDecision {
  kind: "navigate";
  sessionId: string;
  href: string;
}
/** Assinatura expirada: já limpada, cai no fluxo normal de entrada. */
export interface StaleDecision {
  kind: "stale";
  joinCode: string;
}
/** Nada a redirecionar (sem Mesa, Mestre, ou não foi possível confirmar). */
export interface EntryDecision {
  kind: "entry";
}

export type ActiveMesaDecision = NavigateDecision | StaleDecision | EntryDecision;

/**
 * A candidata a "Mesa ativa", lida do snapshot DO MEMBERSHIP.
 *
 * Exige as três coisas que a navegação precisa: `activeJoinCode`, a entrada
 * correspondente e um `sessionId` em forma de uuid. Entrada corrompida (uuid
 * quebrado) não vira candidata — e por isso não vira redirect.
 */
export function activeMesaCandidate(snapshot: StoredMembership): ActiveMesaCandidate | null {
  const joinCode = snapshot.activeJoinCode;
  if (!joinCode) return null;
  const entry = snapshot.entries[joinCode];
  if (!entry) return null;
  if (!isMesaSessionId(entry.sessionId)) return null;
  return { joinCode, sessionId: entry.sessionId, role: entry.role };
}

/**
 * A tela dedicada da Mesa atende tanto jogador quanto Mestre. Os controles do
 * Mestre vivem na mesma tela, derivados do papel no snapshot da sessão.
 */
export function navigatesToPlayerScreen(candidate: ActiveMesaCandidate): boolean {
  return Boolean(candidate.sessionId);
}

/** Assinatura confirmada viva pelo servidor. */
export function livenessFromState(state: MesaState): "active" | "stale" {
  return state.session.status === "finished" ? "stale" : "active";
}

/**
 * Erro na checagem: `stale` só quando o servidor diz que a assinatura morreu.
 * Qualquer outra falha (rede, 5xx, sessão fora do ar) é `unconfirmed`: NÃO
 * apaga a assinatura — o vínculo só cai por pedido ou por decisão do servidor,
 * que é a regra da tela dedicada da Mesa.
 */
export function livenessFromError(caught: unknown): "stale" | "unconfirmed" {
  if (caught instanceof MesaApiError && STALE_CODES.has(caught.code)) return "stale";
  return "unconfirmed";
}

/**
 * Resolve o que o botão "Mesa" deve fazer. **Nunca lança**: qualquer falha vira
 * `{ kind: "entry" }`, ou seja, o fluxo atual continua funcionando.
 */
export async function resolveActiveMesa(): Promise<ActiveMesaDecision> {
  const candidate = activeMesaCandidate(getMembershipSnapshot());
  // Sem candidata (nunca entrou ou entrada corrompida), abre o fluxo de entrada.
  if (!candidate || !navigatesToPlayerScreen(candidate)) return { kind: "entry" };

  let liveness: "active" | "stale" | "unconfirmed";
  try {
    liveness = livenessFromState(await fetchMesaState(candidate.sessionId));
  } catch (caught) {
    liveness = livenessFromError(caught);
  }

  if (liveness === "active") {
    return { kind: "navigate", sessionId: candidate.sessionId, href: playerMesaHref(candidate.sessionId) };
  }
  if (liveness === "stale") {
    // Infraestrutura existente: remove a assinatura que o servidor declarou morta.
    removeMembership(candidate.joinCode);
    return { kind: "stale", joinCode: candidate.joinCode };
  }
  // Não confirmou: não navega (evita mesa inválida) e não limpa (mantém o vínculo).
  return { kind: "entry" };
}
