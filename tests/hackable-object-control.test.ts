/** F1.62 — Hackable Object: catálogo tipado, efeito de porta e autoridade do gateway. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HACKABLE_DEVICE_ACTIONS,
  HACKABLE_OBJECT_DENIAL_MESSAGES,
  HACKABLE_OBJECT_EFFECTS,
  HACKABLE_OBJECT_LABELS,
  HACKABLE_OBJECT_TYPES,
  describeHackableObjectControl,
  hackableObjectDoorState,
  isHackableDeviceAction,
  isHackableObjectType,
  normalizeHackableObjectType,
  patchTacticalDoorState,
  resolveHackableObjectDeviceEffect,
} from "../src/lib/mesa/hackableObjects.ts";
import type { NetControlNode, TacticalHackableObject, TacticalMap } from "../src/lib/mesa/types.ts";
import { executeControlDeviceEffect, MesaError } from "../src/lib/mesa/store.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function doorMap(state: "open" | "closed" = "closed"): TacticalMap {
  return {
    imageUrl: "",
    enabled: true,
    width: 1000,
    height: 600,
    pixelsPerMeter: 50,
    geometry: {
      walls: [{ id: "wall-1", type: "wall", start: { x: 0.5, y: 0 }, end: { x: 0.5, y: 0.35 }, thickness: 0.02 }],
      doors: [{ id: "door-1", type: "door", start: { x: 0.5, y: 0.35 }, end: { x: 0.5, y: 0.65 }, thickness: 0.02, state }],
    },
    hackableObjects: [
      { id: "obj-door", type: "door", name: "Porta da Sala", position: { x: 0.45, y: 0.5 }, controlNodeId: "ctrl-1", geometryDoorId: "door-1", active: true },
      { id: "obj-camera", type: "camera", name: "Câmera", position: { x: 0.4, y: 0.2 }, controlNodeId: "ctrl-1", active: true },
    ],
  };
}

const controlledNode: NetControlNode = { id: "ctrl-1", type: "control_node", floorIndex: 1, dv: 10, controlState: "controlled", controlledByNetrunnerId: "netrunner-1" };

test("F1.62 centraliza os tipos em um único catálogo tipado e estável", () => {
  assert.deepEqual([...HACKABLE_OBJECT_TYPES], ["door", "camera", "terminal", "console", "access_panel", "security_system", "generic"]);
  for (const type of HACKABLE_OBJECT_TYPES) {
    assert.equal(isHackableObjectType(type), true);
    assert.equal(typeof HACKABLE_OBJECT_LABELS[type], "string");
    assert.equal(typeof HACKABLE_OBJECT_EFFECTS[type], "object");
  }
  for (const invalid of ["door_panel", "alarm", "turret", "", null, 42]) {
    assert.equal(isHackableObjectType(invalid), false, `${invalid} não pode nascer como tipo novo`);
  }
  // Alias legado existe apenas na leitura de dados já persistidos.
  assert.equal(normalizeHackableObjectType("door_panel"), "door");
  assert.equal(normalizeHackableObjectType("camera"), "camera");
  assert.equal(normalizeHackableObjectType("turret"), null);
});

test("F1.63 somente DOOR e CAMERA têm efeito definido; os demais tipos ficam UNSUPPORTED", () => {
  assert.deepEqual(HACKABLE_OBJECT_EFFECTS.door, { status: "SUPPORTED", actions: ["open", "close"] });
  assert.deepEqual(HACKABLE_OBJECT_EFFECTS.camera, { status: "SUPPORTED", actions: ["enable", "disable"] });
  assert.deepEqual([...HACKABLE_DEVICE_ACTIONS], ["open", "close", "enable", "disable"]);
  for (const type of HACKABLE_OBJECT_TYPES.filter((entry) => entry !== "door" && entry !== "camera")) {
    const effect = HACKABLE_OBJECT_EFFECTS[type];
    assert.equal(effect.status, "UNSUPPORTED", `${type} não pode ganhar efeito sem regra de projeto`);
    assert.deepEqual([...effect.actions], []);
    assert.ok(effect.reason && effect.reason.length > 0, `${type} precisa expor o motivo real`);
    assert.deepEqual(Object.keys(effect).sort(), ["actions", "reason", "status"], `${type} não pode carregar efeito inventado`);
  }
  // Cada tipo só executa as SUAS ações: porta não ativa câmera e vice-versa.
  assert.equal(HACKABLE_OBJECT_EFFECTS.door.actions.includes("enable"), false);
  assert.equal(HACKABLE_OBJECT_EFFECTS.camera.actions.includes("open"), false);
  for (const action of ["destroy", "toggle", "hack", "alarm", "", null]) {
    assert.equal(isHackableDeviceAction(action), false);
  }
});

test("F1.62 CONTROL abre e fecha a MESMA porta física de forma imutável", () => {
  const closed = doorMap("closed");
  const opened = resolveHackableObjectDeviceEffect({ map: closed, objectId: "obj-door", action: "open" });
  assert.equal(opened.ok, true);
  if (!opened.ok || opened.kind !== "door") return;
  assert.equal(opened.doorId, "door-1");
  assert.equal(opened.stateBefore, "closed");
  assert.equal(opened.stateAfter, "open");
  assert.equal(opened.map.geometry?.doors[0].id, "door-1", "a porta continua sendo a mesma entidade");
  assert.equal(opened.map.geometry?.doors.length, 1, "nenhuma porta paralela é criada");
  assert.equal(opened.map.hackableObjects?.[0].geometryDoorId, "door-1");
  assert.equal(closed.geometry?.doors[0].state, "closed", "entrada nunca é mutada");

  const closing = resolveHackableObjectDeviceEffect({ map: opened.map, objectId: "obj-door", action: "close" });
  assert.equal(closing.ok, true);
  if (!closing.ok || closing.kind !== "door") return;
  assert.equal(closing.stateBefore, "open");
  assert.equal(closing.stateAfter, "closed");
  assert.equal(closing.map.geometry?.doors[0].state, "closed");
  assert.equal(hackableObjectDoorState(closing.map, closing.map.hackableObjects![0]), "closed");
});

test("F1.62 o resolvedor rejeita objeto/ação/estado sem transição sem inventar efeito", () => {
  const map = doorMap("closed");
  assert.deepEqual(resolveHackableObjectDeviceEffect({ map, objectId: "missing", action: "open" }), { ok: false, reason: "object_not_found" });
  assert.deepEqual(resolveHackableObjectDeviceEffect({ map, objectId: "obj-camera", action: "open" }), { ok: false, reason: "effect_unsupported" });
  assert.deepEqual(resolveHackableObjectDeviceEffect({ map, objectId: "obj-door", action: "destroy" }), { ok: false, reason: "invalid_action" });
  assert.deepEqual(resolveHackableObjectDeviceEffect({ map, objectId: "obj-door", action: { state: "open" } }), { ok: false, reason: "invalid_action" });
  assert.deepEqual(resolveHackableObjectDeviceEffect({ map: doorMap("open"), objectId: "obj-door", action: "open" }), { ok: false, reason: "already_open" });

  const inactive = { ...map, hackableObjects: (map.hackableObjects ?? []).map((object) => object.id === "obj-door" ? { ...object, active: false } : object) };
  assert.deepEqual(resolveHackableObjectDeviceEffect({ map: inactive, objectId: "obj-door", action: "open" }), { ok: false, reason: "object_inactive" });

  const unlinked = { ...map, hackableObjects: (map.hackableObjects ?? []).map((object) => object.id === "obj-door" ? { ...object, geometryDoorId: undefined } : object) };
  assert.deepEqual(resolveHackableObjectDeviceEffect({ map: unlinked, objectId: "obj-door", action: "open" }), { ok: false, reason: "door_geometry_missing" });

  const broken = { ...map, geometry: { walls: [], doors: [] } };
  assert.deepEqual(resolveHackableObjectDeviceEffect({ map: broken, objectId: "obj-door", action: "open" }), { ok: false, reason: "door_geometry_missing" });

  assert.deepEqual(resolveHackableObjectDeviceEffect({ map: doorMap("closed"), objectId: "obj-door", action: "close" }), { ok: false, reason: "already_closed" });
});

test("F1.62 grava somente o estado da porta no JSON persistido", () => {
  const raw = { imageUrl: "map.png", enabled: true, geometry: { walls: [{ id: "wall-1", type: "wall" }], doors: [{ id: "door-1", type: "door", state: "closed", coverHP: 12 }] }, accessPoints: [{ id: "ap-1" }] };
  const patched = patchTacticalDoorState(raw, "door-1", "open") as typeof raw;
  assert.equal(patched.geometry.doors[0].state, "open");
  assert.equal(patched.geometry.doors[0].coverHP, 12, "nada além do estado é reescrito");
  assert.equal(patched.imageUrl, "map.png");
  assert.equal((raw.geometry.doors[0] as { state: string }).state, "closed");
  assert.equal(patchTacticalDoorState(raw, "missing", "open"), raw, "porta inexistente não altera nada");
  assert.equal(patchTacticalDoorState("nope", "door-1", "open"), "nope");
});

test("F1.62 a UI mostra motivo real e ação disponível sem esconder a ação", () => {
  const map = doorMap("closed");
  const object = map.hackableObjects![0];
  const offline = describeHackableObjectControl({ object, map, netrunner: null, viewerCombatantId: "netrunner-1", controlNode: controlledNode });
  assert.equal(offline.ready, false);
  assert.equal(offline.denial, "jack_in_required");
  assert.equal(offline.message, "JACK IN necessário");
  assert.deepEqual(offline.actions, []);

  const base = { object, map, netrunner: { isJackedIn: true }, viewerCombatantId: "netrunner-1" };
  assert.equal(describeHackableObjectControl({ ...base, controlNode: null }).message, HACKABLE_OBJECT_DENIAL_MESSAGES.control_node_not_discovered);
  assert.equal(describeHackableObjectControl({ ...base, controlNode: null }).denial, "control_node_not_discovered");

  const uncontrolled = describeHackableObjectControl({ ...base, controlNode: { ...controlledNode, controlState: "uncontrolled", controlledByNetrunnerId: undefined } });
  assert.equal(uncontrolled.message, "Control Node não controlado");

  const foreign = describeHackableObjectControl({ ...base, controlNode: { ...controlledNode, controlledByNetrunnerId: "someone-else" } });
  assert.equal(foreign.denial, "no_access");
  assert.equal(foreign.message, "Sem acesso");

  const demon = describeHackableObjectControl({ ...base, controlNode: { ...controlledNode, controlledByDemonId: "demon-1" } });
  assert.equal(demon.denial, "control_node_demon_controlled");

  const ready = describeHackableObjectControl({ ...base, controlNode: controlledNode });
  assert.equal(ready.ready, true);
  assert.equal(ready.denial, null);
  assert.deepEqual(ready.actions, ["open"], "porta fechada oferece ABRIR");
  assert.equal(ready.doorState, "closed");
  assert.equal(ready.effectStatus, "SUPPORTED");

  const opened = describeHackableObjectControl({ ...base, map: doorMap("open"), controlNode: controlledNode });
  assert.deepEqual(opened.actions, ["close"], "porta aberta oferece FECHAR");
  assert.equal(opened.doorState, "open");

  const camera = describeHackableObjectControl({ ...base, object: map.hackableObjects![1], controlNode: controlledNode });
  assert.equal(camera.ready, true, "F1.63: câmera ONLINE é controlável");
  assert.equal(camera.effectStatus, "SUPPORTED");
  assert.equal(camera.cameraState, "online");
  assert.deepEqual(camera.actions, ["disable"], "câmera ONLINE oferece DESATIVAR");

  const cameraDisabled = describeHackableObjectControl({ ...base, object: { ...map.hackableObjects![1], deviceState: "disabled" }, controlNode: controlledNode });
  assert.equal(cameraDisabled.ready, true);
  assert.equal(cameraDisabled.cameraState, "disabled");
  assert.deepEqual(cameraDisabled.actions, ["enable"], "câmera DISABLED oferece ATIVAR");
  assert.equal(cameraDisabled.doorState, null, "câmera nunca tem estado de porta");

  const withoutNode = describeHackableObjectControl({ ...base, object: { ...object, controlNodeId: undefined }, controlNode: controlledNode });
  assert.equal(withoutNode.denial, "control_node_missing");
  assert.equal(withoutNode.controlNodeStatus, "not_linked");

  const inactive = describeHackableObjectControl({ ...base, object: { ...object, active: false }, controlNode: controlledNode });
  assert.equal(inactive.denial, "object_inactive");
});

test("F1.62 o cliente nunca envia estado: o gateway rejeita corpo forjado antes de tocar no banco", async () => {
  await assert.rejects(
    () => executeControlDeviceEffect({ sessionId: "session", token: "token", body: { objectId: "obj-door", action: "open", state: "closed" } }),
    (error: unknown) => error instanceof MesaError && error.code === "client_authority_forbidden" && error.status === 400,
  );
  await assert.rejects(
    () => executeControlDeviceEffect({ sessionId: "session", token: "token", body: { objectId: "obj-door", action: "open", type: "camera", controlNodeId: "ctrl-x", doorState: "open" } }),
    (error: unknown) => error instanceof MesaError && error.code === "client_authority_forbidden",
  );
  await assert.rejects(
    () => executeControlDeviceEffect({ sessionId: "session", token: "token", body: { objectId: "obj-door", action: "toggle" } }),
    (error: unknown) => error instanceof MesaError && error.code === "invalid_device_action" && error.status === 400,
  );
  await assert.rejects(
    () => executeControlDeviceEffect({ sessionId: "session", token: "token", body: { action: "open" } }),
    (error: unknown) => error instanceof MesaError && error.code === "invalid_hackable_object",
  );
});

test("F1.62 regras de gameplay ficam fora dos componentes React e a rota publica Realtime", () => {
  const deviceRoute = readFileSync(resolve(ROOT, "src/app/api/mesa/[id]/combat/net/device/route.ts"), "utf8");
  assert.match(deviceRoute, /executeControlDeviceEffect/);
  assert.match(deviceRoute, /publishMesaState/);
  assert.match(deviceRoute, /if \(changed\)/);

  const panel = readFileSync(resolve(ROOT, "src/components/mesa/player/PlayerNetrunnerPanel.tsx"), "utf8");
  const tacticalView = readFileSync(resolve(ROOT, "src/components/mesa/player/TacticalView.tsx"), "utf8");
  for (const [name, source] of [["PlayerNetrunnerPanel", panel], ["TacticalView", tacticalView]] as const) {
    assert.ok(!source.includes("resolveHackableObjectDeviceEffect"), `${name} não pode conter a regra do efeito`);
    assert.ok(!source.includes("executeControlDeviceEffect"), `${name} não pode chamar o gateway`);
  }
  // O painel só REFLETE o estado autoritativo calculado pelo domínio.
  assert.match(panel, /describeHackableObjectControl/);
  assert.match(panel, /controlMesaDevice/);
});
