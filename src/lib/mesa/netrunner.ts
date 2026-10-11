import type { NetrunnerConnectionType, NetrunnerConnectionState, MesaQuickhackEffect, TacticalAccessPoint, TacticalMap, TacticalPosition } from "@/lib/mesa/types";
import { tacticalDistance } from "@/lib/mesa/tacticalMap";
import { quickhackDefinitions } from "@/data/quickhacks";
import type { RandomSource } from "@/lib/combat/contract";
import { getNetActionsPerTurn } from "@/lib/roles";

export const WIRELESS_ACCESS_POINT_RANGE_METERS = 6 as const;

export function getRamMax(interfaceRank: number): number {
  return interfaceRank >= 10 ? 14 : interfaceRank >= 7 ? 12 : interfaceRank >= 4 ? 10 : 8;
}

export function getCyberdeckSlots(interfaceRank: number): number {
  return interfaceRank >= 10 ? 9 : interfaceRank >= 7 ? 8 : interfaceRank >= 4 ? 7 : 6;
}

export function getQuickhackRamCost(quickhackId: string): number {
  return quickhackDefinitions[quickhackId]?.ramCost ?? 0;
}

export function getQuickhackDV(quickhackId: string): number {
  return quickhackDefinitions[quickhackId]?.dv ?? 0;
}

export type QuickhackEffectResolution = {
  effect: Omit<MesaQuickhackEffect, "id">;
  damage?: { amount: number; ignoreArmor: true };
};

export function resolveQuickhackEffect(input: {
  quickhackId: string;
  sourceCombatantId: string;
  currentRound: number;
  rng: RandomSource;
}): QuickhackEffectResolution {
  const base = { quickhackId: input.quickhackId, sourceCombatantId: input.sourceCombatantId, appliedRound: input.currentRound, expiresRound: null as number | null };
  switch (input.quickhackId) {
    case "impair_movement": return { effect: { ...base, expiresRound: input.currentRound + 1, conditionIds: ["IMPAIRED_MOVEMENT"], moveModifier: -1 } };
    case "sonic_shock": return { effect: { ...base, expiresRound: input.currentRound, conditionIds: ["DAMAGED_EAR"] } };
    case "overheat": return { effect: { ...base, expiresRound: input.currentRound + 1, conditionIds: ["OVERHEAT"], damageAtEndOfTurn: 4, lastDamageRound: -1 } };
    case "short_circuit": return { effect: { ...base, expiresRound: input.currentRound + 1, conditionIds: ["SHORT_CIRCUIT"] } };
    case "cyberware_malfunction": return { effect: { ...base, expiresRound: input.currentRound, conditionIds: ["CYBERWARE_MALFUNCTION"] } };
    case "lure": return { effect: { ...base, expiresRound: input.currentRound + 1, conditionIds: ["LURED"], controlsMove: true } };
    case "slow": return { effect: { ...base, expiresRound: input.currentRound, conditionIds: ["SLOWED"], moveModifier: -input.rng.roll("1d6").total } };
    case "synapse_burnout": return { effect: { ...base }, damage: { amount: input.rng.roll("3d6").total, ignoreArmor: true } };
    case "puppet": return { effect: { ...base, expiresRound: input.currentRound + 1, conditionIds: ["PUPPET"], controlsMove: true, controlsAction: true } };
    case "shard_ejection": return { effect: { ...base } };
    case "system_reset": return { effect: { ...base, expiresRound: input.currentRound + 1, conditionIds: ["unconscious", "prone"], unconscious: true, prone: true } };
    default: throw new Error("UNKNOWN_QUICKHACK");
  }
}

function exactDistance(from: TacticalPosition, to: TacticalPosition, map: TacticalMap): number {
  const dx = (to.x - from.x) * map.width;
  const dy = (to.y - from.y) * map.height;
  return Math.sqrt(dx * dx + dy * dy) / map.pixelsPerMeter;
}

export const DISCONNECTED_NETRUNNER_STATE: NetrunnerConnectionState = {
  isJackedIn: false,
  connectedAccessPointId: null,
  connectionType: null,
  architectureId: null,
  currentFloor: null,
  unsafeJackOut: false,
  engagedBlackIceIds: [],
  interfaceRank: 0,
  ramCurrent: 0,
  ramMax: 0,
  netActionsRemaining: 0,
  netActionsMax: 0,
  meatspaceActionUsedForNetrunning: false,
  cyberdeckSlots: 0,
  maxQuickhackSlots: 4,
  equippedQuickhackIds: [],
  cyberdeckStatus: "functional",
};

export function isSupportedConnectionType(
  accessPoint: Pick<TacticalAccessPoint, "connectionTypes">,
  connectionType: unknown,
): connectionType is NetrunnerConnectionType {
  return (connectionType === "wireless" || connectionType === "cable") && accessPoint.connectionTypes.includes(connectionType);
}

export function canConnectToAccessPoint(input: {
  accessPoint: Pick<TacticalAccessPoint, "active" | "position" | "connectionTypes" | "wirelessRangeMeters">;
  connectionType: unknown;
  netrunnerPosition: TacticalPosition;
  map: TacticalMap;
}): { ok: true } | { ok: false; reason: "access_point_inactive" | "connection_type_unsupported" | "out_of_range" } {
  if (!input.accessPoint.active) return { ok: false, reason: "access_point_inactive" };
  if (!isSupportedConnectionType(input.accessPoint, input.connectionType)) return { ok: false, reason: "connection_type_unsupported" };
  if (input.connectionType === "wireless" && tacticalDistance(input.netrunnerPosition, input.accessPoint.position, input.map) > WIRELESS_ACCESS_POINT_RANGE_METERS) {
    return { ok: false, reason: "out_of_range" };
  }
  return { ok: true };
}

export function canJackIn(input: {
  hasCyberdeck: boolean;
  isJackedIn: boolean;
  accessPoint: Pick<TacticalAccessPoint, "active" | "position" | "connectionTypes" | "wirelessRangeMeters">;
  connectionType: unknown;
  netrunnerPosition: TacticalPosition;
  map: TacticalMap;
}): { ok: true } | { ok: false; reason: "cyberdeck_required" | "already_jacked_in" | "access_point_inactive" | "connection_type_unsupported" | "out_of_range" } {
  if (!input.hasCyberdeck) return { ok: false, reason: "cyberdeck_required" };
  if (input.isJackedIn) return { ok: false, reason: "already_jacked_in" };
  return canConnectToAccessPoint(input);
}

export function canSafeJackOut(engagedBlackIceIds: readonly string[]): boolean {
  return engagedBlackIceIds.length === 0;
}

export function connectedNetrunnerState(
  accessPoint: Pick<TacticalAccessPoint, "id" | "architectureId">,
  connectionType: NetrunnerConnectionType,
  interfaceRank = 0,
  ramCurrent = getRamMax(interfaceRank),
  equippedQuickhackIds: string[] = [],
): NetrunnerConnectionState {
  return {
    isJackedIn: true,
    connectedAccessPointId: accessPoint.id,
    connectionType,
    architectureId: accessPoint.architectureId,
    currentFloor: 1,
    unsafeJackOut: false,
    interfaceRank,
    ramCurrent: Math.min(getRamMax(interfaceRank), Math.max(0, ramCurrent)),
    ramMax: getRamMax(interfaceRank),
    netActionsRemaining: getNetActionsPerTurn(interfaceRank),
    netActionsMax: getNetActionsPerTurn(interfaceRank),
    meatspaceActionUsedForNetrunning: true,
    cyberdeckSlots: getCyberdeckSlots(interfaceRank),
    maxQuickhackSlots: 4,
    equippedQuickhackIds,
    cyberdeckStatus: "functional",
  };
}

/**
 * Reconnect preserves depleted RAM. A zero value is meaningful after a
 * previous Jack Out; only a state that never had a derived RAM pool may be
 * initialized at the rank maximum.
 */
export function ramForReconnect(previous: Pick<NetrunnerConnectionState, "ramMax" | "ramCurrent">, interfaceRank: number): number {
  return previous.ramMax > 0 ? Math.min(getRamMax(interfaceRank), Math.max(0, previous.ramCurrent)) : getRamMax(interfaceRank);
}

export function safeJackOutState(previous?: NetrunnerConnectionState): NetrunnerConnectionState {
  return previous ? {
    ...DISCONNECTED_NETRUNNER_STATE,
    interfaceRank: previous.interfaceRank,
    ramCurrent: previous.ramCurrent,
    ramMax: previous.ramMax,
    cyberdeckSlots: previous.cyberdeckSlots,
    maxQuickhackSlots: 4,
    equippedQuickhackIds: [...previous.equippedQuickhackIds],
    cyberdeckStatus: previous.cyberdeckStatus ?? "functional",
    programs: previous.programs ? previous.programs.map((program) => ({ ...program })) : [],
    brainDamage: previous.brainDamage ?? 0,
  } : { ...DISCONNECTED_NETRUNNER_STATE };
}

export function unsafeJackOutState(previous?: NetrunnerConnectionState): NetrunnerConnectionState {
  return { ...safeJackOutState(previous), unsafeJackOut: true };
}

/**
 * PROJECT RULE: movimento wireless para no primeiro ponto que excederia 6m.
 * O resultado é geométrico e não usa LOS, paredes ou Cover.
 */
export function stopAtWirelessAccessPointRange(input: {
  currentPosition: TacticalPosition;
  targetPosition: TacticalPosition;
  accessPoint: Pick<TacticalAccessPoint, "position" | "wirelessRangeMeters">;
  map: TacticalMap;
}): { crossed: false; position: TacticalPosition; distance: number } | { crossed: true; position: TacticalPosition; distance: number } {
  const currentDistance = exactDistance(input.currentPosition, input.accessPoint.position, input.map);
  const targetDistance = exactDistance(input.targetPosition, input.accessPoint.position, input.map);
  const epsilon = 1e-9;
  if (currentDistance > WIRELESS_ACCESS_POINT_RANGE_METERS + epsilon || targetDistance <= WIRELESS_ACCESS_POINT_RANGE_METERS + epsilon) {
    return { crossed: false, position: input.targetPosition, distance: Math.max(0, Math.ceil(targetDistance - currentDistance)) };
  }
  const denominator = targetDistance - currentDistance;
  if (denominator <= 0) return { crossed: false, position: input.targetPosition, distance: Math.max(0, Math.ceil(targetDistance - currentDistance)) };
  const ratio = Math.max(0, Math.min(1, (WIRELESS_ACCESS_POINT_RANGE_METERS - currentDistance) / denominator));
  const position = {
    x: input.currentPosition.x + (input.targetPosition.x - input.currentPosition.x) * ratio,
    y: input.currentPosition.y + (input.targetPosition.y - input.currentPosition.y) * ratio,
  };
  return { crossed: true, position, distance: Math.max(1, Math.ceil(exactDistance(input.currentPosition, position, input.map) - 1e-9)) };
}
