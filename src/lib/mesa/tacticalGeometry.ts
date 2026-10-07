import type { TacticalGeometry, TacticalPoint, TacticalWall, TacticalDoor } from "@/lib/mesa/types";

export interface TacticalLosResult {
  visible: boolean;
  blockerId?: string;
  blockerType?: "wall" | "door";
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

export interface TacticalObstacleArea {
  corners: [TacticalPoint, TacticalPoint, TacticalPoint, TacticalPoint];
}

const EPSILON = 1e-9;

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
): TacticalObstacleArea {
  const dx = obstacle.end.x - obstacle.start.x;
  const dy = obstacle.end.y - obstacle.start.y;
  const length = Math.hypot(dx, dy);
  const thickness = typeof obstacle.thickness === "number" && Number.isFinite(obstacle.thickness) && obstacle.thickness > 0
    ? Math.min(1, obstacle.thickness)
    : DEFAULT_TACTICAL_OBSTACLE_THICKNESS;
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

export function calculateLineOfSight(
  observer: TacticalPoint,
  target: TacticalPoint,
  geometry: TacticalGeometry,
): TacticalLosResult {
  const blockers: TacticalBlocker[] = [
    ...geometry.walls.filter((wall) => wall.destroyed !== true),
    ...geometry.doors.filter((door) => door.state === "closed" && door.destroyed !== true),
  ];
  const intersections = blockers
    .filter((blocker) => tacticalSegmentIntersectsArea(observer, target, tacticalObstacleArea(blocker)))
    .map((blocker, index) => ({ blocker, index, parameter: firstAreaIntersectionParameter(observer, target, tacticalObstacleArea(blocker)) }))
    .sort((a, b) => a.parameter - b.parameter || a.index - b.index);
  const first = intersections[0]?.blocker;
  return first
    ? { visible: false, blockerId: first.id, blockerType: first.type }
    : { visible: true };
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
