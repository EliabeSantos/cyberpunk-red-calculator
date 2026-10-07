import type { TacticalCoverMaterial, TacticalCoverThickness, TacticalDoor, TacticalGeometry, TacticalMap, TacticalPosition, TacticalWall } from "@/lib/mesa/types";
import type { CombatWeapon } from "@/lib/combat/contract";
import { getCatalogItem } from "@/data/items";
import { DEFAULT_TACTICAL_OBSTACLE_THICKNESS } from "@/lib/mesa/tacticalGeometry";
import { getTacticalCoverProfile } from "@/lib/mesa/tacticalCoverCatalog";

const defaultGrid = { enabled: false, size: 1, snap: false };

export const EMPTY_TACTICAL_GEOMETRY: TacticalGeometry = { walls: [], doors: [] };
const TACTICAL_COVER_TARGET_PREFIX = "cover:";

/** Limite seguro para o DV configurável; não é uma tabela de DVs. */
export const MAX_TACTICAL_COVER_DV = 100;

export function isValidTacticalCoverDV(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_TACTICAL_COVER_DV;
}

export function deriveTacticalCoverProfile(material: TacticalCoverMaterial | null | undefined, thickness: TacticalCoverThickness | null | undefined) {
  return getTacticalCoverProfile(material, thickness);
}

export function coverHPAfterProfileChange(currentHP: number | null | undefined, destroyed: boolean | undefined, oldBaseHP: number | null, nextBaseHP: number): number {
  if (destroyed === true) return 0;
  if (currentHP === null || currentHP === undefined || oldBaseHP === null || currentHP === oldBaseHP) return nextBaseHP;
  return Math.min(Math.max(0, currentHP), nextBaseHP);
}

/** Remove valores derivados antes de uma edição do mapa; o servidor os recompõe. */
export function stripDerivedTacticalCoverValues(map: TacticalMap): TacticalMap {
  const geometry = map.geometry;
  if (!geometry) return map;
  const strip = <T extends TacticalWall | TacticalDoor>(entry: T): T => {
    const { coverHP: _coverHP, coverDV: _coverDV, destroyed: _destroyed, ...rest } = entry;
    return rest as T;
  };
  return { ...map, geometry: { walls: geometry.walls.map(strip), doors: geometry.doors.map(strip) } };
}

export function tacticalCoverTargetId(obstacleId: string): string {
  return `${TACTICAL_COVER_TARGET_PREFIX}${obstacleId}`;
}

export function tacticalCoverObstacleId(targetId: string): string | null {
  return targetId.startsWith(TACTICAL_COVER_TARGET_PREFIX) ? targetId.slice(TACTICAL_COVER_TARGET_PREFIX.length) || null : null;
}

export function applyTacticalCoverDamage(currentHP: number, damage: number): { hpAfter: number; destroyed: boolean } {
  if (!Number.isFinite(currentHP) || currentHP < 0 || !Number.isFinite(damage) || damage < 0) throw new Error("INVALID_COVER_DAMAGE");
  const hpAfter = Math.max(0, currentHP - damage);
  return { hpAfter, destroyed: hpAfter === 0 };
}

export function addTacticalWall(geometry: TacticalGeometry, wall: TacticalWall): TacticalGeometry {
  return { ...geometry, walls: [...geometry.walls, { ...wall, thickness: wall.thickness ?? DEFAULT_TACTICAL_OBSTACLE_THICKNESS }] };
}

export function addTacticalDoor(geometry: TacticalGeometry, door: TacticalDoor): TacticalGeometry {
  return { ...geometry, doors: [...geometry.doors, { ...door, thickness: door.thickness ?? DEFAULT_TACTICAL_OBSTACLE_THICKNESS }] };
}

export function updateTacticalGeometrySegment(
  geometry: TacticalGeometry,
  id: string,
  patch: Partial<Pick<TacticalWall, "start" | "end" | "thickness" | "coverMaterial" | "coverThickness" | "coverHP" | "coverDV" | "destroyed">> | Partial<Pick<TacticalDoor, "start" | "end" | "thickness" | "state" | "coverMaterial" | "coverThickness" | "coverHP" | "coverDV" | "destroyed">>,
): TacticalGeometry {
  return {
    walls: geometry.walls.map((wall) => wall.id === id ? { ...wall, ...patch } : wall),
    doors: geometry.doors.map((door) => door.id === id ? { ...door, ...patch } : door),
  };
}

/** Atualiza somente os metadados de Cover do obstáculo identificado. */
export function updateTacticalObstacleCover(
  geometry: TacticalGeometry,
  id: string,
  patch: { coverMaterial?: TacticalCoverMaterial | null; coverThickness?: TacticalCoverThickness | null; coverHP?: number | null; coverDV?: number | null },
): TacticalGeometry {
  return updateTacticalGeometrySegment(geometry, id, patch);
}

export function removeTacticalGeometrySegment(geometry: TacticalGeometry, id: string): TacticalGeometry {
  return { walls: geometry.walls.filter((wall) => wall.id !== id), doors: geometry.doors.filter((door) => door.id !== id) };
}

export function toggleTacticalDoor(geometry: TacticalGeometry, id: string): TacticalGeometry {
  return { ...geometry, doors: geometry.doors.map((door) => door.id === id ? { ...door, state: door.state === "open" ? "closed" : "open" } : door) };
}

export function normalizeTacticalPosition(raw: unknown, fallback: TacticalPosition = { x: 0.5, y: 0.5 }): TacticalPosition {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return fallback;
  const value = raw as Record<string, unknown>;
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return fallback;
  return { x, y };
}

export function tacticalDistance(from: TacticalPosition, to: TacticalPosition, map: TacticalMap): number {
  const dx = (to.x - from.x) * map.width;
  const dy = (to.y - from.y) * map.height;
  return Math.ceil(Math.sqrt(dx * dx + dy * dy) / map.pixelsPerMeter);
}

export interface TacticalWeaponRangeFeedback {
  distance: number;
  rangeMeters: number | null;
  withinRange: boolean | null;
}

/**
 * Retorna feedback visual sem criar uma tabela paralela de alcance. O projeto
 * só possui alcance estruturado quando o item do catálogo o declara (ex.:
 * `range: "4m"`). Armas sem esse dado ficam deliberadamente indeterminadas.
 */
export function tacticalWeaponRangeFeedback(
  from: TacticalPosition,
  to: TacticalPosition,
  map: TacticalMap,
  weapon: CombatWeapon,
): TacticalWeaponRangeFeedback {
  const distance = tacticalDistance(from, to, map);
  const rawRange = weapon.catalogItemId ? getCatalogItem(weapon.catalogItemId)?.range : undefined;
  const match = typeof rawRange === "string" ? rawRange.match(/(\d+(?:\.\d+)?)\s*m/i) : null;
  const rangeMeters = match ? Number(match[1]) : null;
  return {
    distance,
    rangeMeters: Number.isFinite(rangeMeters) ? rangeMeters : null,
    withinRange: rangeMeters !== null && Number.isFinite(rangeMeters) ? distance <= rangeMeters : null,
  };
}

export function tacticalPositionsOverlap(a: TacticalPosition, b: TacticalPosition, map: TacticalMap): boolean {
  const dx = (a.x - b.x) * map.width;
  const dy = (a.y - b.y) * map.height;
  return Math.sqrt(dx * dx + dy * dy) < 64;
}

/** Converte metros lógicos em pixels renderizados; nunca é persistido. */
export function tacticalMovementRadiusPixels(movementAvailable: number, map: TacticalMap, renderedMapWidth: number): number {
  if (!Number.isFinite(movementAvailable) || movementAvailable <= 0 || renderedMapWidth <= 0 || map.width <= 0) return 0;
  return movementAvailable * map.pixelsPerMeter * (renderedMapWidth / map.width);
}

export interface TacticalMovementFeedback {
  distanceMoved: number;
  movementRemaining: number;
  withinMovement: boolean;
}

/** Feedback geométrico apenas: não autoriza nem aplica movimento. */
export function tacticalMovementFeedback(
  origin: TacticalPosition,
  current: TacticalPosition,
  movementAvailable: number,
  map: TacticalMap,
): TacticalMovementFeedback {
  const distanceMoved = tacticalDistance(origin, current, map);
  const available = Math.max(0, movementAvailable);
  return {
    distanceMoved,
    movementRemaining: Math.max(0, available - distanceMoved),
    withinMovement: distanceMoved <= available,
  };
}

export function tacticalGridSpacingPixels(map: TacticalMap, renderedMapWidth: number): number {
  const grid = map.grid ?? defaultGrid;
  if (!grid.enabled || grid.size <= 0 || renderedMapWidth <= 0 || map.width <= 0) return 0;
  return grid.size * map.pixelsPerMeter * (renderedMapWidth / map.width);
}

export function snapTacticalPosition(position: TacticalPosition, map: TacticalMap): TacticalPosition {
  const grid = map.grid ?? defaultGrid;
  if (!grid.enabled || !grid.snap || grid.size <= 0 || map.width <= 0 || map.height <= 0) return position;
  const stepX = (grid.size * map.pixelsPerMeter) / map.width;
  const stepY = (grid.size * map.pixelsPerMeter) / map.height;
  return {
    x: Math.max(0, Math.min(1, Math.round(position.x / stepX) * stepX)),
    y: Math.max(0, Math.min(1, Math.round(position.y / stepY) * stepY)),
  };
}
