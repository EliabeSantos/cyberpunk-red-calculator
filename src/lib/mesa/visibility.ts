import type { MesaCombat, MesaCombatant, TacticalGeometry, TacticalMap, TacticalPosition, VisibilityState } from "@/lib/mesa/types";
import { calculateLineOfSight } from "@/lib/mesa/tacticalGeometry";

/** F1.48: estado mínimo de visibilidade; Stealth não pertence a esta camada. */
export type { VisibilityState } from "@/lib/mesa/types";

const EMPTY_GEOMETRY: TacticalGeometry = { walls: [], doors: [] };

/** Resolve visibilidade usando somente posições e geometria autorizadas. */
export function resolveTacticalVisibility(
  observerPosition: TacticalPosition | null | undefined,
  targetPosition: TacticalPosition | null | undefined,
  map: TacticalMap,
): VisibilityState {
  if (!observerPosition || !targetPosition) return "hidden";
  return calculateLineOfSight(
    observerPosition,
    targetPosition,
    map.geometry ?? EMPTY_GEOMETRY,
  ).visible ? "visible" : "hidden";
}

/**
 * Projeta combatants para um Player. Characters permanecem no elenco público
 * atual; Enemies invisíveis são omitidos, nunca enviados com `visible:false`.
 */
export function projectCombatantsForPlayer(
  combatants: MesaCombatant[],
  viewerParticipantId: string,
  map: TacticalMap,
  persistedPositions: ReadonlyMap<string, TacticalPosition | null> = new Map(
    combatants.map((combatant) => [combatant.id, combatant.position ?? null]),
  ),
): MesaCombatant[] {
  const observer = combatants.find(
    (combatant) => combatant.kind === "character" && combatant.participantId === viewerParticipantId,
  );
  const observerPosition = observer ? persistedPositions.get(observer.id) ?? null : null;

  return combatants.filter((combatant) => {
    if (combatant.id === observer?.id) return true;
    if (combatant.kind !== "enemy" && combatant.stealthState !== "stealthed") return true;
    if (resolveTacticalVisibility(observerPosition, persistedPositions.get(combatant.id) ?? null, map) !== "visible") return false;
    return combatant.stealthState !== "stealthed" || (combatant.detectedBy ?? []).includes(observer?.id ?? "");
  }).map((combatant) => {
    if (combatant.id === observer?.id) return combatant;
    const { netrunnerState: _privateNetrunnerState, netDiscovery: _privateNetDiscovery, ...publicCombatant } = combatant;
    return publicCombatant;
  });
}

/** Projeção única para o snapshot: GM integral, Player filtrado. */
export function projectCombatantsForViewer(
  combatants: MesaCombatant[],
  viewerRole: "gm" | "player" | null,
  viewerParticipantId: string | null,
  map: TacticalMap,
  persistedPositions?: ReadonlyMap<string, TacticalPosition | null>,
): MesaCombatant[] {
  if (viewerRole === "gm") return combatants;
  if (viewerRole !== "player" || !viewerParticipantId) return [];
  return projectCombatantsForPlayer(combatants, viewerParticipantId, map, persistedPositions);
}

/**
 * Projeta a parte do combate que poderia revelar um Enemy omitido: o ID ativo
 * é removido e eventos que identificam ou contam inimigos não são publicados.
 */
export function projectCombatForPlayer(
  combat: MesaCombat | null,
  allCombatants: MesaCombatant[],
  visibleCombatants: MesaCombatant[],
  viewerParticipantId?: string | null,
): MesaCombat | null {
  if (!combat) return null;
  const visibleIds = new Set(visibleCombatants.map((combatant) => combatant.id));
  const hiddenNames = allCombatants
    .filter((combatant) => combatant.kind === "enemy" && !visibleIds.has(combatant.id))
    .map((combatant) => combatant.name.trim().toLocaleLowerCase())
    .filter(Boolean);
  return {
    ...combat,
    activeCombatantId: combat.activeCombatantId && visibleIds.has(combat.activeCombatantId)
      ? combat.activeCombatantId
      : combat.activeCombatantId && allCombatants.find((entry) => entry.id === combat.activeCombatantId)?.kind === "enemy"
        ? null
        : combat.activeCombatantId,
    eventLog: combat.eventLog.filter((event) => {
      if (event.privateToParticipantId && event.privateToParticipantId !== viewerParticipantId) return false;
      if (event.kind === "enemy") return false;
      const text = event.text.toLocaleLowerCase();
      return !hiddenNames.some((name) => text.includes(name));
    }),
  };
}

/** Regra usada também pelo Attack Gateway contra POST direto em alvo oculto. */
export function isTacticalTargetVisibleToPlayer(
  observerPosition: TacticalPosition | null | undefined,
  targetPosition: TacticalPosition | null | undefined,
  map: TacticalMap,
): boolean {
  return resolveTacticalVisibility(observerPosition, targetPosition, map) === "visible";
}

/** Mesmo gate usado pela projeção, agora incluindo o conhecimento do Player. */
export function isDetectedBy(observerId: string, target: Pick<MesaCombatant, "stealthState" | "detectedBy">): boolean {
  return target.stealthState !== "stealthed" || (target.detectedBy ?? []).includes(observerId);
}
