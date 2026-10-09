import assert from "node:assert/strict";
import test from "node:test";
import { addTacticalHackableObject, removeTacticalHackableObject, updateTacticalHackableObject } from "../src/lib/mesa/tacticalMap.ts";
import type { TacticalHackableObject, TacticalMap } from "../src/lib/mesa/types.ts";

const map: TacticalMap = { imageUrl: "", enabled: true, width: 1000, height: 600, pixelsPerMeter: 50, hackableObjects: [] };
const object: TacticalHackableObject = { id: "terminal-1", type: "terminal", position: { x: 0.25, y: 0.4 }, name: "Lobby", active: true };

test("objetos hackeáveis usam o mesmo mapa e têm operações imutáveis", () => {
  const added = addTacticalHackableObject(map, object);
  assert.equal(added.hackableObjects?.[0].position.x, 0.25);
  assert.equal(map.hackableObjects?.length, 0);
  const moved = updateTacticalHackableObject(added, object.id, { position: { x: 0.7, y: 0.8 }, controlNodeId: "node-1" });
  assert.deepEqual(moved.hackableObjects?.[0], { ...object, position: { x: 0.7, y: 0.8 }, controlNodeId: "node-1" });
  assert.equal(removeTacticalHackableObject(moved, object.id).hackableObjects?.length, 0);
});
