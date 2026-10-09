/**
 * F1.63 — Câmera do HACKABLE OBJECT: CONTROL → CAMERA ONLINE/DISABLED.
 *
 * Regras verificadas aqui:
 * 1. A câmera inicia ONLINE por padrão e o estado ONLINE/DISABLED é
 *    autoritativo, em uma única cópia (`deviceState`).
 * 2. A câmera NÃO é geometria: não vira parede/porta, não cria colisão e não
 *    altera movimento, cover, distância ou range.
 * 3. A integração com Detection/Visibility respeita o contrato existente:
 *    ONLINE pode ser CONSIDERADA observadora; DISABLED não gera observações.
 *    A resolução numérica permanece UNSUPPORTED — nenhuma regra é inventada.
 * 4. Não existe segundo algoritmo de Detection, de Visibility ou de LOS.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CAMERA_DEVICE_ACTIONS,
  CAMERA_DEVICE_STATES,
  DEFAULT_CAMERA_DEVICE_STATE,
  HACKABLE_OBJECT_EFFECTS,
  cameraObservationEligibility,
  cameraObserverRef,
  describeHackableObjectControl,
  hackableCameraStateIsExplicit,
  hackableObjectCameraState,
  patchHackableCameraState,
  resolveHackableObjectDeviceEffect,
} from "@/lib/mesa/hackableObjects";
import type { NetControlNode, TacticalHackableObject, TacticalMap } from "@/lib/mesa/types";
import { calculateLineOfSight, calculateTacticalCover, validateMovementPath } from "@/lib/mesa/tacticalGeometry";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Porta vertical + câmera no mapa: a câmera nunca entra na geometria. */
function cameraMap(overrides: Partial<TacticalHackableObject> = {}): TacticalMap {
  return {
    imageUrl: "",
    enabled: true,
    width: 1,
    height: 1,
    pixelsPerMeter: 1,
    geometry: {
      walls: [{ id: "wall-1", type: "wall", start: { x: 0.5, y: 0 }, end: { x: 0.5, y: 0.35 }, thickness: 0.02 }],
      doors: [{ id: "door-1", type: "door", start: { x: 0.5, y: 0.35 }, end: { x: 0.5, y: 0.65 }, thickness: 0.02, state: "closed" }],
    },
    hackableObjects: [
      { id: "obj-camera", type: "camera", name: "Câmera do Corredor", position: { x: 0.4, y: 0.2 }, controlNodeId: "ctrl-1", active: true, ...overrides },
      { id: "obj-door", type: "door", name: "Porta", position: { x: 0.45, y: 0.5 }, controlNodeId: "ctrl-1", geometryDoorId: "door-1", active: true },
    ],
  };
}

function camera(map: TacticalMap): TacticalHackableObject {
  return (map.hackableObjects ?? []).find((entry) => entry.id === "obj-camera")!;
}

const controlledNode: NetControlNode = { id: "ctrl-1", type: "control_node", floorIndex: 1, dv: 10, controlState: "controlled", controlledByNetrunnerId: "netrunner-1" };

function runCamera(map: TacticalMap, action: unknown) {
  return resolveHackableObjectDeviceEffect({ map, objectId: "obj-camera", action });
}

test("F1.63 câmera inicia ONLINE por padrão e o catálogo a trata com enable/disable", () => {
  assert.deepEqual([...CAMERA_DEVICE_STATES], ["online", "disabled"]);
  assert.deepEqual([...CAMERA_DEVICE_ACTIONS], ["enable", "disable"]);
  assert.equal(DEFAULT_CAMERA_DEVICE_STATE, "online");
  assert.deepEqual(HACKABLE_OBJECT_EFFECTS.camera, { status: "SUPPORTED", actions: ["enable", "disable"] });

  // Câmera criada sem nada persistido nasce ONLINE.
  assert.equal(hackableObjectCameraState(camera(cameraMap())), "online");
  assert.equal(hackableObjectCameraState({ id: "c", type: "camera", position: { x: 0.1, y: 0.1 }, active: true }), "online");
  // Estado persistido é respeitado; estado inválido cai no default.
  assert.equal(hackableObjectCameraState(camera(cameraMap({ deviceState: "disabled" }))), "disabled");
  assert.equal(hackableObjectCameraState(camera(cameraMap({ deviceState: "qualquer" as never }))), "online");
  // Somente câmera tem estado de dispositivo.
  assert.equal(hackableObjectCameraState((cameraMap().hackableObjects ?? [])[1]!), null);
});

test("F1.63 CONTROL desativa e reativa a MESMA câmera, de forma imutável", () => {
  const online = cameraMap();
  const disabled = runCamera(online, "disable");
  assert.equal(disabled.ok, true, JSON.stringify(disabled));
  assert.ok(disabled.ok && disabled.kind === "camera");
  assert.equal(disabled.cameraStateBefore, "online");
  assert.equal(disabled.cameraStateAfter, "disabled");
  assert.equal(disabled.objectId, "obj-camera");
  assert.equal(disabled.objectName, "Câmera do Corredor");
  assert.equal(disabled.map.hackableObjects?.length, 2, "nenhuma câmera paralela é criada");
  assert.equal(disabled.map.hackableObjects?.find((entry) => entry.id === "obj-camera")?.id, "obj-camera", "a câmera continua sendo a mesma entidade");
  assert.equal(hackableObjectCameraState(camera(disabled.map)), "disabled");
  assert.equal(online.hackableObjects?.find((entry) => entry.id === "obj-camera")?.deviceState, undefined, "a entrada nunca é mutada");

  const reenabled = runCamera(disabled.map, "enable");
  assert.ok(reenabled.ok && reenabled.kind === "camera");
  assert.equal(reenabled.cameraStateBefore, "disabled");
  assert.equal(reenabled.cameraStateAfter, "online");
  assert.equal(hackableObjectCameraState(camera(reenabled.map)), "online");
});

test("F1.63 transição repetida é recusada sem mutar o mapa", () => {
  const online = cameraMap();
  assert.deepEqual(runCamera(online, "enable"), { ok: false, reason: "already_online" });

  const disabled = runCamera(online, "disable");
  assert.ok(disabled.ok && disabled.kind === "camera");
  assert.deepEqual(runCamera(disabled.map, "disable"), { ok: false, reason: "already_disabled" });
  assert.equal(hackableObjectCameraState(camera(disabled.map)), "disabled");

  // Objeto inexistente, inativo e ação inválida continuam recusados.
  assert.deepEqual(resolveHackableObjectDeviceEffect({ map: online, objectId: "missing", action: "disable" }), { ok: false, reason: "object_not_found" });
  const inactive = { ...online, hackableObjects: (online.hackableObjects ?? []).map((entry) => entry.id === "obj-camera" ? { ...entry, active: false } : entry) };
  assert.deepEqual(runCamera(inactive, "disable"), { ok: false, reason: "object_inactive" });
  assert.deepEqual(runCamera(online, "toggle"), { ok: false, reason: "invalid_action" });
  assert.deepEqual(runCamera(online, { deviceState: "disabled" }), { ok: false, reason: "invalid_action" });
});

test("F1.63 cada tipo só executa as SUAS ações: porta não ativa câmera, câmera não abre porta", () => {
  const map = cameraMap();
  const door = (map.hackableObjects ?? [])[1]!;
  // Ação de câmera numa porta é UNSUPPORTED.
  assert.deepEqual(resolveHackableObjectDeviceEffect({ map, objectId: door.id, action: "enable" }), { ok: false, reason: "effect_unsupported" });
  assert.deepEqual(resolveHackableObjectDeviceEffect({ map, objectId: door.id, action: "disable" }), { ok: false, reason: "effect_unsupported" });
  // Ação de porta numa câmera continua UNSUPPORTED (regressão F1.62).
  assert.deepEqual(runCamera(map, "open"), { ok: false, reason: "effect_unsupported" });
  assert.deepEqual(runCamera(map, "close"), { ok: false, reason: "effect_unsupported" });
});

test("F1.63 patchHackableCameraState altera somente deviceState no JSON persistido", () => {
  const raw = JSON.parse(JSON.stringify(cameraMap())) as unknown;
  const next = patchHackableCameraState(raw, "obj-camera", "disabled") as TacticalMap;
  assert.equal(hackableObjectCameraState(camera(next)), "disabled");
  // Nada além de hackableObjects[].deviceState foi tocado.
  assert.deepEqual(Object.keys(next).sort(), Object.keys(raw as TacticalMap).sort());
  assert.deepEqual(next.geometry, (raw as TacticalMap).geometry, "a geometria permanece intacta");
  assert.deepEqual(next.hackableObjects?.find((entry) => entry.id === "obj-door"), (raw as TacticalMap).hackableObjects?.find((entry) => entry.id === "obj-door"));

  // Id inexistente ou estado já aplicado: payload devolvido intacto.
  assert.equal(patchHackableCameraState(raw, "obj-x", "disabled"), raw);
  assert.equal(patchHackableCameraState(null, "obj-camera", "disabled"), null);
  assert.equal(patchHackableCameraState("nope", "obj-camera", "disabled"), "nope");

  // Com a chave já materializada, regravar o mesmo estado não muda nada.
  const explicit = patchHackableCameraState(raw, "obj-camera", "online");
  assert.equal(patchHackableCameraState(explicit, "obj-camera", "online"), explicit);
  assert.equal(hackableObjectCameraState(camera(explicit as TacticalMap)), "online");
});

test("F1.63 hackableCameraStateIsExplicit distingue chave materializada de mapa legado", () => {
  const raw = JSON.parse(JSON.stringify(cameraMap())) as unknown;
  assert.equal(hackableCameraStateIsExplicit(raw, "obj-camera"), false, "mapa anterior à fase não tem a chave");
  const patched = patchHackableCameraState(raw, "obj-camera", "online");
  assert.equal(hackableCameraStateIsExplicit(patched, "obj-camera"), true, "após a primeira gravação a chave existe");
  assert.equal(hackableCameraStateIsExplicit(patched, "obj-door"), false, "porta nunca ganha deviceState");
  assert.equal(hackableCameraStateIsExplicit(null, "obj-camera"), false);
});

test("F1.63 câmera não é geometria: LOS, movimento e cover ficam intactos", () => {
  const map = cameraMap();
  const before = JSON.stringify(map.geometry);

  const disabled = runCamera(map, "disable");
  assert.ok(disabled.ok && disabled.kind === "camera");
  assert.equal(JSON.stringify(disabled.map.geometry), before, "desativar câmera não toca a geometria");
  assert.equal((disabled.map.geometry?.doors ?? []).some((entry) => entry.id === "obj-camera"), false, "câmera nunca vira porta");
  assert.equal((disabled.map.geometry?.walls ?? []).some((entry) => entry.id === "obj-camera"), false, "câmera nunca vira parede");

  const LEFT = { x: 0.4, y: 0.5 };
  const RIGHT = { x: 0.6, y: 0.5 };
  // O comportamento geométrico é exatamente o da porta fechada existente.
  assert.equal(calculateLineOfSight(LEFT, RIGHT, disabled.map.geometry!).visible, false);
  assert.equal(validateMovementPath(LEFT, RIGHT, disabled.map.geometry!).valid, false);
  assert.equal(calculateTacticalCover(LEFT, RIGHT, disabled.map.geometry!).covered, true);

  const enabled = runCamera(disabled.map, "enable");
  assert.ok(enabled.ok && enabled.kind === "camera");
  assert.equal(JSON.stringify(enabled.map.geometry), before, "ativar câmera também não toca a geometria");
});

test("F1.63 a UI da câmera mostra ONLINE/DISABLED e a ação correta, sem esconder o motivo", () => {
  const map = cameraMap();
  const base = { map, netrunner: { isJackedIn: true }, viewerCombatantId: "netrunner-1", controlNode: controlledNode };

  const online = describeHackableObjectControl({ ...base, object: camera(map) });
  assert.equal(online.ready, true);
  assert.equal(online.cameraState, "online");
  assert.equal(online.doorState, null, "câmera nunca expõe estado de porta");
  assert.deepEqual(online.actions, ["disable"], "ONLINE oferece DESATIVAR CÂMERA");
  assert.equal(online.effectStatus, "SUPPORTED");

  const disabled = describeHackableObjectControl({ ...base, object: camera({ ...map, hackableObjects: (map.hackableObjects ?? []).map((entry) => entry.id === "obj-camera" ? { ...entry, deviceState: "disabled" as const } : entry) }) });
  assert.equal(disabled.ready, true);
  assert.equal(disabled.cameraState, "disabled");
  assert.deepEqual(disabled.actions, ["enable"], "DISABLED oferece ATIVAR CÂMERA");

  // As recusas continuam mostrando o motivo real.
  const offline = describeHackableObjectControl({ object: camera(map), map, netrunner: null, viewerCombatantId: "netrunner-1", controlNode: controlledNode });
  assert.equal(offline.ready, false);
  assert.equal(offline.message, "JACK IN necessário");
  assert.deepEqual(offline.actions, []);

  const noNode = describeHackableObjectControl({ ...base, object: camera(map), controlNode: null });
  assert.equal(noNode.message, "Control Node não descoberto");
});

test("F1.63 DETECTION: ONLINE pode ser considerada observadora; DISABLED não gera observações", () => {
  const map = cameraMap();

  const online = cameraObservationEligibility(camera(map), map);
  assert.equal(online.eligible, true, "câmera ONLINE pode ser CONSIDERADA observadora");
  assert.equal(online.state, "online");
  // A resolução numérica NÃO existe: nenhuma regra de Perception/alcance/cone.
  assert.equal(online.support, "UNSUPPORTED", "sem regra definida, nada é resolvido");
  assert.ok(online.reason && online.reason.length > 0, "o motivo real fica explícito");

  const disabledMap = { ...map, hackableObjects: (map.hackableObjects ?? []).map((entry) => entry.id === "obj-camera" ? { ...entry, deviceState: "disabled" as const } : entry) };
  const disabled = cameraObservationEligibility(camera(disabledMap), disabledMap);
  assert.equal(disabled.eligible, false, "câmera DISABLED não gera observações/detecções");
  assert.equal(disabled.state, "disabled");

  const inactiveMap = { ...map, hackableObjects: (map.hackableObjects ?? []).map((entry) => entry.id === "obj-camera" ? { ...entry, active: false } : entry) };
  assert.equal(cameraObservationEligibility(camera(inactiveMap), inactiveMap).eligible, false);

  // Só câmeras entram na vigilância.
  const door = (map.hackableObjects ?? [])[1]!;
  assert.equal(cameraObservationEligibility(door, map).eligible, false);
  assert.equal(cameraObservationEligibility(door, map).state, null);

  // A identidade de observer só existe para câmera ONLINE e ativa.
  assert.deepEqual(cameraObserverRef(camera(map), map), { kind: "camera", objectId: "obj-camera" });
  assert.equal(cameraObserverRef(camera(disabledMap), disabledMap), null);
  assert.equal(cameraObserverRef(door, map), null);
});

test("F1.63 não existe segundo algoritmo de Detection, Visibility ou LOS", () => {
  const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const detection = stripComments(readFileSync(resolve(ROOT, "src/lib/mesa/detection.ts"), "utf8"));
  const visibility = stripComments(readFileSync(resolve(ROOT, "src/lib/mesa/visibility.ts"), "utf8"));
  const tacticalGeometry = stripComments(readFileSync(resolve(ROOT, "src/lib/mesa/tacticalGeometry.ts"), "utf8"));
  const hackableObjects = stripComments(readFileSync(resolve(ROOT, "src/lib/mesa/hackableObjects.ts"), "utf8"));

  // Stealth/Perception permanecem exatamente como estavam.
  for (const [name, source] of [["detection", detection], ["visibility", visibility], ["tacticalGeometry", tacticalGeometry]] as const) {
    assert.ok(!/camera|câmera|hackable|deviceState/i.test(source), `${name} não pode conhecer câmeras`);
  }

  // O módulo de Hackable Objects não chama nem reimplementa o detector.
  for (const fn of ["resolveDetectionCheck", "rollPerceptionCheck", "rollStealthCheck"]) {
    assert.ok(!hackableObjects.includes(fn), `hackableObjects não pode chamar ${fn}`);
  }
  // A identidade de observer é só um rótulo: nenhum número de detecção é produzido.
  assert.ok(!/observerPerception|targetStealth/.test(hackableObjects), "nenhuma Perception/Stealth inventada");
});

test("F1.63 regras de gameplay ficam fora dos componentes React e o cliente envia só intenção", () => {
  const panel = readFileSync(resolve(ROOT, "src/components/mesa/player/PlayerNetrunnerPanel.tsx"), "utf8");
  const tacticalView = readFileSync(resolve(ROOT, "src/components/mesa/player/TacticalView.tsx"), "utf8");
  for (const [name, source] of [["PlayerNetrunnerPanel", panel], ["TacticalView", tacticalView]] as const) {
    assert.ok(!source.includes("resolveHackableObjectDeviceEffect"), `${name} não pode conter a regra do efeito`);
    assert.ok(!source.includes("executeControlDeviceEffect"), `${name} não pode chamar o gateway`);
    assert.ok(!source.includes("cameraObservationEligibility"), `${name} não pode decidir vigilância`);
  }
  // O SVG só reflete estado visual; não decide efeito nem vigilância.
  assert.ok(tacticalView.includes("is-camera-offline"), "o mapa reflete o estado visual da câmera");

  const client = readFileSync(resolve(ROOT, "src/lib/mesa/client.ts"), "utf8");
  assert.match(client, /objectId: input\.objectId, action: input\.action/);
  assert.ok(!/deviceState|cameraState/.test(client.slice(client.indexOf("controlMesaDevice"))), "o cliente nunca envia estado");

  // Existe UM único gateway de dispositivo; nenhum segundo control gateway.
  const route = readFileSync(resolve(ROOT, "src/app/api/mesa/[id]/combat/net/device/route.ts"), "utf8");
  assert.match(route, /executeControlDeviceEffect/);
  assert.match(route, /if \(changed\)/);
  assert.match(route, /publishMesaState/);
});
