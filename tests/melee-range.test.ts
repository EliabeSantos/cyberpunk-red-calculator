import assert from "node:assert/strict";
import test from "node:test";

import { formatAttackGatewayError } from "../src/lib/mesa/client.ts";
import { isMeleeAttackType, resolveMeleeRange } from "../src/lib/mesa/tacticalMap.ts";

const map = {
  imageUrl: "",
  enabled: true,
  width: 1000,
  height: 600,
  pixelsPerMeter: 50,
  grid: { enabled: true, size: 2, snap: true },
};

const origin = { x: 0.1, y: 0.2 };

test("melee usa uma célula ortogonal de 2m como adjacência", () => {
  const result = resolveMeleeRange(origin, { x: 0.2, y: 0.2 }, map);
  assert.deepEqual(result, {
    inRange: true,
    reason: "adjacent",
    distanceMeters: 2,
    cellSizeMeters: 2,
  });
});

test("diagonalmente adjacente também está ao alcance sem usar <= 2m euclidiano", () => {
  const result = resolveMeleeRange(origin, { x: 0.2, y: 0.2 + 1 / 6 }, map);
  assert.equal(result.inRange, true);
  assert.equal(result.reason, "adjacent");
  // Os centros estão a √(2² + 2²) e continuam em células vizinhas.
  assert.equal(result.distanceMeters, 3);
});

test("o segundo quadrado fica fora do alcance corpo a corpo", () => {
  const result = resolveMeleeRange(origin, { x: 0.3, y: 0.2 }, map);
  assert.equal(result.inRange, false);
  assert.equal(result.reason, "out_of_range");
  assert.equal(result.distanceMeters, 4);
});

test("posições contínuas usam a mesma escala e aceitam a célula diagonal", () => {
  assert.equal(resolveMeleeRange(origin, { x: 0.19, y: 0.2 + 0.15 }, map).inRange, true);
  // 2,1m entre centros ainda deixa 1,1m entre as bordas dos tokens.
  assert.equal(resolveMeleeRange(origin, { x: 0.205, y: 0.2 }, map).inRange, true);
});

test("alcance considera as bordas dos tokens, não apenas os centros", () => {
  // 2,5m entre centros: sem o footprint ficaria fora de uma célula de 2m;
  // com os tokens encostando, a distância entre bordas é 1,5m.
  const touching = resolveMeleeRange(origin, { x: 0.225, y: 0.2 }, map);
  assert.equal(touching.inRange, true);
  assert.equal(touching.distanceMeters, 3);

  // O segundo quadrado continua fora mesmo descontando o diâmetro visual.
  assert.equal(resolveMeleeRange(origin, { x: 0.3, y: 0.2 }, map).inRange, false);
});

test("melee, Brawling, Martial Arts e weaponless compartilham o mesmo classificador", () => {
  assert.equal(isMeleeAttackType("melee", "melee_weapon"), true);
  assert.equal(isMeleeAttackType("brawling", "brawling"), true);
  assert.equal(isMeleeAttackType("martial_arts", "martial_arts"), true);
  assert.equal(isMeleeAttackType("unarmed", "brawling"), true);
  assert.equal(isMeleeAttackType("weaponless", "brawling"), true);
  assert.equal(isMeleeAttackType("handgun", "handgun"), false);
});

test("o resolver ignora qualquer inRange fabricado pelo cliente", () => {
  const tamperedMap = { ...map, inRange: true } as typeof map & { inRange: true };
  const result = resolveMeleeRange(origin, { x: 0.3, y: 0.2 }, tamperedMap);
  assert.equal(result.inRange, false);
  assert.equal(result.reason, "out_of_range");
});

test("o gateway expõe erro específico sem criar Range DV para melee", () => {
  assert.equal(
    formatAttackGatewayError("Alvo fora do alcance corpo a corpo.", "melee_out_of_range"),
    "FORA DO ALCANCE CORPO A CORPO — aproxime-se de uma casa adjacente.",
  );
});
