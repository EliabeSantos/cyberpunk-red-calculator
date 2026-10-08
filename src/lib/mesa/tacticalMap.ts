import type { TacticalCoverMaterial, TacticalCoverThickness, TacticalDoor, TacticalGeometry, TacticalHackableObject, TacticalMap, TacticalPosition, TacticalWall } from "@/lib/mesa/types";
import type { CombatWeapon } from "@/lib/combat/contract";
import { getCatalogItem } from "@/data/items";
import { getWeaponRangeProfile, rangeBandLabel, resolveWeaponRangeBand, type WeaponRangeBand } from "@/lib/combat/weaponRange";
import { DEFAULT_TACTICAL_OBSTACLE_THICKNESS, DEFAULT_TACTICAL_TOKEN_RADIUS } from "@/lib/mesa/tacticalGeometry";
import { getTacticalCoverProfile } from "@/lib/mesa/tacticalCoverCatalog";

/** O grid do VTT representa os espaços de 2m do mapa de combate. */
export const DEFAULT_TACTICAL_GRID_SIZE_METERS = 2;
const defaultGrid = { enabled: false, size: DEFAULT_TACTICAL_GRID_SIZE_METERS, snap: false };
const MELEE_RANGE_EPSILON = 1e-9;

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

export function addTacticalHackableObject(map: TacticalMap, object: TacticalHackableObject): TacticalMap {
  return { ...map, hackableObjects: [...(map.hackableObjects ?? []), object] };
}

export function updateTacticalHackableObject(map: TacticalMap, id: string, patch: Partial<TacticalHackableObject>): TacticalMap {
  return { ...map, hackableObjects: (map.hackableObjects ?? []).map((object) => object.id === id ? { ...object, ...patch } : object) };
}

export function removeTacticalHackableObject(map: TacticalMap, id: string): TacticalMap {
  return { ...map, hackableObjects: (map.hackableObjects ?? []).filter((object) => object.id !== id) };
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

export type TacticalMeleeRangeReason = "adjacent" | "out_of_range";

export interface TacticalMeleeRangeResolution {
  inRange: boolean;
  reason: TacticalMeleeRangeReason;
  /** Distância visual existente do Tactical Map, em metros lógicos. */
  distanceMeters: number;
  /** Tamanho da célula usado pelo mapa para resolver adjacência. */
  cellSizeMeters: number;
}

/**
 * Resolve o alcance corpo a corpo usando a única escala espacial do Tactical
 * Map. A regra do livro não usa a Weapon Range Table: no VTT, "adjacente" é
 * um espaço vizinho ortogonal ou diagonal. A comparação por eixo (Chebyshev)
 * preserva essa convenção sem transformar uma diagonal em um DV ou em um
 * limite euclidiano arbitrário de 2m.
 *
 * `grid.enabled` controla somente a apresentação. `grid.size` continua sendo
 * a unidade lógica do mapa mesmo quando o snap/grade visual está desligado,
 * permitindo resolver também posições contínuas persistidas. A comparação
 * desconta o diâmetro lógico dos tokens: alcance é medido entre as bordas,
 * não apenas entre os centros.
 */
export function resolveMeleeRange(
  from: TacticalPosition,
  to: TacticalPosition,
  map: TacticalMap,
): TacticalMeleeRangeResolution {
  const configuredCellSize = map.grid?.size;
  const cellSizeMeters = typeof configuredCellSize === "number"
    && Number.isFinite(configuredCellSize)
    && configuredCellSize > 0
    ? configuredCellSize
    : DEFAULT_TACTICAL_GRID_SIZE_METERS;
  const dxMeters = Math.abs(to.x - from.x) * map.width / map.pixelsPerMeter;
  const dyMeters = Math.abs(to.y - from.y) * map.height / map.pixelsPerMeter;
  const tokenDiameterX = DEFAULT_TACTICAL_TOKEN_RADIUS * map.width * 2 / map.pixelsPerMeter;
  const tokenDiameterY = DEFAULT_TACTICAL_TOKEN_RADIUS * map.height * 2 / map.pixelsPerMeter;
  const edgeDistanceX = Math.max(0, dxMeters - tokenDiameterX);
  const edgeDistanceY = Math.max(0, dyMeters - tokenDiameterY);
  const separated = dxMeters > MELEE_RANGE_EPSILON || dyMeters > MELEE_RANGE_EPSILON;
  const inRange = separated
    && Math.max(edgeDistanceX, edgeDistanceY) <= cellSizeMeters + MELEE_RANGE_EPSILON;

  return {
    inRange,
    reason: inRange ? "adjacent" : "out_of_range",
    distanceMeters: tacticalDistance(from, to, map),
    cellSizeMeters,
  };
}

/** Os quatro ataques sem Range Table que usam a adjacência do grid. */
export function isMeleeAttackType(attackType?: string, skillId?: string): boolean {
  return new Set(["melee", "brawling", "martial_arts", "unarmed", "weaponless"]).has(attackType ?? "")
    || skillId === "brawling"
    || skillId === "melee_weapon"
    || skillId?.startsWith("martial_arts_") === true
    || skillId === "martial_arts";
}

export interface TacticalWeaponRangeFeedback {
  distance: number;
  rangeMeters: number | null;
  withinRange: boolean | null;
  band?: WeaponRangeBand;
  bandLabel?: string;
  dv?: number;
  profileId?: string;
}

/**
 * Retorna feedback visual usando o mesmo resolver do gateway. O campo `range`
 * legado continua sendo lido somente para ataques especiais como Monowire,
 * que têm alcance físico próprio mas não usam a tabela de armas de fogo.
 */
export function tacticalWeaponRangeFeedback(
  from: TacticalPosition,
  to: TacticalPosition,
  map: TacticalMap,
  weapon: CombatWeapon | null | undefined,
): TacticalWeaponRangeFeedback {
  const distance = tacticalDistance(from, to, map);
  const profile = getWeaponRangeProfile(weapon);
  if (profile) {
    const resolution = resolveWeaponRangeBand(distance, profile);
    if (resolution.status === "valid") {
      return {
        distance,
        rangeMeters: profile.bands[profile.bands.length - 1].maxMeters,
        withinRange: true,
        band: resolution.band,
        bandLabel: rangeBandLabel(resolution.band),
        dv: resolution.dv,
        profileId: resolution.profileId,
      };
    }
    return {
      distance,
      rangeMeters: resolution.status === "out_of_range" ? resolution.maxMeters : null,
      withinRange: resolution.status === "out_of_range" ? false : null,
      ...(resolution.status === "out_of_range" ? { profileId: resolution.profileId } : {}),
    };
  }
  const rawRange = weapon?.catalogItemId ? getCatalogItem(weapon.catalogItemId)?.range : undefined;
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
