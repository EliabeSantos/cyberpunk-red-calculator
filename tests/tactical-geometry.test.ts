import assert from "node:assert/strict";
import test from "node:test";
import { calculateLineOfSight, calculateTacticalCover, DEFAULT_TACTICAL_OBSTACLE_THICKNESS, tacticalObstacleArea, tacticalSegmentIntersectsArea, tacticalSegmentsIntersect, tacticalTokenSamplePoints, validateMovementPath } from "../src/lib/mesa/tacticalGeometry.ts";
import type { TacticalGeometry } from "../src/lib/mesa/types.ts";

const clear: TacticalGeometry = { walls: [], doors: [] };
const wall = (id: string, x = 0.5, y1 = 0.2, y2 = 0.8) => ({ id, type: "wall" as const, start: { x, y: y1 }, end: { x, y: y2 } });
const door = (id: string, state: "open" | "closed", x = 0.5) => ({ id, type: "door" as const, start: { x, y: 0.2 }, end: { x, y: 0.8 }, state });

test("LOS sem geometria é clear", () => {
  assert.deepEqual(calculateLineOfSight({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, clear), { visible: true });
});

test("parede fora da linha não bloqueia", () => {
  assert.equal(calculateLineOfSight({ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { walls: [wall("off", 0.5)], doors: [] }).visible, true);
});

test("parede atravessada e endpoint da parede bloqueiam", () => {
  assert.deepEqual(calculateLineOfSight({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, { walls: [wall("wall-1", 0.5)], doors: [] }), { visible: false, blockerId: "wall-1", blockerType: "wall" });
  assert.equal(calculateLineOfSight({ x: 0.1, y: 0.2 }, { x: 0.9, y: 0.2 }, { walls: [wall("wall-end", 0.5)], doors: [] }).visible, false);
});

test("segmentos colineares sobrepostos bloqueiam", () => {
  assert.equal(tacticalSegmentsIntersect({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, { x: 0.4, y: 0.5 }, { x: 0.6, y: 0.5 }), true);
  assert.equal(calculateLineOfSight({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, { walls: [{ id: "flat", type: "wall", start: { x: 0.4, y: 0.5 }, end: { x: 0.6, y: 0.5 } }], doors: [] }).blockerId, "flat");
});

test("porta fechada bloqueia e porta aberta não", () => {
  assert.equal(calculateLineOfSight({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, { walls: [], doors: [door("door-1", "closed")] }).visible, false);
  assert.deepEqual(calculateLineOfSight({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, { walls: [], doors: [door("door-1", "open")] }), { visible: true });
});

test("múltiplos obstáculos retornam o primeiro encontrado na linha", () => {
  const result = calculateLineOfSight({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, { walls: [wall("far-wall", 0.7), wall("near-wall", 0.3)], doors: [door("door", "closed", 0.5)] });
  assert.equal(result.blockerId, "near-wall");
  assert.equal(result.blockerType, "wall");
});

test("mover atacante ou alvo altera o resultado", () => {
  const geometry = { walls: [wall("wall-1", 0.5, 0.45, 0.55)], doors: [] };
  assert.equal(calculateLineOfSight({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, geometry).visible, false);
  assert.equal(calculateLineOfSight({ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, geometry).visible, true);
  assert.equal(calculateLineOfSight({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.1 }, geometry).visible, true);
});

test("abrir e fechar uma porta altera somente o LOS da porta", () => {
  const closed = { walls: [], doors: [door("door-1", "closed"), door("door-2", "open", 0.8)] };
  assert.equal(calculateLineOfSight({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, closed).visible, false);
  const opened = { ...closed, doors: closed.doors.map((entry) => entry.id === "door-1" ? { ...entry, state: "open" as const } : entry) };
  assert.equal(calculateLineOfSight({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, opened).visible, true);
});

test("geometria distingue área livre de Full Cover", () => {
  assert.deepEqual(calculateTacticalCover({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, clear), { status: "clear", lineOfSight: "clear", covered: false, blockedSamples: 0, totalSamples: 9 });
  const blocked = calculateTacticalCover({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, { walls: [wall("wall-1", 0.5)], doors: [] });
  assert.equal(blocked.status, "full_cover");
  assert.equal(blocked.lineOfSight, "blocked");
  assert.equal(blocked.covered, true);
  assert.equal(blocked.blockedSamples, blocked.totalSamples);
  assert.equal(calculateTacticalCover({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, { walls: [], doors: [door("door-1", "open")] }).status, "clear");
});

test("espessura ausente usa o default e a área acompanha a orientação", () => {
  const vertical = { id: "vertical", type: "wall" as const, start: { x: 0.5, y: 0.2 }, end: { x: 0.5, y: 0.8 } };
  const horizontal = { id: "horizontal", type: "wall" as const, start: { x: 0.2, y: 0.5 }, end: { x: 0.8, y: 0.5 }, thickness: 0.1 };
  const verticalArea = tacticalObstacleArea(vertical);
  const horizontalArea = tacticalObstacleArea(horizontal);
  assert.equal(verticalArea.corners[0].x, 0.5 - DEFAULT_TACTICAL_OBSTACLE_THICKNESS / 2);
  assert.equal(horizontalArea.corners[0].y, 0.5 + 0.05);
  assert.equal(tacticalSegmentIntersectsArea({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, verticalArea), true);
  assert.equal(tacticalSegmentIntersectsArea({ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, verticalArea), false);
});

test("área espessa bloqueia uma linha que não tocaria o segmento central", () => {
  const wall = { id: "thick", type: "wall" as const, start: { x: 0.4, y: 0.5 }, end: { x: 0.6, y: 0.5 }, thickness: 0.2 };
  const geometry = { walls: [wall], doors: [] };
  assert.equal(calculateLineOfSight({ x: 0.1, y: 0.6 }, { x: 0.9, y: 0.6 }, geometry).visible, false);
});

test("amostragem do token é determinística e normalizada", () => {
  const samples = tacticalTokenSamplePoints({ x: 0.5, y: 0.5 });
  assert.equal(samples.length, 9);
  assert.deepEqual(samples[0], { x: 0.5, y: 0.5 });
  assert.equal(samples[1].y, 0.5 - 0.025);
  assert.equal(samples[4].x, 0.5 + 0.025);
});

test("parede cobre somente parte do token e produz COVER", () => {
  const geometry = { walls: [{ id: "partial", type: "wall" as const, start: { x: 0.85, y: 0.5 }, end: { x: 0.85, y: 0.525 }, thickness: 0.01 }], doors: [] };
  const result = calculateTacticalCover({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, geometry);
  assert.equal(result.status, "partial_obstruction");
  assert.equal(result.lineOfSight, "blocked");
  assert.equal(result.covered, false);
  assert.ok(result.blockedSamples > 0 && result.blockedSamples < result.totalSamples);
});

test("obstrução parcial com LOS central livre é apenas feedback visual", () => {
  const geometry = { walls: [{ id: "edge", type: "wall" as const, start: { x: 0.85, y: 0.475 }, end: { x: 0.85, y: 0.49 }, thickness: 0.005 }], doors: [] };
  const result = calculateTacticalCover({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, geometry);
  assert.equal(result.status, "partial_obstruction");
  assert.equal(result.lineOfSight, "clear");
  assert.equal(result.covered, false);
});

test("parede cobre toda a área do token e produz BLOCKED", () => {
  const geometry = { walls: [{ id: "full", type: "wall" as const, start: { x: 0.85, y: 0.4 }, end: { x: 0.85, y: 0.6 }, thickness: 0.1 }], doors: [] };
  const result = calculateTacticalCover({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, geometry);
  assert.equal(result.status, "full_cover");
  assert.equal(result.lineOfSight, "blocked");
  assert.equal(result.blockedSamples, result.totalSamples);
});

test("porta fechada participa da cobertura e porta aberta é transparente", () => {
  const closed = { walls: [], doors: [{ id: "door", type: "door" as const, start: { x: 0.85, y: 0.5 }, end: { x: 0.85, y: 0.525 }, thickness: 0.01, state: "closed" as const }] };
  assert.equal(calculateTacticalCover({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, closed).status, "partial_obstruction");
  const open = { ...closed, doors: [{ ...closed.doors[0], state: "open" as const }] };
  assert.equal(calculateTacticalCover({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, open).status, "clear");
});

test("múltiplos obstáculos são avaliados por raio", () => {
  const geometry = {
    walls: [
      { id: "partial", type: "wall" as const, start: { x: 0.7, y: 0.5 }, end: { x: 0.7, y: 0.525 }, thickness: 0.01 },
      { id: "full", type: "wall" as const, start: { x: 0.85, y: 0.4 }, end: { x: 0.85, y: 0.6 }, thickness: 0.1 },
    ],
    doors: [],
  };
  assert.equal(calculateTacticalCover({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, geometry).status, "full_cover");
});

test("trajetória de movimento livre é válida", () => {
  assert.deepEqual(validateMovementPath({ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, clear), { valid: true });
});

test("trajetória que atravessa parede é bloqueada e identifica o obstáculo", () => {
  assert.deepEqual(validateMovementPath({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, { walls: [wall("movement-wall")], doors: [] }), {
    valid: false,
    blockedBy: { id: "movement-wall", type: "wall" },
  });
});

test("trajetória que termina antes da parede permanece válida", () => {
  assert.deepEqual(validateMovementPath({ x: 0.1, y: 0.5 }, { x: 0.4, y: 0.5 }, { walls: [wall("far-wall")], doors: [] }), { valid: true });
});

test("trajetória começando encostada na parede é tratada como interseção", () => {
  assert.equal(validateMovementPath({ x: 0.5, y: 0.5 }, { x: 0.9, y: 0.5 }, { walls: [wall("touching-wall")], doors: [] }).valid, false);
});

test("trajetória paralela à parede não é bloqueada", () => {
  assert.deepEqual(validateMovementPath({ x: 0.1, y: 0.1 }, { x: 0.1, y: 0.9 }, { walls: [wall("parallel-wall")], doors: [] }), { valid: true });
});

test("porta fechada bloqueia e porta aberta é ignorada no movimento", () => {
  const closed = { walls: [], doors: [door("closed-door", "closed")] };
  assert.deepEqual(validateMovementPath({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, closed), {
    valid: false,
    blockedBy: { id: "closed-door", type: "door" },
  });
  assert.deepEqual(validateMovementPath({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, {
    walls: [], doors: [{ ...closed.doors[0], state: "open" as const }],
  }), { valid: true });
});

test("obstáculo destruído não bloqueia movimento", () => {
  assert.deepEqual(validateMovementPath({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, {
    walls: [{ ...wall("destroyed-wall"), destroyed: true }],
    doors: [{ ...door("destroyed-door", "closed"), destroyed: true }],
  }), { valid: true });
});

test("espessura física da parede bloqueia a trajetória", () => {
  const thickWall = { id: "thick-wall", type: "wall" as const, start: { x: 0.4, y: 0.5 }, end: { x: 0.6, y: 0.5 }, thickness: 0.2 };
  assert.equal(validateMovementPath({ x: 0.1, y: 0.56 }, { x: 0.9, y: 0.56 }, { walls: [thickWall], doors: [] }).valid, false);
});

test("margem de movimento libera somente a passagem próxima da borda", () => {
  const thickWall = { id: "tolerance-wall", type: "wall" as const, start: { x: 0.4, y: 0.5 }, end: { x: 0.6, y: 0.5 }, thickness: 0.2 };
  const geometry = { walls: [thickWall], doors: [] };
  // A linha fica dentro dos 0.1 de espessura física, mas fora dos 0.08
  // usados exclusivamente pela colisão de movimento.
  assert.equal(validateMovementPath({ x: 0.1, y: 0.59 }, { x: 0.9, y: 0.59 }, geometry).valid, true);
  assert.equal(validateMovementPath({ x: 0.1, y: 0.54 }, { x: 0.9, y: 0.54 }, geometry).valid, false);
});

test("a tolerância não reduz a geometria usada por LOS e Cover", () => {
  const geometry = {
    walls: [{ id: "los-cover-wall", type: "wall" as const, start: { x: 0.4, y: 0.5 }, end: { x: 0.6, y: 0.5 }, thickness: 0.2 }],
    doors: [],
  };
  const observer = { x: 0.1, y: 0.59 };
  const target = { x: 0.9, y: 0.59 };
  assert.equal(validateMovementPath(observer, target, geometry).valid, true);
  assert.equal(calculateLineOfSight(observer, target, geometry).visible, false);
  assert.notEqual(calculateTacticalCover(observer, target, geometry).status, "clear");
});

test("porta fechada usa a mesma margem, enquanto porta aberta e destruída continuam livres", () => {
  const closed = {
    walls: [],
    doors: [{ id: "tolerance-door", type: "door" as const, start: { x: 0.4, y: 0.5 }, end: { x: 0.6, y: 0.5 }, thickness: 0.2, state: "closed" as const }],
  };
  assert.equal(validateMovementPath({ x: 0.1, y: 0.59 }, { x: 0.9, y: 0.59 }, closed).valid, true);
  assert.equal(validateMovementPath({ x: 0.1, y: 0.54 }, { x: 0.9, y: 0.54 }, closed).valid, false);
  assert.equal(validateMovementPath({ x: 0.1, y: 0.54 }, { x: 0.9, y: 0.54 }, {
    walls: [], doors: [{ ...closed.doors[0], state: "open" as const }],
  }).valid, true);
  assert.equal(validateMovementPath({ x: 0.1, y: 0.54 }, { x: 0.9, y: 0.54 }, {
    walls: [], doors: [{ ...closed.doors[0], destroyed: true }],
  }).valid, true);
});

test("múltiplos obstáculos retornam o primeiro bloqueador da trajetória", () => {
  const result = validateMovementPath({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, {
    walls: [wall("far-wall", 0.75), wall("near-wall", 0.25)],
    doors: [door("middle-door", "closed", 0.5)],
  });
  assert.deepEqual(result.blockedBy, { id: "near-wall", type: "wall" });
});

test("trajetória diagonal é avaliada pelo mesmo segmento do LOS", () => {
  assert.deepEqual(validateMovementPath({ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }, { walls: [wall("diagonal-wall")], doors: [] }), {
    valid: false,
    blockedBy: { id: "diagonal-wall", type: "wall" },
  });
});

test("geometria inválida falha fechada e não libera bypass", () => {
  const invalidGeometry = { walls: [{ id: "bad", type: "wall", start: { x: Number.NaN, y: 0.2 }, end: { x: 0.5, y: 0.8 } }], doors: [] } as unknown as TacticalGeometry;
  assert.deepEqual(validateMovementPath({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, invalidGeometry), { valid: false, reason: "invalid_geometry" });
});
