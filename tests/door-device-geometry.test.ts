/**
 * F1.62 — Porta do HACKABLE OBJECT × geometria tática existente.
 *
 * Regras verificadas aqui:
 * 1. LOS, movimento e cover reagem ao estado `open`/`closed` de
 *    `TacticalGeometry.doors[].state` (fonte autoritativa única), calculado
 *    pelo `TacticalGeometry` existente.
 * 2. Abrir/fechar via device effect altera a MESMA entidade da porta — não
 *    existe `HackableDoorGeometry` nem um segundo estado de porta.
 * 3. O objeto Hackable não guarda estado lógico duplicado.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  HACKABLE_OBJECT_TYPES,
  patchTacticalDoorState,
  resolveHackableObjectDeviceEffect,
} from "@/lib/mesa/hackableObjects";
import type { TacticalGeometry, TacticalHackableObject, TacticalMap, TacticalPoint } from "@/lib/mesa/types";
import { calculateLineOfSight, calculateTacticalCover, validateMovementPath } from "@/lib/mesa/tacticalGeometry";

/** Porta vertical no meio do mapa (coords normalizadas 0..1). */
function doorGeometry(state: "open" | "closed"): TacticalGeometry {
  return {
    walls: [],
    doors: [
      {
        id: "door-1",
        type: "door",
        start: { x: 0.5, y: 0.2 },
        end: { x: 0.5, y: 0.8 },
        state,
      },
    ],
  };
}

function mapWithDoor(state: "open" | "closed"): TacticalMap {
  return {
    imageUrl: "",
    enabled: true,
    width: 1,
    height: 1,
    pixelsPerMeter: 1,
    geometry: doorGeometry(state),
    hackableObjects: [],
  };
}

const LEFT: TacticalPoint = { x: 0.3, y: 0.5 };
const RIGHT: TacticalPoint = { x: 0.7, y: 0.5 };

function doorObject(overrides: Partial<TacticalHackableObject> = {}): TacticalHackableObject {
  return {
    id: "obj-door",
    type: "door",
    name: "Porta do Corredor",
    position: { x: 0.5, y: 0.5 },
    active: true,
    controlNodeId: "ctrl-1",
    geometryDoorId: "door-1",
    ...overrides,
  };
}

function runDevice(map: TacticalMap, objectId: string, action: unknown) {
  return resolveHackableObjectDeviceEffect({ map, objectId, action });
}

/** Narrowing: este arquivo exercita apenas o efeito de porta (ramo `door`). */
function expectDoor(resolution: ReturnType<typeof resolveHackableObjectDeviceEffect>) {
  assert.equal(resolution.ok, true, JSON.stringify(resolution));
  assert.equal(resolution.ok && resolution.kind, "door");
  if (!resolution.ok || resolution.kind !== "door") throw new Error("resolução não é de porta");
  return resolution;
}

test("LOS: porta fechada bloqueia, porta aberta permite (TacticalGeometry existente)", () => {
  assert.equal(calculateLineOfSight(LEFT, RIGHT, doorGeometry("closed")).visible, false);
  assert.equal(calculateLineOfSight(LEFT, RIGHT, doorGeometry("open")).visible, true);
});

test("movimento: porta fechada com blocksMovement impede cruzar; aberta permite", () => {
  assert.equal(validateMovementPath(LEFT, RIGHT, doorGeometry("closed")).valid, false);
  assert.equal(validateMovementPath(LEFT, RIGHT, doorGeometry("closed")).blockedBy?.id, "door-1");
  assert.equal(validateMovementPath(LEFT, RIGHT, doorGeometry("open")).valid, true);
});

test("cover: usa a geometria existente (sem HackableDoorGeometry)", () => {
  assert.equal(calculateTacticalCover(LEFT, RIGHT, doorGeometry("closed")).status, "full_cover");
  assert.equal(calculateTacticalCover(LEFT, RIGHT, doorGeometry("open")).status, "clear");
  assert.ok("doors" in doorGeometry("closed"));
});

test("object + geometry: o device effect altera a MESMA entidade da porta", () => {
  const object = doorObject();
  const map: TacticalMap = { ...mapWithDoor("closed"), hackableObjects: [object] };

  const open = expectDoor(runDevice(map, "obj-door", "open"));
  assert.equal(open.map.geometry?.doors[0].id, "door-1");
  assert.equal(open.map.geometry?.doors[0].state, "open");
  assert.equal(open.stateBefore, "closed");
  assert.equal(open.stateAfter, "open");
  assert.equal(open.objectName, "Porta do Corredor");

  // Porta aberta deixa de bloquear LOS, movimento e cover.
  assert.equal(calculateLineOfSight(LEFT, RIGHT, open.map.geometry!).visible, true);
  assert.equal(validateMovementPath(LEFT, RIGHT, open.map.geometry!).valid, true);
  assert.equal(calculateTacticalCover(LEFT, RIGHT, open.map.geometry!).status, "clear");

  // Fechar devolve o bloqueio.
  const close = expectDoor(runDevice(open.map, "obj-door", "close"));
  assert.equal(close.map.geometry?.doors[0].state, "closed");
  assert.equal(calculateLineOfSight(LEFT, RIGHT, close.map.geometry!).visible, false);
  assert.equal(validateMovementPath(LEFT, RIGHT, close.map.geometry!).valid, false);
  assert.equal(calculateTacticalCover(LEFT, RIGHT, close.map.geometry!).covered, true);
});

test("transição repetida é recusada sem mutar o mapa (already_open / already_closed)", () => {
  const map: TacticalMap = { ...mapWithDoor("closed"), hackableObjects: [doorObject()] };
  const again = runDevice(map, "obj-door", "close");
  assert.equal(again.ok, false);
  assert.equal(again.ok === false && again.reason, "already_closed");
  assert.equal(map.geometry?.doors[0].state, "closed");

  const opened = expectDoor(runDevice(map, "obj-door", "open"));
  const repeat = runDevice(opened.map, "obj-door", "open");
  assert.equal(repeat.ok, false);
  assert.equal(repeat.ok === false && repeat.reason, "already_open");
  assert.equal(opened.map.geometry?.doors[0].state, "open");
});

test("patchTacticalDoorState altera só o campo de estado no JSON persistido", () => {
  const raw = JSON.parse(JSON.stringify(mapWithDoor("closed"))) as unknown;
  const next = patchTacticalDoorState(raw, "door-1", "open") as TacticalMap;
  assert.equal(next.geometry?.doors[0].state, "open");
  // Nada além de geometry.doors[].state foi tocado.
  assert.deepEqual(Object.keys(next).sort(), Object.keys(raw as TacticalMap).sort());
  assert.deepEqual(next.geometry?.walls, []);

  // Porta inexistente ou já no estado desejado: payload devolvido intacto.
  assert.equal(patchTacticalDoorState(raw, "door-x", "open"), raw);
  assert.equal(patchTacticalDoorState(raw, "door-1", "closed"), raw);
  assert.equal(patchTacticalDoorState(null, "door-1", "open"), null);
});

test("catálogo: exatamente os tipos definidos, sem tipo inventado", () => {
  assert.deepEqual([...HACKABLE_OBJECT_TYPES], [
    "door",
    "camera",
    "terminal",
    "console",
    "access_panel",
    "security_system",
    "generic",
  ]);
});

test("porta sem geometria vinculada: recusa com door_geometry_missing (não inventa porta)", () => {
  const map: TacticalMap = { ...mapWithDoor("closed"), hackableObjects: [doorObject({ geometryDoorId: undefined })] };
  const out = runDevice(map, "obj-door", "open");
  assert.equal(out.ok, false);
  assert.equal(out.ok === false && out.reason, "door_geometry_missing");
  assert.equal(map.geometry?.doors[0].state, "closed");

  const dangling = runDevice(
    { ...map, hackableObjects: [doorObject({ geometryDoorId: "door-x" })] },
    "obj-door",
    "open",
  );
  assert.equal(dangling.ok, false);
  assert.equal(dangling.ok === false && dangling.reason, "door_geometry_missing");
});

test("objeto não encontrado/inativo/tipo inválido: recusas explícitas", () => {
  const map: TacticalMap = { ...mapWithDoor("closed"), hackableObjects: [doorObject()] };
  assert.equal(runDevice(map, "nope", "open").ok, false);
  const inactive = runDevice({ ...map, hackableObjects: [doorObject({ active: false })] }, "obj-door", "open");
  assert.equal(inactive.ok === false && inactive.reason, "object_inactive");
  const badAction = runDevice(map, "obj-door", "destroy");
  assert.equal(badAction.ok === false && badAction.reason, "invalid_action");
  const badType = runDevice(
    { ...map, hackableObjects: [doorObject({ type: "camera" as never })] },
    "obj-door",
    "open",
  );
  assert.equal(badType.ok === false && badType.reason, "effect_unsupported");
});

test("o objeto Hackable não guarda estado lógico duplicado (shape conceitual)", () => {
  const object = doorObject();
  const keys = Object.keys(object).sort();
  assert.deepEqual(keys, [
    "active",
    "controlNodeId",
    "geometryDoorId",
    "id",
    "name",
    "position",
    "type",
  ]);
  assert.equal("state" in object, false);
  assert.equal("discovered" in object, false);
  assert.equal("status" in object, false);
  assert.equal("controlledByNetrunnerId" in object, false);
  // Identidade estável: id não é derivado de tipo/nome/posição.
  assert.equal(object.id, "obj-door");
  assert.equal(doorObject().id, object.id, "id é estável entre leituras");
  assert.notEqual(object.id, object.type);
  const moved = { ...object, type: "terminal" as const, name: "Outro nome", position: { x: 0.9, y: 0.1 } };
  assert.equal(moved.id, object.id, "id sobrevive a mudança de tipo/nome/posição");
});
