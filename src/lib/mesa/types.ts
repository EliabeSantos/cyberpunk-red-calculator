/**
 * Tipos da Mesa/Sessão online — compartilhados entre rotas API e componentes.
 *
 * Hierarquia: USUÁRIO → SESSÃO → PARTICIPANTES → PERSONAGENS → ESTADO DE COMBATE.
 */
import type { DamageResult } from "@/lib/combat/contract";
import type { CriticalInjury } from "@/data/criticalInjuries";

export type SessionStatus = "lobby" | "active" | "finished";
export type ParticipantRole = "gm" | "player";
export type CombatStatus = "active" | "finished";
export type CombatantKind = "character" | "enemy" | "net_ice";

export interface TacticalPosition {
  x: number;
  y: number;
}

/** F1.51 — tipos de conexão disponíveis para um Access Point. */
export type NetrunnerConnectionType = "wireless" | "cable";

/** Access Point persistido junto do Tactical Map; Architecture fica para fase posterior. */
export interface TacticalAccessPoint {
  id: string;
  position: TacticalPosition;
  connectionTypes: NetrunnerConnectionType[];
  architectureId: string | null;
  wirelessRangeMeters: 6;
  active: boolean;
}

/** F1.53 — estrutura declarativa da NET, sem regras de exploração/combat. */
export type NetNodeType = "lobby" | "password" | "file" | "control_node" | "black_ice" | "demon";

export type BlackIceType = "anti_program" | "anti_personnel";
export type NetProgramState = "active" | "destroyed";

export interface NetProgram {
  id: string;
  name: string;
  attackBonus: number;
  rezz: number;
  maxRezz: number;
  damage: number;
  state: NetProgramState;
}

export interface NetBlackIce {
  id: string;
  nodeId: string;
  architectureId: string;
  floorIndex: number;
  name: string;
  type: BlackIceType;
  speed: number;
  per: number;
  def: number;
  rezz: number;
  maxRezz: number;
  attack: number;
  damage?: number;
  state: "inactive" | "active" | "destroyed";
  initiative?: number;
  engagedNetrunnerId?: string;
  brainDamage?: number;
}

export interface NetDemon {
  id: string;
  nodeId: string;
  architectureId: string;
  name: string;
  state: "active" | "inactive";
  controlledNodeIds: string[];
}

export interface NetPasswordNode {
  id: string;
  type: "password";
  floorIndex: number;
  name?: string;
  description?: string;
  dv?: number;
  state: "locked" | "unlocked";
}

export interface NetFileNode {
  id: string;
  type: "file";
  floorIndex: number;
  name?: string;
  description?: string;
  content?: string;
  reference?: string;
}

export interface NetControlNode {
  id: string;
  type: "control_node";
  floorIndex: number;
  name?: string;
  description?: string;
  deviceReference?: string;
  dv?: number;
  controlState?: "uncontrolled" | "controlled";
  controlledByNetrunnerId?: string;
  controlledByDemonId?: string;
}

export interface NetBasicNode {
  id: string;
  type: "lobby" | "black_ice" | "demon";
  floorIndex: number;
  name?: string;
  description?: string;
  blackIce?: Omit<NetBlackIce, "id" | "nodeId" | "architectureId" | "floorIndex" | "state"> & { id?: string };
  blackIceState?: NetBlackIce["state"];
  blackIceInitiative?: number;
  engagedNetrunnerId?: string;
  demon?: Omit<NetDemon, "id" | "nodeId" | "architectureId" | "controlledNodeIds"> & { id?: string; controlledNodeIds?: string[] };
  demonState?: NetDemon["state"];
}

export type NetNode = NetPasswordNode | NetFileNode | NetControlNode | NetBasicNode;

export interface NetFloor {
  id: string;
  index: number;
  nodes: NetNode[];
}

export interface NetArchitecture {
  id: string;
  name: string;
  description?: string;
  floors: NetFloor[];
  pathfinder?: {
    dv: number;
    discoveryDepth: number;
  };
}

/** Descoberta individual persistida na linha do Netrunner, nunca global na arquitetura. */
export interface NetDiscoveryState {
  architectureId: string;
  discoveredNodeIds: string[];
  /** Optional for legacy F1.53 rows; F1.54 keeps Pathfinder discovery unread. */
  revealedFileIds?: string[];
}

/** Projeção já filtrada pelo servidor para o Player ou completa para o GM. */
export interface NetArchitectureProjection {
  architectureId: string;
  name: string;
  description?: string;
  currentFloor: number;
  nodes: NetNode[];
  administrative?: boolean;
  floors?: NetFloor[];
}

/** Estado mutável de conexão do Netrunner, separado da futura NET Architecture. */
export interface NetrunnerConnectionState {
  isJackedIn: boolean;
  connectedAccessPointId: string | null;
  connectionType: NetrunnerConnectionType | null;
  architectureId: string | null;
  /** Floor 1 is the conceptual entry point; full Floors come in a later phase. */
  currentFloor: number | null;
  unsafeJackOut: boolean;
  /** Reservado para a fase de Black ICE; vazio enquanto ela não existe. */
  engagedBlackIceIds?: string[];
  interfaceRank: number;
  ramCurrent: number;
  ramMax: number;
  netActionsRemaining: number;
  netActionsMax: number;
  meatspaceActionUsedForNetrunning: boolean;
  cyberdeckSlots: number;
  maxQuickhackSlots: 4;
  equippedQuickhackIds: string[];
  programs?: NetProgram[];
  brainDamage?: number;
  /** Minimal authoritative equipment condition; no Cyberdeck HP is modeled. */
  cyberdeckStatus?: "functional" | "destroyed";
}

export interface MesaQuickhackEffect {
  id: string;
  quickhackId: string;
  sourceCombatantId: string;
  appliedRound: number;
  expiresRound: number | null;
  moveModifier?: number;
  conditionIds?: string[];
  disabledCyberwareIds?: string[];
  controlsMove?: boolean;
  controlsAction?: boolean;
  unconscious?: boolean;
  prone?: boolean;
  damageAtEndOfTurn?: number;
  lastDamageRound?: number;
}

export type VisibilityState = "visible" | "hidden";
export type StealthState = "not_stealthed" | "stealthed";
export type DetectionState = "hidden" | "detected";

export type TacticalPoint = TacticalPosition;

import type { TacticalCoverThickness } from "@/lib/mesa/tacticalCoverCatalog";
import { TACTICAL_COVER_MATERIALS as OFFICIAL_TACTICAL_COVER_MATERIALS } from "@/lib/mesa/tacticalCoverCatalog";
import type { HackableDeviceState, HackableObjectType } from "@/lib/mesa/hackableObjects";

export const TACTICAL_COVER_MATERIALS = OFFICIAL_TACTICAL_COVER_MATERIALS;
export const TACTICAL_LEGACY_COVER_MATERIALS = ["brick", "custom"] as const;
export type TacticalCoverMaterial = (typeof TACTICAL_COVER_MATERIALS)[number] | (typeof TACTICAL_LEGACY_COVER_MATERIALS)[number];
export type { TacticalCoverThickness } from "@/lib/mesa/tacticalCoverCatalog";

export interface TacticalWall {
  id: string;
  type: "wall";
  start: TacticalPoint;
  end: TacticalPoint;
  /** Espessura normalizada em relação ao mapa. */
  /** Normalized thickness; omitted only in legacy maps and normalized on load. */
  thickness?: number;
  /** Optional future RED material semantics; no default is inferred. */
  coverMaterial?: TacticalCoverMaterial | null;
  /** Null/omitted means a legacy obstacle awaiting migration. */
  coverThickness?: TacticalCoverThickness | null;
  /** Current HP. Maximum/base HP is derived from the catalog profile. */
  coverHP?: number | null;
  /** Derived VTT DV; legacy only when no profile exists. */
  coverDV?: number | null;
  destroyed?: boolean;
}

export interface TacticalDoor {
  id: string;
  type: "door";
  start: TacticalPoint;
  end: TacticalPoint;
  /** Espessura normalizada em relação ao mapa. */
  /** Normalized thickness; omitted only in legacy maps and normalized on load. */
  thickness?: number;
  /** Optional future RED material semantics; no default is inferred. */
  coverMaterial?: TacticalCoverMaterial | null;
  coverThickness?: TacticalCoverThickness | null;
  coverHP?: number | null;
  coverDV?: number | null;
  destroyed?: boolean;
  state: "open" | "closed";
}

export interface TacticalGeometry {
  walls: TacticalWall[];
  doors: TacticalDoor[];
}

export type TacticalHackableObjectType = HackableObjectType;

/** Estado autoritativo de câmera (F1.63); `online` é o implícito. */
export type TacticalHackableDeviceState = HackableDeviceState;

/**
 * Representação física/visual do Hackable Object no Tactical Map (F1.62/F1.63).
 *
 * O objeto NÃO guarda estado lógico do Control Node: `controlNodeId` aponta
 * para a autoridade (Control Node da Architecture). Quando o tipo é `door`,
 * `geometryDoorId` aponta para a única porta física em
 * `TacticalGeometry.doors`, dona do estado `open`/`closed`. Quando o tipo é
 * `camera`, `deviceState` é a ÚNICA cópia do estado `online`/`disabled` (a
 * câmera não é geometria e não vira parede, porta, colisão, movimento,
 * cobertura, distância ou alcance). `name` e `controlNodeId` têm alias
 * legados (`label`, `linkedControlNodeId`) aceitos somente na leitura do mapa
 * persistido.
 */
export interface TacticalHackableObject {
  /** Identidade estável; nunca derivada do tipo, do nome ou da posição. */
  id: string;
  type: TacticalHackableObjectType;
  name?: string;
  position: TacticalPoint;
  /** Autoridade lógica; ausente quando o objeto ainda não foi vinculado. */
  controlNodeId?: string;
  /** Referência à porta física existente; somente para `type === "door"`. */
  geometryDoorId?: string;
  /** Estado do dispositivo; somente para `type === "camera"`. */
  deviceState?: TacticalHackableDeviceState;
  interactionRadius?: number;
  active: boolean;
}

export interface TacticalMap {
  imageUrl: string;
  enabled: boolean;
  /** Dimensões lógicas da imagem, independentes do tamanho renderizado. */
  width: number;
  height: number;
  pixelsPerMeter: number;
  grid?: TacticalGridConfig;
  geometry?: TacticalGeometry;
  accessPoints?: TacticalAccessPoint[];
  hackableObjects?: TacticalHackableObject[];
}

export interface TacticalGridConfig {
  enabled: boolean;
  /** Tamanho da célula em metros lógicos. */
  size: number;
  snap: boolean;
}

export interface MesaSession {
  id: string;
  name: string;
  gmId: string | null;
  status: SessionStatus;
  joinCode: string;
  createdAt: string;
  tacticalMap?: TacticalMap;
}

export interface MesaParticipant {
  id: string;
  sessionId: string;
  displayName: string;
  /** Referência à ficha — a ficha em si continua existindo fora da mesa. */
  characterId: string | null;
  role: ParticipantRole;
  connectedAt: string;
}

/**
 * Suprimentos de combate espelhados na mesa (`mesa_combatants.supplies`).
 *
 * Para inimigos, a tela de Encontros continua sendo a dona da mochila. Para
 * personagens, o conteúdo é materializado ao iniciar o combate e a Mesa passa
 * a ser a autoridade durante aquela batalha.
 */
export interface MesaSupplies {
  /** Arma cujo pente está representado por ammo/magazine. */
  weaponId?: string;
  /** Balas no pente agora; ausente quando a arma não tem pente. */
  ammo?: number;
  /** Capacidade do pente. */
  magazine?: number;
  /** Reserva na mochila: munição para recarregar e itens de cura. */
  inventory?: Array<{ item: string; quantity: number; itemId?: string; category?: "chipware" }>;
}

export interface MesaCombatant {
  id: string;
  combatId: string;
  sessionId: string;
  kind: CombatantKind;
  characterId: string | null;
  participantId: string | null;
  name: string;
  /**
   * Chave do participante do encontro que originou este INIMIGO
   * (`mesa_combatants.source_key`). É por aqui que o HP aplicado na tela de
   * Encontros chega à linha certa; `null` em personagens e em inimigos
   * criados sem chave.
   */
  sourceKey: string | null;
  /** `null` em personagens e em inimigos sem mochila (`mesa_combatants.supplies`). */
  supplies: MesaSupplies | null;
  /** Estado mutável de armadura durante o combate. */
  armor: { head: number; body: number } | null;
  /** Critical Injuries persistidas pelo Combat Engine. */
  criticalInjuries: import("@/types/character").CriticalInjury[];
  /** Munição atual por `weaponId`, mantida pelo servidor. */
  ammoByWeapon?: Record<string, number> | null;
  initiative: number | null;
  /**
   * Como a iniciativa foi calculada. `bonus` é o bônus de implantes do inimigo
   * (`1d10 + refBonus + bonus`) — presente só quando ≠ 0.
   */
  initiativeDetail: { expression?: string; refBonus?: number; total?: number; bonus?: number; speed?: number } | null;
  actionsMax: number;
  actionsRemaining: number;
  movementMax: number;
  movementRemaining: number;
  /** Rodada até a qual uma Critical Injury mantém o combatente inconsciente. */
  unconsciousUntilRound?: number;
  hpCurrent: number;
  hpMax: number;
  isDead: boolean;
  /** Estado de Death Save projetado da ficha; inimigos permanecem em zero. */
  deathSaveDC?: number;
  deathSaveFailures?: number;
  conditions: string[];
  sortOrder: number;
  position?: TacticalPosition;
  /** Estado autoritativo; nunca é aceito do snapshot do cliente. */
  stealthState?: StealthState;
  /** IDs dos observadores que já detectaram este combatente. */
  detectedBy?: string[];
  /** Estado de conexão server-side; a projeção Player omite o de terceiros. */
  netrunnerState?: NetrunnerConnectionState;
  quickhackEffects?: MesaQuickhackEffect[];
  netDiscovery?: NetDiscoveryState;
  netIce?: NetBlackIce;
  brainDamage?: number;
  /** Foto pública do personagem; nunca inclui dados privados da ficha. */
  avatarUrl?: string;
}

export interface MesaEvent {
  at: string;
  /** Chave de resolução carimbada pelo servidor quando o evento é retryable. */
  resolutionId?: string;
  /** Eventos de NET Action privados ao Netrunner; GM sempre os recebe. */
  privateToParticipantId?: string;
  /**
   * `roll` = dado rolado na ficha de um participante (entra também na lista de
   * rolagens visível no painel, sem precisar abrir o registro completo).
   */
  kind:
    | "combat_started"
    | "combat_finished"
    | "initiative"
    | "action"
    | "turn"
    | "round"
    | "enemy"
    | "join"
    | "roll";
  text: string;
  /** Dados imutáveis da rolagem, quando `kind === "roll"`. Eventos antigos
   * continuam válidos sem este campo e exibem apenas o texto resumido. */
  roll?: {
    type: string;
    label: string;
    expression: string;
    total: number;
    rolls: number[];
  };
}

export interface MesaCombat {
  id: string;
  sessionId: string;
  status: CombatStatus;
  round: number;
  activeCombatantId: string | null;
  turnStartedAt: string | null;
  initiativeStarted: boolean;
  eventLog: MesaEvent[];
  createdAt: string;
}

export type BattleStatus = "active" | "completed";

/**
 * Linha do HISTÓRICO de uma partida (`mesa_battles.combatants`).
 *
 * Nasce no início do combate com a vida de ENTRADA e é enriquecida quando a
 * partida é fechada com a vida FINAL — por isso `hpEnd` é `null` enquanto a
 * luta roda.
 */
export interface MesaBattleCombatant {
  id: string;
  kind: CombatantKind;
  name: string;
  hpStart: number;
  hpMax: number;
  /** `null` enquanto o combate está ativo ou quando saiu antes do fim. */
  hpEnd: number | null;
  isDead: boolean;
  /** Saiu da luta (removido pelo Mestre) antes de a partida ser fechada. */
  removed: boolean;
  initiative: number | null;
  sourceKey: string | null;
  /** Posição inicial e final no mapa, quando o combate usou mapa tático. */
  position?: TacticalPosition | null;
  positionEnd?: TacticalPosition | null;
}

/**
 * Uma partida já registrada — é o que sustenta o "histórico de partidas" da
 * tela de Encontros e o bloqueio de encontro repetido (`encounterId`).
 */
export interface MesaBattle {
  id: string;
  sessionId: string;
  joinCode: string;
  /** `null` quando o combate foi lançado sem encontro (avulso). */
  encounterId: string | null;
  encounterName: string;
  status: BattleStatus;
  startedAt: string;
  endedAt: string | null;
  finalRound: number | null;
  combatants: MesaBattleCombatant[];
  eventLog?: MesaEvent[];
  tacticalMap?: TacticalMap | null;
}

/** Estado completo devolvido ao cliente pelo GET autenticado. */
export interface MesaState {
  /** Maior `updated_at` conhecido da sessão/combate, usado só para convergência. */
  stateVersion?: string;
  session: MesaSession;
  participants: MesaParticipant[];
  combat: MesaCombat | null;
  combatants: MesaCombatant[];
  netArchitecture?: NetArchitectureProjection | null;
  netArchitectures?: NetArchitecture[];
  /** Quem está perguntando — identificado pelo playerToken enviado na requisição. */
  viewer: {
    participantId: string | null;
    role: ParticipantRole | null;
    displayName: string | null;
  };
}

export function isSessionStatus(value: unknown): value is SessionStatus {
  return value === "lobby" || value === "active" || value === "finished";
}

/**
 * F1.12.1 — resultado do **Player Damage Gateway** (`POST /combat/player-damage`).
 *
 * É também o payload que fica gravado em `mesa_attack_resolutions.result`, o
 * que permite devolver o MESMO resultado em um retry sem aplicar dano de novo.
 * `updated: false` (sem combate ativo / alvo inexistente) devolve os campos
 * como `null`.
 */
export interface PlayerDamageOutcome {
  updated: boolean;
  hp: number | null;
  isDead: boolean | null;
  armor: { head: number; body: number } | null;
  criticalInjuries: CriticalInjury[] | null;
  damageResult: DamageResult | null;
}

/**
 * F1.12.2 — resultado do **Player Healing Gateway** (`POST /combat/player-heal`).
 *
 * Assim como o dano, este payload é o que fica gravado em
 * `mesa_attack_resolutions.result`, permitindo devolver o MESMO resultado num
 * retry sem curar duas vezes.
 *
 * `hp`/`hpMax`/`amountApplied` são SEMPRE valores lidos/calculados no servidor
 * (`min(hpAtual + amount, hpMax)`). `updated: false` = o alvo já estava no
 * máximo e nada mudou (portanto `amountApplied: 0` e nenhum evento).
 *
 * `isDead` é DEVOLVIDO, nunca alterado: cura não toca Death Save nesta etapa.
 */
export interface PlayerHealingOutcome {
  updated: boolean;
  hp: number;
  hpMax: number;
  amountApplied: number;
  isDead: boolean;
}

/** F1.15 — resultado da resolução server-side de Death Save. */
export interface PlayerDeathSaveOutcome {
  combatantId: string;
  diceRoll: number;
  dc: number;
  success: boolean;
  failuresAfter: number;
  characterDied: boolean;
  deathSaveDC: number;
  committed: boolean;
}

/**
 * F1.14.2 — resultado do **Player Initiative Gateway**
 * (`POST /combat/initiative` com corpo de intenção).
 *
 * `initiative` é o valor GRAVADO no combatant do próprio participante (lido de
 * volta do servidor, nunca do navegador). `initiativeDetail` (total/bônus de REF)
 * também é calculado no servidor — o cliente não manda autoridade de display.
 *
 * `committed:false` = este `resolutionId` já tinha sido processado antes (retry):
 * nada foi regravado.
 */
export interface PlayerInitiativeOutcome {
  kind: "initiative";
  resolutionId: string;
  combatantId: string;
  initiative: number;
  initiativeDetail: MesaCombatant["initiativeDetail"];
  /** Sempre `true` num resultado persistido — o replay devolve o mesmo objeto. */
  registered: true;
}
