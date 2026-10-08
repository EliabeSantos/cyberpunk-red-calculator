import type { TacticalGeometry, TacticalPoint, TacticalWall, TacticalDoor } from "@/lib/mesa/types";

export interface TacticalLosResult {
  visible: boolean;
  blockerId?: string;
  blockerType?: "wall" | "door";
}

export interface TacticalMovementPathResult {
  valid: boolean;
  blockedBy?: {
    id: string;
    type: "wall" | "door";
  };
  reason?: "invalid_geometry";
}

export interface TacticalCoverResult {
  /** Área do alvo: nenhuma, parcial ou completamente protegida. */
  status: "clear" | "partial_obstruction" | "full_cover";
  /** LOS da linha central, mantido separado da área do alvo. */
  lineOfSight: "clear" | "blocked";
  covered: boolean;
  blockedSamples: number;
  totalSamples: number;
  blockerId?: string;
  blockerType?: "wall" | "door";
}

export interface TacticalTokenShape {
  type: "circle";
  /** Radius in normalized map coordinates. */
  radius: number;
}

/** Shared token footprint used by Player and GM until per-token sizing exists. */
export const DEFAULT_TACTICAL_TOKEN_RADIUS = 0.025;
export const DEFAULT_TACTICAL_TOKEN_SHAPE: TacticalTokenShape = {
  type: "circle",
  radius: DEFAULT_TACTICAL_TOKEN_RADIUS,
};

/** Default used when loading F1.33 geometry that predates obstacle thickness. */
export const DEFAULT_TACTICAL_OBSTACLE_THICKNESS = 0.008;

/**
 * Movimento usa uma margem pequena contra falsos bloqueios na borda. Esta
 * tolerância é exclusiva da trajetória de movimento: a geometria visual,
 * LOS e Cover continuam usando 100% da espessura persistida.
 */
export const MOVEMENT_COLLISION_TOLERANCE = 0.8;

export interface TacticalObstacleArea {
  corners: [TacticalPoint, TacticalPoint, TacticalPoint, TacticalPoint];
}

const EPSILON = 1e-9;

function isTacticalPoint(value: unknown): value is TacticalPoint {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const point = value as Record<string, unknown>;
  return typeof point.x === "number" && Number.isFinite(point.x) && point.x >= 0 && point.x <= 1
    && typeof point.y === "number" && Number.isFinite(point.y) && point.y >= 0 && point.y <= 1;
}

/**
 * Verifica a forma persistida antes de usá-la como autoridade geométrica.
 * Uma geometria inválida não vira um mapa vazio silenciosamente, pois isso
 * permitiria atravessar um obstáculo que o servidor não conseguiu interpretar.
 */
export function isValidTacticalGeometry(value: unknown): value is TacticalGeometry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const geometry = value as Record<string, unknown>;
  if (!Array.isArray(geometry.walls) || !Array.isArray(geometry.doors)) return false;

  const ids = new Set<string>();
  const validObstacle = (entry: unknown, type: "wall" | "door"): boolean => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
    const obstacle = entry as Record<string, unknown>;
    if (obstacle.type !== type || typeof obstacle.id !== "string" || obstacle.id.trim() === "" || ids.has(obstacle.id)) return false;
    if (!isTacticalPoint(obstacle.start) || !isTacticalPoint(obstacle.end)) return false;
    if (obstacle.thickness !== undefined && (typeof obstacle.thickness !== "number" || !Number.isFinite(obstacle.thickness) || obstacle.thickness <= 0 || obstacle.thickness > 1)) return false;
    if (obstacle.destroyed !== undefined && typeof obstacle.destroyed !== "boolean") return false;
    if (type === "door" && obstacle.state !== "open" && obstacle.state !== "closed") return false;
    ids.add(obstacle.id);
    return true;
  };

  return geometry.walls.every((entry) => validObstacle(entry, "wall"))
    && geometry.doors.every((entry) => validObstacle(entry, "door"));
}

function cross(a: TacticalPoint, b: TacticalPoint, c: TacticalPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function between(value: number, a: number, b: number): boolean {
  return value >= Math.min(a, b) - EPSILON && value <= Math.max(a, b) + EPSILON;
}

function pointOnSegment(point: TacticalPoint, start: TacticalPoint, end: TacticalPoint): boolean {
  return Math.abs(cross(start, end, point)) <= EPSILON
    && between(point.x, start.x, end.x)
    && between(point.y, start.y, end.y);
}

/** Inclusive segment intersection: touching endpoints and collinear overlap count. */
export function tacticalSegmentsIntersect(
  firstStart: TacticalPoint,
  firstEnd: TacticalPoint,
  secondStart: TacticalPoint,
  secondEnd: TacticalPoint,
): boolean {
  const firstStartSide = cross(firstStart, firstEnd, secondStart);
  const firstEndSide = cross(firstStart, firstEnd, secondEnd);
  const secondStartSide = cross(secondStart, secondEnd, firstStart);
  const secondEndSide = cross(secondStart, secondEnd, firstEnd);

  if (Math.abs(firstStartSide) <= EPSILON && pointOnSegment(secondStart, firstStart, firstEnd)) return true;
  if (Math.abs(firstEndSide) <= EPSILON && pointOnSegment(secondEnd, firstStart, firstEnd)) return true;
  if (Math.abs(secondStartSide) <= EPSILON && pointOnSegment(firstStart, secondStart, secondEnd)) return true;
  if (Math.abs(secondEndSide) <= EPSILON && pointOnSegment(firstEnd, secondStart, secondEnd)) return true;

  const firstSidesDiffer = (firstStartSide > EPSILON && firstEndSide < -EPSILON) || (firstStartSide < -EPSILON && firstEndSide > EPSILON);
  const secondSidesDiffer = (secondStartSide > EPSILON && secondEndSide < -EPSILON) || (secondStartSide < -EPSILON && secondEndSide > EPSILON);
  return firstSidesDiffer && secondSidesDiffer;
}

/** Derives an oriented rectangle from a normalized segment and thickness. */
export function tacticalObstacleArea(
  obstacle: TacticalWall | TacticalDoor,
  thicknessScale = 1,
): TacticalObstacleArea {
  const dx = obstacle.end.x - obstacle.start.x;
  const dy = obstacle.end.y - obstacle.start.y;
  const length = Math.hypot(dx, dy);
  const physicalThickness = typeof obstacle.thickness === "number" && Number.isFinite(obstacle.thickness) && obstacle.thickness > 0
    ? Math.min(1, obstacle.thickness)
    : DEFAULT_TACTICAL_OBSTACLE_THICKNESS;
  const thickness = physicalThickness * thicknessScale;
  const halfThickness = thickness / 2;
  const normal = length <= EPSILON
    ? { x: 0, y: halfThickness }
    : { x: (-dy / length) * halfThickness, y: (dx / length) * halfThickness };
  return {
    corners: [
      { x: obstacle.start.x + normal.x, y: obstacle.start.y + normal.y },
      { x: obstacle.end.x + normal.x, y: obstacle.end.y + normal.y },
      { x: obstacle.end.x - normal.x, y: obstacle.end.y - normal.y },
      { x: obstacle.start.x - normal.x, y: obstacle.start.y - normal.y },
    ],
  };
}

function pointInPolygon(point: TacticalPoint, polygon: TacticalPoint[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    if (pointOnSegment(point, previousPoint, currentPoint)) return true;
    const crosses = (currentPoint.y > point.y) !== (previousPoint.y > point.y)
      && point.x < ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) / (previousPoint.y - currentPoint.y) + currentPoint.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function tacticalSegmentIntersectsArea(
  lineStart: TacticalPoint,
  lineEnd: TacticalPoint,
  area: TacticalObstacleArea,
): boolean {
  if (pointInPolygon(lineStart, area.corners) || pointInPolygon(lineEnd, area.corners)) return true;
  return area.corners.some((corner, index) => tacticalSegmentsIntersect(
    lineStart,
    lineEnd,
    corner,
    area.corners[(index + 1) % area.corners.length],
  ));
}

/** Deterministic center/cardinal/diagonal samples for a circular token. */
export function tacticalTokenSamplePoints(
  center: TacticalPoint,
  shape: TacticalTokenShape = DEFAULT_TACTICAL_TOKEN_SHAPE,
): TacticalPoint[] {
  const radius = typeof shape.radius === "number" && Number.isFinite(shape.radius)
    ? Math.min(1, Math.max(0, shape.radius))
    : DEFAULT_TACTICAL_TOKEN_RADIUS;
  const diagonal = radius / Math.sqrt(2);
  return [
    { x: center.x, y: center.y },
    { x: center.x, y: center.y - radius },
    { x: center.x, y: center.y + radius },
    { x: center.x - radius, y: center.y },
    { x: center.x + radius, y: center.y },
    { x: center.x - diagonal, y: center.y - diagonal },
    { x: center.x + diagonal, y: center.y - diagonal },
    { x: center.x - diagonal, y: center.y + diagonal },
    { x: center.x + diagonal, y: center.y + diagonal },
  ];
}

function firstIntersectionParameter(
  lineStart: TacticalPoint,
  lineEnd: TacticalPoint,
  obstacleStart: TacticalPoint,
  obstacleEnd: TacticalPoint,
): number {
  const direction = { x: lineEnd.x - lineStart.x, y: lineEnd.y - lineStart.y };
  const obstacleDirection = { x: obstacleEnd.x - obstacleStart.x, y: obstacleEnd.y - obstacleStart.y };
  const denominator = direction.x * obstacleDirection.y - direction.y * obstacleDirection.x;
  if (Math.abs(denominator) > EPSILON) {
    const offset = { x: obstacleStart.x - lineStart.x, y: obstacleStart.y - lineStart.y };
    return Math.max(0, Math.min(1, (offset.x * obstacleDirection.y - offset.y * obstacleDirection.x) / denominator));
  }

  const lengthSquared = direction.x * direction.x + direction.y * direction.y;
  if (lengthSquared <= EPSILON) return 0;
  const parameter = (point: TacticalPoint) => ((point.x - lineStart.x) * direction.x + (point.y - lineStart.y) * direction.y) / lengthSquared;
  return Math.max(0, Math.min(1, Math.min(parameter(obstacleStart), parameter(obstacleEnd))));
}

function firstAreaIntersectionParameter(
  lineStart: TacticalPoint,
  lineEnd: TacticalPoint,
  area: TacticalObstacleArea,
): number {
  if (pointInPolygon(lineStart, area.corners)) return 0;
  const parameters = area.corners.flatMap((corner, index) => {
    const edgeStart = corner;
    const edgeEnd = area.corners[(index + 1) % area.corners.length];
    if (!tacticalSegmentsIntersect(lineStart, lineEnd, edgeStart, edgeEnd)) return [];
    return [firstIntersectionParameter(lineStart, lineEnd, edgeStart, edgeEnd)];
  });
  return parameters.length > 0 ? Math.min(...parameters) : 1;
}

type TacticalBlocker = TacticalWall | TacticalDoor;

function firstBlockingObstacle(
  observer: TacticalPoint,
  target: TacticalPoint,
  geometry: TacticalGeometry,
  thicknessScale = 1,
): TacticalBlocker | undefined {
  const blockers: TacticalBlocker[] = [
    ...geometry.walls.filter((wall) => wall.destroyed !== true),
    ...geometry.doors.filter((door) => door.state === "closed" && door.destroyed !== true),
  ];
  const intersections = blockers
    .map((blocker, index) => ({ blocker, index, area: tacticalObstacleArea(blocker, thicknessScale) }))
    .filter(({ area }) => tacticalSegmentIntersectsArea(observer, target, area))
    .map(({ blocker, index, area }) => ({ blocker, index, parameter: firstAreaIntersectionParameter(observer, target, area) }))
    .sort((a, b) => a.parameter - b.parameter || a.index - b.index);
  return intersections[0]?.blocker;
}

export function calculateLineOfSight(
  observer: TacticalPoint,
  target: TacticalPoint,
  geometry: TacticalGeometry,
): TacticalLosResult {
  const first = firstBlockingObstacle(observer, target, geometry);
  return first
    ? { visible: false, blockerId: first.id, blockerType: first.type }
    : { visible: true };
}

/**
 * Valida o segmento inteiro do movimento no mesmo espaço normalizado, usando
 * uma área efetiva ligeiramente menor que a física para evitar falsos
 * bloqueios na borda. O resultado é puro e determinístico;
 * a autorização, o orçamento e a persistência continuam sendo do gateway.
 */
export function validateMovementPath(
  start: TacticalPoint,
  destination: TacticalPoint,
  geometry: TacticalGeometry,
): TacticalMovementPathResult {
  if (!isTacticalPoint(start) || !isTacticalPoint(destination) || !isValidTacticalGeometry(geometry)) {
    return { valid: false, reason: "invalid_geometry" };
  }

  const blocker = firstBlockingObstacle(start, destination, geometry, MOVEMENT_COLLISION_TOLERANCE);
  return blocker
    ? { valid: false, blockedBy: { id: blocker.id, type: blocker.type } }
    : { valid: true };
}

/** Classifies visibility across deterministic samples of the target footprint. */
export function calculateTacticalCover(
  observer: TacticalPoint,
  target: TacticalPoint,
  geometry: TacticalGeometry,
  shape: TacticalTokenShape = DEFAULT_TACTICAL_TOKEN_SHAPE,
): TacticalCoverResult {
  const samples = tacticalTokenSamplePoints(target, shape);
  const centerLos = calculateLineOfSight(observer, target, geometry);
  const blockedSamples = samples.reduce((blocked, sample) => (
    blocked + (calculateLineOfSight(observer, sample, geometry).visible ? 0 : 1)
  ), 0);
  const totalSamples = samples.length;
  const status = blockedSamples === 0
    ? "clear"
    : blockedSamples === totalSamples
      ? "full_cover"
      : "partial_obstruction";
  return {
    status,
    lineOfSight: centerLos.visible ? "clear" : "blocked",
    covered: status === "full_cover",
    blockedSamples,
    totalSamples,
    ...(centerLos.blockerId ? { blockerId: centerLos.blockerId } : {}),
    ...(centerLos.blockerType ? { blockerType: centerLos.blockerType } : {}),
  };
}
