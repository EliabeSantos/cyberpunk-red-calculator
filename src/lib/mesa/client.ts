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
import type { MesaBattle, MesaParticipant, MesaSession, MesaState, PlayerDamageOutcome, PlayerHealingOutcome, PlayerInitiativeOutcome, TacticalMap, TacticalPosition } from "@/lib/mesa/types";
import type { AttackResult, DamageResult } from "@/lib/combat/contract";
import type { TacticalCoverResult } from "@/lib/mesa/tacticalGeometry";
import type { DiceResult } from "@/lib/dice";
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

/** Mensagem de UX para o erro específico do Attack Gateway; demais códigos preservam o texto atual. */
export function formatAttackGatewayError(message: string, code?: string): string {
  return code === "line_of_sight_blocked"
    ? "LINHA DE VISÃO BLOQUEADA — não é possível atacar este alvo."
    : message;
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

/** Encontro de `/gm/encounters` que originou o combate — vira o vínculo da partida. */
export interface MesaEncounterRef {
  id: string;
  name: string;
}

export interface StartCombatOptions {
  /** Sem encontro o combate é "avulso": entra no histórico sem bloquear nada. */
  encounter?: MesaEncounterRef;
  /**
   * Recomeça a MESMA partida ainda ativa nesta mesa (o encontro continua
   * sendo de uso único — o servidor só permite quando a dele é quem está
   * rodando).
   */
  restart?: boolean;
  /** Materializa o Mestre somente como controlador, sem seu personagem. */
  gmParticipation?: "character" | "gm_only";
}

export async function startCombat(
  sessionId: string,
  enemies: unknown[],
  options: StartCombatOptions = {},
): Promise<void> {
  await api(`/api/mesa/${sessionId}/combat`, {
    method: "POST",
    body: {
      enemies,
      encounter: options.encounter ?? null,
      restart: options.restart ?? false,
      gmParticipation: options.gmParticipation ?? "character",
    },
  });
}

export async function endCombat(sessionId: string): Promise<void> {
  await api(`/api/mesa/${sessionId}/combat`, { method: "DELETE" });
}

/**
 * Histórico de partidas da mesa (somente Mestre).
 * Sem a migração 20260927000001 o servidor responde `503 migration_pending`.
 */
export async function fetchMesaBattles(sessionId: string): Promise<MesaBattle[]> {
  const result = await api<{ battles: MesaBattle[] }>(`/api/mesa/${sessionId}/battles`);
  return Array.isArray(result.battles) ? result.battles : [];
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

/** F1.14.3 — só a intenção; o servidor aplica resolveAction/applyAction. */
export async function moveMesa(input: {
  sessionId: string;
  actorCombatantId: string;
  distance?: number;
  targetPosition?: TacticalPosition;
  resolutionId?: string;
}): Promise<{ combatantId: string; distance: number; movementRemaining: number; actionsRemaining: number; committed: boolean; position?: TacticalPosition }> {
  const { sessionId, ...intent } = input;
  return api(`/api/mesa/${sessionId}/combat/move`, {
    method: "POST",
    body: { ...intent, resolutionId: intent.resolutionId ?? crypto.randomUUID() },
  });
}

export async function saveTacticalMap(sessionId: string, map: TacticalMap): Promise<void> {
  await api(`/api/mesa/${sessionId}/tactical-map`, { method: "PATCH", body: { map } });
}

export async function positionCombatant(sessionId: string, combatantId: string, position: TacticalPosition): Promise<void> {
  await api(`/api/mesa/${sessionId}/combatants`, { method: "PATCH", body: { combatantId, patch: { position } } });
}

/** Metadados privados para a tela de controle do GM (não entram no snapshot Player). */
export interface MesaControlMetadata {
  combatantId: string;
  weapons: import("@/lib/combat/contract").CombatWeapon[];
}

export async function fetchMesaControlMetadata(sessionId: string): Promise<MesaControlMetadata[]> {
  const result = await api<{ combatants: MesaControlMetadata[] }>(`/api/mesa/${sessionId}/combat/control`);
  return Array.isArray(result.combatants) ? result.combatants : [];
}

/** Envia apenas intenção; o resultado é produzido pelo servidor/Combat Engine. */
export async function attackMesa(input: {
  sessionId: string;
  /** Identidade estável desta intenção; reutilize-a ao repetir a requisição. */
  resolutionId?: string;
  actorId: string;
  targetId: string;
  weaponId?: string;
  skillId?: string;
  attackType?: string;
  attackMode?: string;
  aimedTarget?: string;
  targetType?: "combatant" | "cover";
  obstacleId?: string;
}): Promise<{
  attackResult: AttackResult;
  tacticalCover?: TacticalCoverResult;
  coverDamage?: { obstacleId: string; hpBefore: number; hpAfter: number; damage: number; destroyed: boolean };
  weaponDamage?: DiceResult;
  damageResult?: DamageResult;
  damageError?: { code: string; message: string };
  ammoAfter?: number;
  actionAfter?: number;
}> {
  return api(`/api/mesa/${input.sessionId}/combat/attack`, {
    method: "POST",
    body: {
      resolutionId: input.resolutionId ?? crypto.randomUUID(),
      actorId: input.actorId,
      targetId: input.targetId,
      weaponId: input.weaponId,
      skillId: input.skillId,
      attackType: input.attackType,
      attackMode: input.attackMode,
      aimedTarget: input.aimedTarget,
      targetType: input.targetType,
      obstacleId: input.obstacleId,
    },
  });
}

/** Solicita reload; ammo, reserva e Actions nunca vêm do navegador. */
export async function reloadMesa(input: {
  sessionId: string;
  resolutionId?: string;
  weaponId: string;
  /** Necessário somente quando o GM controla um inimigo. */
  actorCombatantId?: string;
}): Promise<{
  weaponId: string;
  ammoBefore: number;
  ammoAfter: number;
  actionsBefore: number;
  actionsAfter: number;
  consumed: number;
}> {
  return api(`/api/mesa/${input.sessionId}/combat/reload`, {
    method: "POST",
    body: {
      resolutionId: input.resolutionId ?? crypto.randomUUID(),
      weaponId: input.weaponId,
      ...(input.actorCombatantId ? { actorCombatantId: input.actorCombatantId } : {}),
    },
  });
}

export async function consumeMesaItem(input: {
  sessionId: string;
  resolutionId?: string;
  actorCombatantId: string;
  itemId: string;
  amount: number;
}): Promise<{
  combatantId: string;
  itemId: string;
  itemName: string;
  quantityBefore: number;
  quantityAfter: number;
  consumed: number;
  actionsBefore: number;
  actionsAfter: number;
}> {
  return api(`/api/mesa/${input.sessionId}/combat/item-consume`, {
    method: "POST",
    body: {
      resolutionId: input.resolutionId ?? crypto.randomUUID(),
      actorCombatantId: input.actorCombatantId,
      itemId: input.itemId,
      amount: input.amount,
    },
  });
}

/**
 * F1.13.2 — usa um item de cura na Mesa (server-authoritative, atômico).
 *
 * Só manda intenção: `itemId` (id estável) do combatente do próprio jogador.
 * Cura, HP final, quantidade restante e Action debitada são resolvidos pelo
 * servidor numa única transação.
 */
/**
 * F1.13.2 — resultado da resolução atômica do item de cura.
 *
 * É a única "confirmação" que a ficha recebe: ela NÃO aplica nada por conta
 * própria, só mostra o que o servidor registrou.
 */
export interface MesaItemHealResult {
  combatantId: string;
  itemId: string;
  itemName: string;
  quantityBefore: number;
  quantityAfter: number;
  hpBefore: number;
  hpAfter: number;
  hpMax: number;
  restored: number;
  actionsBefore: number;
  actionsAfter: number;
  committed: boolean;
}

/**
 * F1.13.2/F1.13.4 — **intenção** de usar um item de cura (nunca dano, nunca
 * HP final, nunca quantidade): o servidor valida, consome, cura e registra em
 * uma única transação.
 */
export async function applyMesaHealingItem(input: {
  sessionId: string;
  resolutionId?: string;
  actorCombatantId: string;
  itemId: string;
}): Promise<MesaItemHealResult> {
  return api(`/api/mesa/${input.sessionId}/combat/item-heal`, {
    method: "POST",
    body: {
      resolutionId: input.resolutionId ?? crypto.randomUUID(),
      actorCombatantId: input.actorCombatantId,
      itemId: input.itemId,
    },
  });
}

export async function endTurn(sessionId: string): Promise<void> {
  await api(`/api/mesa/${sessionId}/combat/turn`, { method: "POST", body: {} });
}

export interface MesaDeathSaveResult {
  combatantId: string;
  diceRoll: number;
  dc: number;
  success: boolean;
  failuresAfter: number;
  characterDied: boolean;
  deathSaveDC: number;
  committed: boolean;
}

/** F1.15 — envia somente a intenção; rolagem e morte são do servidor. */
export async function rollMesaDeathSave(input: {
  sessionId: string;
  actorCombatantId: string;
  resolutionId?: string;
}): Promise<MesaDeathSaveResult> {
  return api(`/api/mesa/${input.sessionId}/combat/death-save`, {
    method: "POST",
    body: {
      resolutionId: input.resolutionId ?? crypto.randomUUID(),
      actorCombatantId: input.actorCombatantId,
    },
  });
}

/**
 * Envia um dado rolado na ficha para a mesa registrar.
 * Quem decide se vira Action é o servidor — aqui só vai o resumo da rolagem.
 *
 * `key` é a chave do participante do encontro (só o Mestre manda): é ela que
 * diz ao servidor QUAL inimigo da mesa paga a ação. Sem chave o servidor trata
 * a rolagem como relatório — nenhum combatente é debitado.
 */
export async function sendMesaRoll(
  sessionId: string,
  roll: MesaRollSummary,
  key?: string | null,
  resolutionId = crypto.randomUUID(),
): Promise<void> {
  await api(`/api/mesa/${sessionId}/combat/roll`, {
    method: "POST",
    body: { roll, key: key || undefined, resolutionId },
  });
}

/** Atualização de vida da origem; durante combate ativo, Player não pode espelhar HP. */
export interface MesaHpUpdate {
  hp: number;
  /** HP máximo — só a ficha envia; o servidor ajusta a coluna junto. */
  hpMax?: number;
  /** Só a ficha envia: morte vem do `combat.isDead` dela. */
  isDead?: boolean;
  /** Chave do inimigo no encontro (só o Mestre; usa `source_key`). */
  key?: string;
  /**
   * HP que a ORIGEM acreditava ver ANTES desta mudança (F1.7.1, Decisão 2).
   * Quando presente, o servidor só grava `hp_current`/`is_dead` se a linha da
   * mesa ainda estiver nesse valor — guarda contra sobrescrever, com atraso,
   * um resultado mais novo do Combat Engine. Ausente = caminho legado.
   */
  hpBefore?: number;
  /**
   * Mochila do INIMIGO (pente + reserva), enviada junto porque o dono dela é a
   * tela de Encontros: tiro, recarregamento e cura acontecem lá e a linha da
   * mesa precisa mostrar o estado novo. Só o Mestre envia.
   */
  supplies?: {
    ammo?: number;
    magazine?: number;
    inventory?: Array<{ item: string; quantity: number }>;
  };
}

/**
 * Espelha a vida nova de um combatente na mesa.
 * Fire-and-forget como o resto do espelho: falha aqui nunca quebra a origem.
 */
export async function sendMesaHp(sessionId: string, update: MesaHpUpdate): Promise<void> {
  await api(`/api/mesa/${sessionId}/combat/hp`, { method: "POST", body: update });
}

/**
 * F1.7.1 — dano de inimigo RESOLVIDO PELO COMBAT ENGINE no servidor
 * (`POST /combat/damage`, caminho B). Todo o resultado (hp_after, is_dead) é
 * calculado lá com `serverRandom`; aqui só vão as entradas da origem.
 *
 * Ao contrário do espelho, esta chamada LANÇA em recusa (`409 stale_hp`/
 * `hp_conflict`, `400`, rede, migração) — o chamador decide o fallback.
 * `200 {updated:false}` (sem combate ativo/linha) é sucesso silencioso.
 */
export async function sendMesaEngineDamage(
  sessionId: string,
  update: MesaEngineDamageUpdate,
): Promise<MesaEngineDamageResult> {
  return api<MesaEngineDamageResult>(`/api/mesa/${sessionId}/combat/damage`, { method: "POST", body: update });
}

/** Intenção de dano de INIMIGO para o motor resolver no servidor (F1.7.1). */
export interface MesaEngineDamageUpdate {
  /** `source_key` do inimigo no encontro. */
  key: string;
  /** Dano bruto já rolado pelo GM (o motor NÃO rola dano). */
  amount: number;
  /** HP da origem ANTES deste dano — precondição/CAS/idempotência no servidor. */
  hpBefore: number;
  hitLocation?: "head" | "body";
  /** Atalho legado do encontro (`ignore ? "ignore" : "full"`). */
  ignoreArmor?: boolean;
  /** Veste `{head, body}` do inimigo no encontro — a mesa não persiste armor. */
  armor: { head: number; body: number };
  /** SP de cyberware do corpo (implantes do encontro). */
  bodySP?: number;
}

/** Resposta da resolução no servidor (hp/isDead `null` quando `updated:false`). */
export interface MesaEngineDamageResult {
  updated: boolean;
  hp: number | null;
  isDead: boolean | null;
}

/**
 * F1.12.1 — intenção de dano EXTERNO sobre um PERSONAGEM (Player Damage
 * Gateway). Só isto sai do navegador: HP/Armor/lesão/morte são calculados e
 * persistidos no servidor. `finalHp`/`finalArmor`/`isDead` são RECUSADOS lá
 * (400 `client_authority_forbidden`) — não tente enviá-los.
 */
export interface PlayerDamageIntent {
  /** Linha de `mesa_combatants` do alvo (kind = "character"). */
  targetCombatantId: string;
  /** HP que ESTE cliente viu antes do dano — pré-condição/CAS no servidor. */
  hpBefore: number;
  /** Dano bruto a resolver no Damage Engine (a armadura decide o resto). */
  amount: number;
  /** Local de impacto (padrão: corpo). */
  hitLocation?: "head" | "body" | "leg" | "held_item";
  /** Dados individuais da rolagem — habilita o gatilho de Critical Injury. */
  damageRolls?: number[];
  /** Variante legada `ignore` de armadura (mesmo caminho do ataque). */
  ignoreArmor?: boolean;
  /** Classe da fonte: "explosion" | "fall" | "chooh2" | "trap" | ... */
  sourceType?: string;
  /** Contexto curto de cena — vira texto do evento do combate. */
  sourceContext?: string;
  /**
   * Identidade desta intenção. Reutilize a MESMA ao repetir a chamada: o
   * servidor devolve o resultado já gravado sem aplicar dano de novo.
   */
  resolutionId?: string;
}

/**
 * Player Damage Gateway — `POST /api/mesa/[id]/combat/player-damage`.
 *
 * LANÇA em recusa (409 `stale_hp`/`hp_conflict`, 400, rede): o chamador decide
 * o fallback. `200 {updated:false}` (sem combate ativo/alvo) é sucesso
 * silencioso, igual ao caminho do inimigo.
 */
export async function applyPlayerDamage(
  sessionId: string,
  intent: PlayerDamageIntent,
): Promise<PlayerDamageOutcome> {
  return api(`/api/mesa/${sessionId}/combat/player-damage`, {
    method: "POST",
    body: { ...intent, resolutionId: intent.resolutionId ?? crypto.randomUUID() },
  });
}

/**
 * F1.12.2 — intenção de CURA sobre um PERSONAGEM (Player Healing Gateway).
 * Só isto sai do navegador: o servidor lê o HP atual da Mesa e aplica
 * `min(hpAtual + amount, hpMax)`. `hpAfter`/`finalHp` são RECUSADOS lá
 * (400 `client_authority_forbidden`) — não tente enviá-los.
 */
export interface PlayerHealingIntent {
  /** Linha de `mesa_combatants` do alvo (kind = "character"). */
  targetCombatantId: string;
  /** Inteiro > 0. O servidor decide quanto disso entra na conta. */
  amount: number;
  /** Classe da fonte (rótulo, vira texto de evento): "gm_adjust" | ... */
  sourceType?: string;
  /** Contexto curto de cena — vira texto do evento do combate. */
  sourceContext?: string;
  /**
   * Identidade desta intenção. Reutilize a MESMA ao repetir a chamada: o
   * servidor devolve o resultado já gravado sem curar de novo.
   */
  resolutionId?: string;
}

/**
 * Player Healing Gateway — `POST /api/mesa/[id]/combat/player-heal`.
 *
 * LANÇA em recusa (410 sessão encerrada, 409 combate inativo, 400/404, rede):
 * o chamador decide o fallback. `200 {updated:false}` é o alvo já estar no
 * máximo — sucesso, sem efeito.
 */
export async function applyPlayerHealing(
  sessionId: string,
  intent: PlayerHealingIntent,
): Promise<PlayerHealingOutcome> {
  return api(`/api/mesa/${sessionId}/combat/player-heal`, {
    method: "POST",
    body: { ...intent, resolutionId: intent.resolutionId ?? crypto.randomUUID() },
  });
}

/**
 * F1.14.2 — intenção de INICIATIVA do PRÓPRIO personagem (Player Initiative
 * Gateway). Só isto sai do navegador: a rolagem roda no RNG da ficha e o
 * servidor grava o total em `mesa_combatants.initiative`.
 *
 * `initiativeOrder`, `activeCombatant`, `turn`, `actionsRemaining` e demais
 * campos derivados são RECUSADOS lá (400 `client_authority_forbidden`) —
 * ordem e turno continuam sendo da rolagem coletiva do Mestre.
 */
export interface PlayerInitiativeIntent {
  /** Linha de `mesa_combatants` do PRÓPRIO combatante (kind = "character"). */
  actorCombatantId: string;
  /** Total inteiro rolado pela ficha: 1d10 + REF + mods (limites do projeto). */
  initiative: number;
  /**
   * Identidade desta intenção. Reutilize a MESMA ao repetir a chamada: o
   * servidor devolve o resultado já gravado sem gravar de novo.
   */
  resolutionId?: string;
}

export type MesaInitiativeResult = PlayerInitiativeOutcome & { committed: boolean };

/**
 * Player Initiative Gateway — `POST /api/mesa/[id]/combat/initiative`.
 *
 * LANÇA em recusa (410 sessão encerrada, 409 combate/rolagem/conflito, 400/403,
 * rede): o chamador decide o fallback. Em sucesso o valor exibido na ficha não
 * é o deste retorno — é o que chega depois pelo estado da Mesa.
 */
export async function registerMesaInitiative(input: {
  sessionId: string;
  actorCombatantId: string;
  initiative: number;
  resolutionId?: string;
}): Promise<MesaInitiativeResult> {
  const { sessionId, ...intent } = input;
  return api(`/api/mesa/${sessionId}/combat/initiative`, {
    method: "POST",
    body: { ...intent, resolutionId: intent.resolutionId ?? crypto.randomUUID() },
  });
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
