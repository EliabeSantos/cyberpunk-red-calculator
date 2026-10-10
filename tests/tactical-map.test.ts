import assert from "node:assert/strict";
import test from "node:test";
import { TACTICAL_COVER_MATERIALS, type TacticalGeometry } from "../src/lib/mesa/types.ts";
import { getTacticalCoverProfile, TACTICAL_COVER_PROFILES } from "../src/lib/mesa/tacticalCoverCatalog.ts";
import { addTacticalDoor, addTacticalWall, applyTacticalCoverDamage, isValidTacticalCoverDV, normalizeTacticalPosition, removeTacticalGeometrySegment, snapTacticalPosition, tacticalDistance, tacticalGridSpacingPixels, tacticalMovementFeedback, tacticalMovementRadiusPixels, tacticalPositionsOverlap, tacticalWeaponRangeFeedback, toggleTacticalDoor, updateTacticalGeometrySegment, updateTacticalObstacleCover } from "../src/lib/mesa/tacticalMap.ts";

test("Tactical Map mantém coordenadas normalizadas e rejeita valores inválidos", () => {
  assert.deepEqual(normalizeTacticalPosition({ x: 0.25, y: 0.75 }), { x: 0.25, y: 0.75 });
  assert.deepEqual(normalizeTacticalPosition({ x: 2, y: -1 }), { x: 0.5, y: 0.5 });
  assert.deepEqual(normalizeTacticalPosition({ x: "0.2", y: 0.4 }), { x: 0.2, y: 0.4 });
});

test("distância usa o espaço lógico do mapa, não pixels renderizados", () => {
  const map = { imageUrl: "", enabled: true, width: 1000, height: 600, pixelsPerMeter: 50 };
  assert.equal(tacticalDistance({ x: 0, y: 0 }, { x: 0.5, y: 0 }, map), 10);
  assert.equal(tacticalDistance({ x: 0, y: 0 }, { x: 0.5, y: 0 }, { ...map, width: 2000 }), 20);
});

test("tokens não podem ocupar o mesmo espaço lógico sem criar uma margem excessiva", () => {
  const map = { imageUrl: "", enabled: true, width: 1000, height: 600, pixelsPerMeter: 50 };
  assert.equal(tacticalPositionsOverlap({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, map), true);
  assert.equal(tacticalPositionsOverlap({ x: 0.5, y: 0.5 }, { x: 0.549, y: 0.5 }, map), true);
  assert.equal(tacticalPositionsOverlap({ x: 0.5, y: 0.5 }, { x: 0.55, y: 0.5 }, map), false);
  assert.equal(tacticalPositionsOverlap({ x: 0.1, y: 0.5 }, { x: 0.2, y: 0.5 }, map), false);
});

test("raio visual usa o movimento disponível e a escala renderizada", () => {
  const map = { imageUrl: "", enabled: true, width: 1000, height: 600, pixelsPerMeter: 40 };
  assert.equal(tacticalMovementRadiusPixels(6, map, 500), 120);
  assert.equal(tacticalMovementRadiusPixels(4, map, 500), 80);
  assert.equal(tacticalMovementRadiusPixels(0, map, 500), 0);
});

test("feedback mostra distância percorrida, restante e estado fora do raio", () => {
  const map = { imageUrl: "", enabled: true, width: 1000, height: 600, pixelsPerMeter: 50 };
  assert.deepEqual(tacticalMovementFeedback({ x: 0, y: 0 }, { x: 0.2, y: 0 }, 6, map), {
    distanceMoved: 4, movementRemaining: 2, withinMovement: true,
  });
  assert.deepEqual(tacticalMovementFeedback({ x: 0, y: 0 }, { x: 0.4, y: 0 }, 6, map), {
    distanceMoved: 8, movementRemaining: 0, withinMovement: false,
  });
});

test("grid e snap usam metros lógicos e permanecem opcionais", () => {
  const map = { imageUrl: "", enabled: true, width: 1000, height: 600, pixelsPerMeter: 50, grid: { enabled: true, size: 2, snap: true } };
  assert.equal(tacticalGridSpacingPixels(map, 500), 50);
  assert.deepEqual(snapTacticalPosition({ x: 0.23, y: 0.31 }, map), { x: 0.2, y: 1 / 3 });
  assert.deepEqual(snapTacticalPosition({ x: 0.23, y: 0.31 }, { ...map, grid: { ...map.grid, snap: false } }), { x: 0.23, y: 0.31 });
});

test("alcance usa somente a declaração estruturada do catálogo", () => {
  const map = { imageUrl: "", enabled: true, width: 1000, height: 600, pixelsPerMeter: 50 };
  const monowire = { id: "monowire", name: "Monowire", damage: "3d6", catalogItemId: "monowire" };
  assert.deepEqual(tacticalWeaponRangeFeedback({ x: 0, y: 0 }, { x: 0.08, y: 0 }, map, monowire), {
    distance: 2,
    rangeMeters: 4,
    withinRange: true,
  });
  assert.equal(tacticalWeaponRangeFeedback({ x: 0, y: 0 }, { x: 0.3, y: 0 }, map, monowire).withinRange, false);
  assert.equal(tacticalWeaponRangeFeedback({ x: 0, y: 0 }, { x: 0.3, y: 0 }, map, { id: "pistol", name: "Pistol", damage: "3d6" }).withinRange, null);
});

test("geometria mantém múltiplas paredes e portas e edita por id", () => {
  const wall1 = { id: "wall-1", type: "wall" as const, start: { x: 0.1, y: 0.2 }, end: { x: 0.8, y: 0.2 } };
  const wall2 = { id: "wall-2", type: "wall" as const, start: { x: 0.4, y: 0.3 }, end: { x: 0.4, y: 0.8 } };
  const door1 = { id: "door-1", type: "door" as const, start: { x: 0.4, y: 0.5 }, end: { x: 0.4, y: 0.6 }, state: "closed" as const };
  const door2 = { id: "door-2", type: "door" as const, start: { x: 0.6, y: 0.5 }, end: { x: 0.6, y: 0.6 }, state: "closed" as const };
  let geometry: TacticalGeometry = { walls: [], doors: [] };
  geometry = addTacticalWall(geometry, wall1);
  geometry = addTacticalWall(geometry, wall2);
  geometry = addTacticalDoor(geometry, door1);
  geometry = addTacticalDoor(geometry, door2);
  assert.equal(geometry.walls.length, 2);
  assert.equal(geometry.doors.length, 2);
  assert.equal(geometry.walls[0].thickness, 0.008);
  assert.equal(geometry.doors[0].thickness, 0.008);
  geometry = updateTacticalGeometrySegment(geometry, "wall-2", { end: { x: 0.5, y: 0.9 } });
  assert.deepEqual(geometry.walls[0], { ...wall1, thickness: 0.008 });
  assert.deepEqual(geometry.walls[1].end, { x: 0.5, y: 0.9 });
  geometry = toggleTacticalDoor(geometry, "door-2");
  assert.equal(geometry.doors[0].state, "closed");
  assert.equal(geometry.doors[1].state, "open");
  geometry = removeTacticalGeometrySegment(geometry, "wall-2");
  assert.deepEqual(geometry.walls.map((wall) => wall.id), ["wall-1"]);
  assert.equal(geometry.doors.length, 2);
});

test("metadados de Cover usam catálogo fechado e atualização imutável por ID", () => {
  assert.deepEqual(TACTICAL_COVER_MATERIALS, ["wood", "stone", "concrete", "steel", "ballistic_glass"]);
  let geometry: TacticalGeometry = {
    walls: [{ id: "wall", type: "wall", start: { x: 0.2, y: 0.2 }, end: { x: 0.2, y: 0.8 }, thickness: 0.01 }],
    doors: [{ id: "door", type: "door", start: { x: 0.5, y: 0.2 }, end: { x: 0.5, y: 0.8 }, thickness: 0.01, state: "closed" }],
  };
  geometry = updateTacticalObstacleCover(geometry, "wall", { coverMaterial: "concrete", coverHP: 40 });
  assert.deepEqual(geometry.walls[0], { ...geometry.walls[0], coverMaterial: "concrete", coverHP: 40 });
  assert.equal(geometry.doors[0].coverMaterial, undefined);
  assert.equal(geometry.doors[0].coverHP, undefined);
  geometry = updateTacticalObstacleCover(geometry, "door", { coverMaterial: "steel", coverHP: 0 });
  assert.equal(geometry.doors[0].coverMaterial, "steel");
  assert.equal(geometry.doors[0].coverHP, 0);
});

test("catálogo oficial deriva HP por material e espessura e mantém DV centralizado", () => {
  const expected = {
    wood: [5, 20], stone: [20, 40], ballistic_glass: [15, 30], concrete: [10, 25], steel: [25, 50],
  } as const;
  for (const [material, hp] of Object.entries(expected)) {
    assert.equal(getTacticalCoverProfile(material, "thin")?.hp, hp[0]);
    assert.equal(getTacticalCoverProfile(material, "thick")?.hp, hp[1]);
    assert.equal(getTacticalCoverProfile(material, "thin")?.dv, 15);
    assert.equal(getTacticalCoverProfile(material, "thick")?.dv, 15);
  }
  assert.equal(TACTICAL_COVER_PROFILES.length, 10);
  assert.equal(getTacticalCoverProfile("brick", "thin"), null);
  assert.equal(getTacticalCoverProfile("custom", "thick"), null);
});

test("DV de Cover aceita somente inteiros seguros dentro do limite", () => {
  assert.equal(isValidTacticalCoverDV(15), true);
  assert.equal(isValidTacticalCoverDV(null), false);
  assert.equal(isValidTacticalCoverDV(undefined), false);
  assert.equal(isValidTacticalCoverDV("15"), false);
  assert.equal(isValidTacticalCoverDV(15.5), false);
  assert.equal(isValidTacticalCoverDV(Number.NaN), false);
  assert.equal(isValidTacticalCoverDV(Number.POSITIVE_INFINITY), false);
  assert.equal(isValidTacticalCoverDV(-1), false);
  assert.equal(isValidTacticalCoverDV(101), false);
});

test("material e HP não alteram a geometria lógica nem a transparência da porta", () => {
  const openDoor = {
    walls: [],
    doors: [{ id: "door", type: "door" as const, start: { x: 0.5, y: 0.2 }, end: { x: 0.5, y: 0.8 }, thickness: 0.01, state: "open" as const, coverMaterial: "steel" as const, coverHP: 0 }],
  };
  assert.deepEqual(openDoor.doors[0].start, { x: 0.5, y: 0.2 });
  assert.equal(openDoor.doors[0].thickness, 0.01);
  assert.equal(openDoor.doors[0].state, "open");
});

test("dano estrutural da Cover limita HP a zero e não cria dano residual", () => {
  assert.deepEqual(applyTacticalCoverDamage(20, 7), { hpAfter: 13, destroyed: false });
  assert.deepEqual(applyTacticalCoverDamage(8, 17), { hpAfter: 0, destroyed: true });
  assert.deepEqual(applyTacticalCoverDamage(1, 1), { hpAfter: 0, destroyed: true });
  assert.throws(() => applyTacticalCoverDamage(10, -1), /INVALID_COVER_DAMAGE/);
});
