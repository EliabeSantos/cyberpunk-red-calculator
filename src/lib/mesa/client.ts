/**
 * Cliente HTTP da Mesa (NAVEGADOR).
 *
 * Guarda duas coisas no localStorage, sem quebrar nada do que já existe:
 *   • `mesa-player:v1`     → o playerToken deste navegador (identidade efetiva);
 *   • `mesa-membership:v1` → em quais mesas este navegador já entrou.
 *
 * A ficha continua no seu próprio endereço de sempre
 * (`cyberpunk-red-toolkit:characters:v1`); aqui só mandamos uma CÓPIA quando
 * o jogador vincula o personagem a uma mesa.
 */
import type { MesaParticipant, MesaSession, MesaState } from "@/lib/mesa/types";
import type { MesaRollSummary } from "@/lib/mesa/rollPolicy";
import {
  getActiveMembership,
  getPlayerToken,
  listMemberships,
  rememberMembership,
  removeMembership,
} from "@/lib/mesa/membershipStore";

const TOKEN_HEADER = "x-mesa-token";

export { getActiveMembership, listMemberships };

export class MesaApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "MesaApiError";
    this.status = status;
    this.code = code;
  }
}

async function api<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
      [TOKEN_HEADER]: getPlayerToken(),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  let payload: { ok?: boolean; error?: string; code?: string } = {};
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    payload = {};
  }

  if (!response.ok || payload.ok === false) {
    throw new MesaApiError(
      payload.error ?? `Falha na requisição (${response.status}).`,
      response.status,
      payload.code ?? "unknown",
    );
  }
  return payload as T;
}

// ---------------------------------------------------------------------------
// Operações
// ---------------------------------------------------------------------------

export interface JoinResult {
  session: MesaSession;
  participant: MesaParticipant;
}

export async function createMesa(input: { name: string; displayName: string }): Promise<JoinResult> {
  const result = await api<JoinResult>("/api/mesa", { method: "POST", body: input });
  rememberMembership(result.session.joinCode, {
    sessionId: result.session.id,
    participantId: result.participant.id,
    displayName: result.participant.displayName,
    role: result.participant.role,
  });
  return result;
}

export async function joinMesa(input: { joinCode: string; displayName: string }): Promise<JoinResult> {
  const result = await api<JoinResult>("/api/mesa/join", { method: "POST", body: input });
  rememberMembership(result.session.joinCode, {
    sessionId: result.session.id,
    participantId: result.participant.id,
    displayName: result.participant.displayName,
    role: result.participant.role,
  });
  return result;
}

export async function fetchMesaState(sessionId: string): Promise<MesaState> {
  const result = await api<{ state: MesaState }>(`/api/mesa/${sessionId}`);
  return result.state;
}

export async function linkCharacter(
  sessionId: string,
  characterId: string | null,
  sheet?: unknown,
): Promise<void> {
  await api(`/api/mesa/${sessionId}/participant`, {
    method: "PATCH",
    body: { characterId, sheet },
  });
}

/**
 * Desconecta este navegador da mesa: sai no servidor (some da lista de
 * jogadores) e só então apaga a assinatura local.
 *
 * Se o servidor RECUSAR (4xx — ex.: Mestre tentando sair de sessão aberta),
 * nada muda aqui e o erro sobe para a UI. Se a rede cair, o importante é
 * soltar este navegador da mesa: segue a desconexão local.
 */
export async function leaveMesa(sessionId: string, joinCode: string): Promise<void> {
  try {
    await api(`/api/mesa/${sessionId}/participant`, { method: "DELETE" });
  } catch (caught) {
    if (caught instanceof MesaApiError && caught.status >= 400 && caught.status < 500) throw caught;
  }
  removeMembership(joinCode);
}

export async function startCombat(sessionId: string, enemies: unknown[]): Promise<void> {
  await api(`/api/mesa/${sessionId}/combat`, { method: "POST", body: { enemies } });
}

export async function endCombat(sessionId: string): Promise<void> {
  await api(`/api/mesa/${sessionId}/combat`, { method: "DELETE" });
}

export async function finishSession(sessionId: string): Promise<void> {
  await api(`/api/mesa/${sessionId}`, { method: "DELETE" });
}

export async function rollInitiative(sessionId: string): Promise<void> {
  await api(`/api/mesa/${sessionId}/combat/initiative`, { method: "POST", body: {} });
}

export async function performAction(
  sessionId: string,
  combatantId: string,
  actionType: string,
  meters?: number,
): Promise<void> {
  await api(`/api/mesa/${sessionId}/combat/action`, {
    method: "POST",
    body: { combatantId, actionType, meters },
  });
}

export async function endTurn(sessionId: string): Promise<void> {
  await api(`/api/mesa/${sessionId}/combat/turn`, { method: "POST", body: {} });
}

/**
 * Envia um dado rolado na ficha para a mesa registrar.
 * Quem decide se vira Action é o servidor — aqui só vai o resumo da rolagem.
 */
export async function sendMesaRoll(sessionId: string, roll: MesaRollSummary): Promise<void> {
  await api(`/api/mesa/${sessionId}/combat/roll`, { method: "POST", body: { roll } });
}

export async function addEnemies(sessionId: string, enemies: unknown[]): Promise<void> {
  await api(`/api/mesa/${sessionId}/combatants`, { method: "POST", body: { enemies } });
}

export async function updateCombatant(sessionId: string, combatantId: string, patch: unknown): Promise<void> {
  await api(`/api/mesa/${sessionId}/combatants`, {
    method: "PATCH",
    body: { combatantId, patch },
  });
}

export async function removeCombatant(sessionId: string, combatantId: string): Promise<void> {
  await api(`/api/mesa/${sessionId}/combatants?combatantId=${encodeURIComponent(combatantId)}`, {
    method: "DELETE",
  });
}

/**
 * Reenvia a ficha local para a mesa ativa, se houver.
 * Chamado quando a ficha muda no modo local, para o servidor não ficar defasado.
 * Fire-and-forget: falha aqui nunca quebra o modo local.
 */
export async function maybePushSheet(character: { id: string }): Promise<void> {
  const membership = getActiveMembership();
  if (!membership) return;
  try {
    await linkCharacter(membership.sessionId, character.id, character);
  } catch {
    // A mesa pode ter sido encerrada — o modo local continua intacto.
  }
}
