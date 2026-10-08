import assert from "node:assert/strict";
import test from "node:test";
import { nextFloorAfterUnlockedPassword, normalizeNetArchitecture, normalizeNetDiscovery, pathfinderNodeIds, projectNetArchitecture } from "../src/lib/mesa/netArchitecture.ts";

const architecture = normalizeNetArchitecture({
  id: "arch-1",
  name: "Arasaka",
  floors: [
    { id: "floor-1", index: 1, nodes: [
      { id: "lobby-1", type: "lobby", floorIndex: 1, name: "Lobby" },
      { id: "file-1", type: "file", floorIndex: 1, name: "Segredo", content: "privado" },
      { id: "pass-1", type: "password", floorIndex: 1, dv: 14, state: "locked" },
      { id: "ice-1", type: "black_ice", floorIndex: 1, name: "ICE" },
      { id: "demon-1", type: "demon", floorIndex: 1, name: "Demon" },
    ] },
    { id: "floor-2", index: 2, nodes: [{ id: "control-1", type: "control_node", floorIndex: 2, deviceReference: "door-1" }] },
  ],
});

test("arquitetura linear valida Floor 1, tipos estruturais e rejeita duplicidade/índice inválido", () => {
  assert.ok(architecture);
  assert.equal(architecture?.floors[0].index, 1);
  assert.equal(architecture?.floors[1].nodes[0].type, "control_node");
  assert.equal(normalizeNetArchitecture({ ...architecture, floors: [{ ...architecture!.floors[0], index: 2 }] }), null);
  assert.equal(normalizeNetArchitecture({ ...architecture, floors: [{ ...architecture!.floors[0], nodes: [...architecture!.floors[0].nodes, architecture!.floors[0].nodes[0]] }, architecture!.floors[1]] }), null);
});

test("descoberta é individual e projeção Player não vaza Nodes, File ou Password privados", () => {
  assert.ok(architecture);
  const playerA = projectNetArchitecture(architecture!, 1, normalizeNetDiscovery({ architectureId: "arch-1", discoveredNodeIds: ["lobby-1", "file-1"] }, "arch-1"), false);
  const playerB = projectNetArchitecture(architecture!, 1, normalizeNetDiscovery({ architectureId: "arch-1", discoveredNodeIds: ["lobby-1"] }, "arch-1"), false);
  assert.deepEqual(playerA.nodes.map((node) => node.id), ["lobby-1", "file-1"]);
  assert.equal((playerA.nodes.find((node) => node.id === "file-1") as { content?: string }).content, "privado");
  assert.deepEqual(playerB.nodes.map((node) => node.id), ["lobby-1"]);
  assert.equal("floors" in playerB, false);
});

test("GM recebe a arquitetura completa, sem criar regras de combate", () => {
  const gm = projectNetArchitecture(architecture!, 1, normalizeNetDiscovery(null, "arch-1"), true);
  assert.equal(gm.administrative, true);
  assert.equal(gm.floors?.length, 2);
  assert.equal(gm.floors?.[0].nodes.find((node) => node.type === "password")?.type, "password");
  assert.equal(gm.floors?.[0].nodes.find((node) => node.type === "black_ice")?.type, "black_ice");
});

test("Pathfinder respeita profundidade configurada e para em Password locked", () => {
  const configured = normalizeNetArchitecture({ ...architecture, pathfinder: { dv: 12, discoveryDepth: 3 } });
  assert.ok(configured);
  assert.deepEqual(pathfinderNodeIds(configured!, 1), ["lobby-1", "file-1", "pass-1", "ice-1", "demon-1"]);
  const unlocked = normalizeNetArchitecture({ ...configured, floors: configured!.floors.map((floor) => ({ ...floor, nodes: floor.nodes.map((node) => node.type === "password" ? { ...node, state: "unlocked" } : node) })) });
  assert.equal(nextFloorAfterUnlockedPassword(unlocked!, 1), 2);
});

test("Control Node mantém somente estado estrutural e File descoberto pode continuar sem conteúdo", () => {
  const configured = normalizeNetArchitecture({ ...architecture, floors: architecture!.floors.map((floor) => ({ ...floor, nodes: floor.nodes.map((node) => node.type === "control_node" ? { ...node, dv: 10 } : node) })) });
  assert.equal(configured?.floors[1].nodes[0].type, "control_node");
  const projection = projectNetArchitecture(configured!, 1, { architectureId: "arch-1", discoveredNodeIds: ["file-1"], revealedFileIds: [] }, false);
  assert.equal((projection.nodes[0] as { content?: string }).content, undefined);
});

test("Demon é persistido na Architecture e a associação Control Node é derivada/validada no servidor", () => {
  const configured = normalizeNetArchitecture({
    id: "arch-demon", name: "Demon Net", floors: [{ id: "floor-1", index: 1, nodes: [
      { id: "demon-node", type: "demon", floorIndex: 1, demon: { id: "demon-core", name: "Core Demon", state: "active" } },
      { id: "control-node", type: "control_node", floorIndex: 1, dv: 12, controlledByDemonId: "demon-core" },
    ] }],
  });
  assert.equal(configured?.floors[0].nodes.find((node) => node.type === "control_node")?.controlledByDemonId, "demon-core");
  const demon = configured?.floors[0].nodes.find((node) => node.type === "demon");
  assert.deepEqual(demon?.type === "demon" ? demon.demon?.controlledNodeIds : [], ["control-node"]);
  assert.equal(normalizeNetArchitecture({
    id: "invalid", name: "Invalid", floors: [{ id: "floor-1", index: 1, nodes: [
      { id: "control-node", type: "control_node", floorIndex: 1, controlledByDemonId: "missing" },
    ] }],
  }), null);
});

test("Relação Demon/Control Node respeita descoberta privada do Player", () => {
  const configured = normalizeNetArchitecture({
    id: "arch-private", name: "Private Demon Net", floors: [{ id: "floor-1", index: 1, nodes: [
      { id: "demon-node", type: "demon", floorIndex: 1, demon: { id: "demon-core", name: "Core Demon", state: "active" } },
      { id: "control-node", type: "control_node", floorIndex: 1, controlledByDemonId: "demon-core" },
    ] }],
  });
  assert.ok(configured);
  const controlOnly = projectNetArchitecture(configured!, 1, { architectureId: "arch-private", discoveredNodeIds: ["control-node"] }, false);
  assert.equal((controlOnly.nodes[0] as { controlledByDemonId?: string }).controlledByDemonId, undefined);
  const both = projectNetArchitecture(configured!, 1, { architectureId: "arch-private", discoveredNodeIds: ["control-node", "demon-node"] }, false);
  const bothControl = both.nodes.find((node) => node.id === "control-node") as { controlledByDemonId?: string };
  assert.equal(bothControl.controlledByDemonId, "demon-core");
});
