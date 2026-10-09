/**
 * F1.62 — gateway do Hackable Object no Postgres real.
 *
 * Cobre o fluxo completo:
 *   Hackable Object → Control Node → gateway → efeito puro → estado persistido
 *   → Realtime (varredura de fonte) → Tactical Map/Combat.
 *
 * Nada de autoridade no navegador: o corpo aceita apenas `objectId` + `action`
 * e todo o resto (tipo, Control Node, descoberta, autorização, estado da
 * porta) é resolvido no servidor a partir do que está persistido.
 */
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

try { process.loadEnvFile(".env"); } catch { /* Sem credenciais → skip. */ }
const configured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const db: SupabaseClient | null = configured
  ? createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  : null;
const postgresTest = configured ? test : test.skip;

const sessionId = randomUUID();
const combatId = randomUUID();
const gmId = randomUUID();
const playerId = randomUUID();
const otherId = randomUUID();
const actorId = randomUUID();
const otherCombatantId = randomUUID();
const enemyId = randomUUID();
const gmToken = `gm-${randomUUID()}-token`;
const playerToken = `player-${randomUUID()}-token`;
const otherToken = `other-${randomUUID()}-token`;

const ARCH_ID = "arch-1";
const NODE_ID = "ctrl-1";
const DOOR_ID = "door-1";
const AP_ID = "ap-1";

interface DoorRow { id: string; state: string }
interface MapRow {
  tactical_map: {
    geometry?: { doors?: DoorRow[] };
    hackableObjects?: Array<Record<string, unknown>>;
  };
}

const ARCH_CONTROLLED = {
  id: ARCH_ID,
  name: "Net da Sala",
  floors: [{
    id: "floor-1",
    index: 1,
    nodes: [{ id: NODE_ID, type: "control_node", floorIndex: 1, dv: 10, controlState: "controlled", controlledByNetrunnerId: actorId }],
  }],
};

const ARCH_UNCONTROLLED = {
  ...ARCH_CONTROLLED,
  floors: [{ ...ARCH_CONTROLLED.floors[0], nodes: [{ id: NODE_ID, type: "control_node", floorIndex: 1, dv: 10, controlState: "uncontrolled" }] }],
};

const ARCH_FOREIGN = {
  ...ARCH_CONTROLLED,
  floors: [{ ...ARCH_CONTROLLED.floors[0], nodes: [{ id: NODE_ID, type: "control_node", floorIndex: 1, dv: 10, controlState: "controlled", controlledByNetrunnerId: otherCombatantId }] }],
};

const ARCH_DEMON = {
  id: ARCH_ID,
  name: "Net da Sala",
  floors: [{
    id: "floor-1",
    index: 1,
    nodes: [
      { id: "demon-node", type: "demon", floorIndex: 1, demon: { id: "demon-core", name: "Core", state: "active" } },
      { id: NODE_ID, type: "control_node", floorIndex: 1, dv: 10, controlState: "controlled", controlledByNetrunnerId: actorId, controlledByDemonId: "demon-core" },
    ],
  }],
};

const JACKED_IN = {
  isJackedIn: true,
  connectedAccessPointId: AP_ID,
  connectionType: "wireless",
  architectureId: ARCH_ID,
  currentFloor: 1,
  unsafeJackOut: false,
  engagedBlackIceIds: [],
  interfaceRank: 4,
  ramCurrent: 10,
  netActionsRemaining: 3,
  meatspaceActionUsedForNetrunning: true,
  cyberdeckStatus: "functional",
};

const DISCOVERED = { architectureId: ARCH_ID, discoveredNodeIds: [NODE_ID] };

/** Mapa completo: porta física + Access Point + objetos Hackable. */
function baseMap(doorState: "open" | "closed" = "closed") {
  return {
    imageUrl: "",
    enabled: true,
    width: 1000,
    height: 600,
    pixelsPerMeter: 50,
    geometry: {
      walls: [],
      doors: [{ id: DOOR_ID, type: "door", start: { x: 0.5, y: 0.2 }, end: { x: 0.5, y: 0.8 }, thickness: 0.02, state: doorState }],
    },
    accessPoints: [{ id: AP_ID, position: { x: 0.22, y: 0.5 }, connectionTypes: ["wireless"], architectureId: ARCH_ID }],
    hackableObjects: [
      { id: "obj-door", type: "door", name: "Porta do Corredor", position: { x: 0.5, y: 0.5 }, controlNodeId: NODE_ID, geometryDoorId: DOOR_ID, active: true },
      { id: "obj-camera", type: "camera", name: "Câmera", position: { x: 0.4, y: 0.2 }, controlNodeId: NODE_ID, active: true },
      { id: "obj-plain", type: "terminal", name: "Terminal", position: { x: 0.7, y: 0.2 }, active: true },
      { id: "obj-off", type: "console", name: "Console", position: { x: 0.7, y: 0.8 }, controlNodeId: NODE_ID, active: false },
    ],
  };
}

async function device(token: string | undefined, body: Record<string, unknown>) {
  const { POST } = await import("../src/app/api/mesa/[id]/combat/net/device/route.ts");
  const response = await POST(new Request("http://localhost/api/mesa/session/combat/net/device", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { "x-mesa-token": token } : {}) },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: sessionId }) });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function move(token: string, body: Record<string, unknown>) {
  const { POST } = await import("../src/app/api/mesa/[id]/combat/move/route.ts");
  const response = await POST(new Request("http://localhost/api/mesa/session/combat/move", {
    method: "POST",
    headers: { "content-type": "application/json", "x-mesa-token": token },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: sessionId }) });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function patchMap(token: string, map: unknown) {
  const { PATCH } = await import("../src/app/api/mesa/[id]/tactical-map/route.ts");
  const response = await PATCH(new Request("http://localhost/api/mesa/session/tactical-map", {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-mesa-token": token },
    body: JSON.stringify({ map }),
  }), { params: Promise.resolve({ id: sessionId }) });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function getState(token: string) {
  const { GET } = await import("../src/app/api/mesa/[id]/route.ts");
  const response = await GET(new Request("http://localhost/api/mesa/session", {
    headers: { "x-mesa-token": token },
  }), { params: Promise.resolve({ id: sessionId }) });
  return (await response.json() as {
    state: {
      session: { tacticalMap: import("../src/lib/mesa/types.ts").TacticalMap };
      netArchitecture: { architectureId: string; nodes: Array<Record<string, unknown>> } | null;
      netArchitectures?: unknown;
    };
  }).state;
}

async function storedMap(): Promise<MapRow["tactical_map"]> {
  const { data, error } = await db!.from("mesa_sessions").select("tactical_map").eq("id", sessionId).single();
  assert.ifError(error);
  return (data as MapRow).tactical_map;
}

async function doorState(): Promise<string> {
  const map = await storedMap();
  const door = (map.geometry?.doors ?? []).find((entry) => entry.id === DOOR_ID);
  assert.ok(door, "a porta autoritativa precisa existir na geometria persistida");
  return door.state;
}

/** Estado autoritativo da câmera; `online` é o default implícito (F1.63). */
async function cameraState(objectId = "obj-camera"): Promise<string> {
  const map = await storedMap();
  const object = (map.hackableObjects ?? []).find((entry) => entry.id === objectId);
  assert.ok(object, "a câmera precisa existir no mapa persistido");
  return typeof object.deviceState === "string" ? object.deviceState : "online";
}

async function setArchitecture(architecture: unknown) {
  const { error } = await db!.from("mesa_sessions").update({ net_architectures: [architecture] }).eq("id", sessionId);
  assert.ifError(error);
}

async function setNetrunnerState(combatantId: string, state: unknown) {
  const { error } = await db!.from("mesa_combatants").update({ netrunner_state: state }).eq("id", combatantId);
  assert.ifError(error);
}

async function setDiscovery(combatantId: string, discovery: unknown) {
  const { error } = await db!.from("mesa_combatants").update({ net_discovery: discovery }).eq("id", combatantId);
  assert.ifError(error);
}

postgresTest("setup: Mesa, Architecture, combatente Netrunner Jacked In e mapa com porta", async () => {
  const { error: s } = await db!.from("mesa_sessions").insert({
    id: sessionId, name: "Hackable object gateway", gm_id: gmId, status: "active",
    join_code: sessionId.replace(/-/g, "").slice(0, 5).toUpperCase(),
    tactical_map: baseMap("closed"),
    net_architectures: [ARCH_CONTROLLED],
  });
  assert.ifError(s);
  const { error: p } = await db!.from("mesa_participants").insert([
    { id: gmId, session_id: sessionId, player_token: gmToken, role: "gm", display_name: "GM" },
    { id: playerId, session_id: sessionId, player_token: playerToken, role: "player", display_name: "Netrunner" },
    { id: otherId, session_id: sessionId, player_token: otherToken, role: "player", display_name: "Outro" },
  ]);
  assert.ifError(p);
  const { error: c } = await db!.from("mesa_combats").insert({
    id: combatId, session_id: sessionId, status: "active", round: 1,
    active_combatant_id: actorId, initiative_started: true, event_log: [],
  });
  assert.ifError(c);
  const shared = {
    combat_id: combatId, session_id: sessionId, kind: "character" as const,
    actions_max: 2, actions_remaining: 2, movement_max: 30, movement_remaining: 30,
    hp_current: 20, hp_max: 20, is_dead: false, conditions: [],
    // Bulk insert aplica as colunas da primeira linha às demais; sem isto viram NULL.
    netrunner_state: { ...JACKED_IN, isJackedIn: false }, net_discovery: {},
  };
  const { error: rows } = await db!.from("mesa_combatants").insert([
    { ...shared, id: actorId, name: "Netrunner", participant_id: playerId, position: { x: 0.22, y: 0.5 }, netrunner_state: JACKED_IN, net_discovery: DISCOVERED },
    { ...shared, id: otherCombatantId, name: "Outro PC", participant_id: otherId, position: { x: 0.25, y: 0.5 } },
    {
      id: enemyId, combat_id: combatId, session_id: sessionId, kind: "enemy" as const, name: "Inimigo",
      participant_id: gmId, position: { x: 0.1, y: 0.5 },
      actions_max: 2, actions_remaining: 2, movement_max: 30, movement_remaining: 30,
      hp_current: 20, hp_max: 20, is_dead: false, conditions: [],
      netrunner_state: { ...JACKED_IN, isJackedIn: false }, net_discovery: {},
    },
  ]);
  assert.ifError(rows);
  assert.equal(await doorState(), "closed");
});

postgresTest("Player abre e fecha a porta; o estado autoritativo é persistido e refletido na Mesa", async () => {
  const opened = await device(playerToken, { objectId: "obj-door", action: "open" });
  assert.equal(opened.status, 200, JSON.stringify(opened.body));
  assert.equal(opened.body.applied, true);
  assert.equal(opened.body.state, "open", "a resposta devolve o estado resolvido no servidor");
  assert.equal(opened.body.controlNodeId, NODE_ID);
  assert.equal(opened.body.objectName, "Porta do Corredor");
  assert.equal(await doorState(), "open", "geometria persistida é a única autoridade");

  const state = await getState(playerToken);
  const door = state.session.tacticalMap.geometry?.doors?.find((entry) => entry.id === DOOR_ID);
  assert.equal(door?.state, "open", "o Player vê a porta aberta sem recarregar");
  const object = (state.session.tacticalMap.hackableObjects ?? []).find((entry) => entry.id === "obj-door");
  assert.equal(object?.name, "Porta do Corredor");
  assert.equal(object?.geometryDoorId, DOOR_ID);
  assert.equal(state.netArchitecture?.nodes.some((node) => node.id === NODE_ID), true);

  const again = await device(playerToken, { objectId: "obj-door", action: "open" });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.applied, false, "estado autoritativo já era o pedido: idempotente");
  assert.equal(again.body.state, "open");

  const closed = await device(playerToken, { objectId: "obj-door", action: "close" });
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  assert.equal(closed.body.applied, true);
  assert.equal(closed.body.state, "closed");
  assert.equal(await doorState(), "closed");
});

postgresTest("O corpo aceita apenas intenção: estado/tipo/controlNode forjados são rejeitados", async () => {
  for (const extra of [{ state: "open" }, { type: "camera" }, { controlNodeId: "ctrl-x" }, { doorState: "open" }, { geometryDoorId: "door-1" }]) {
    const refused = await device(playerToken, { objectId: "obj-door", action: "close", ...extra });
    assert.equal(refused.status, 400, JSON.stringify(extra));
    assert.equal(refused.body.code, "client_authority_forbidden");
  }
  const badAction = await device(playerToken, { objectId: "obj-door", action: "toggle" });
  assert.equal(badAction.status, 400);
  assert.equal(badAction.body.code, "invalid_device_action");
  const missing = await device(playerToken, { action: "open" });
  assert.equal(missing.body.code, "invalid_hackable_object");
  const unknown = await device(playerToken, { objectId: "obj-does-not-exist", action: "open" });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.code, "hackable_object_not_found");
  assert.equal(await doorState(), "closed", "nenhuma recusa alterou o estado");
});

postgresTest("Recusas reais: sem Jack In, sem descoberta, sem controle, sem acesso, efeito UNSUPPORTED", async () => {
  // Sem Jack In.
  await setNetrunnerState(actorId, { ...JACKED_IN, isJackedIn: false });
  const offline = await device(playerToken, { objectId: "obj-door", action: "open" });
  assert.equal(offline.status, 409, JSON.stringify(offline.body));
  assert.equal(offline.body.code, "not_jacked_in");
  await setNetrunnerState(actorId, JACKED_IN);

  // Control Node não descoberto.
  await setDiscovery(actorId, { architectureId: ARCH_ID, discoveredNodeIds: [] });
  const undiscovered = await device(playerToken, { objectId: "obj-door", action: "open" });
  assert.equal(undiscovered.status, 403, JSON.stringify(undiscovered.body));
  assert.equal(undiscovered.body.code, "control_node_not_discovered");
  await setDiscovery(actorId, DISCOVERED);

  // Control Node existe mas não está controlado.
  await setArchitecture(ARCH_UNCONTROLLED);
  const uncontrolled = await device(playerToken, { objectId: "obj-door", action: "open" });
  assert.equal(uncontrolled.status, 409, JSON.stringify(uncontrolled.body));
  assert.equal(uncontrolled.body.code, "control_node_not_controlled");
  await setArchitecture(ARCH_CONTROLLED);

  // Control Node controlado por OUTRO Netrunner.
  await setArchitecture(ARCH_FOREIGN);
  const foreign = await device(playerToken, { objectId: "obj-door", action: "open" });
  assert.equal(foreign.status, 403, JSON.stringify(foreign.body));
  assert.equal(foreign.body.code, "no_access");
  await setArchitecture(ARCH_CONTROLLED);

  // Control Node sob controle de um Demon.
  await setArchitecture(ARCH_DEMON);
  const demon = await device(playerToken, { objectId: "obj-door", action: "open" });
  assert.equal(demon.status, 409, JSON.stringify(demon.body));
  assert.equal(demon.body.code, "control_node_demon_controlled");
  await setArchitecture(ARCH_CONTROLLED);

  // Objeto sem Control Node vinculado.
  const unlinked = await device(playerToken, { objectId: "obj-plain", action: "open" });
  assert.equal(unlinked.status, 409, JSON.stringify(unlinked.body));
  assert.equal(unlinked.body.code, "control_node_missing");

  // Objeto desativado.
  const inactive = await device(playerToken, { objectId: "obj-off", action: "open" });
  assert.equal(inactive.status, 409, JSON.stringify(inactive.body));
  assert.equal(inactive.body.code, "hackable_object_inactive");

  // Ação de porta numa câmera continua UNSUPPORTED: a câmera só aceita
  // enable/disable, e nada é inventado para o resto.
  const camera = await device(playerToken, { objectId: "obj-camera", action: "open" });
  assert.equal(camera.status, 409, JSON.stringify(camera.body));
  assert.equal(camera.body.code, "device_effect_unsupported");

  // Mestre não executa efeito de dispositivo (é fluxo do Netrunner).
  const gm = await device(gmToken, { objectId: "obj-door", action: "open" });
  assert.equal(gm.status, 403, JSON.stringify(gm.body));
  assert.equal(gm.body.code, "player_only");

  // Outro Player usa a PRÓPRIA autoridade (descoberta própria), não a alheia.
  await setNetrunnerState(otherCombatantId, JACKED_IN);
  await setDiscovery(otherCombatantId, { architectureId: ARCH_ID, discoveredNodeIds: [] });
  const other = await device(otherToken, { objectId: "obj-door", action: "open" });
  assert.equal(other.status, 403, JSON.stringify(other.body));
  assert.equal(other.body.code, "control_node_not_discovered");
  await setNetrunnerState(otherCombatantId, { ...JACKED_IN, isJackedIn: false });
  await setDiscovery(otherCombatantId, { architectureId: ARCH_ID, discoveredNodeIds: [] });

  const noToken = await device(undefined, { objectId: "obj-door", action: "open" });
  assert.equal(noToken.status, 401);
  assert.equal(noToken.body.code, "missing_token");

  assert.equal(await doorState(), "closed", "nenhuma recusa abriu a porta");
});

postgresTest("F1.63 câmera nasce ONLINE; Netrunner desativa e reativa, persistindo e refletindo na Mesa", async () => {
  assert.equal(await cameraState(), "online", "câmera começa ONLINE por padrão");

  const disabled = await device(playerToken, { objectId: "obj-camera", action: "disable" });
  assert.equal(disabled.status, 200, JSON.stringify(disabled.body));
  assert.equal(disabled.body.applied, true);
  assert.equal(disabled.body.cameraState, "disabled", "a resposta devolve o estado resolvido no servidor");
  assert.equal(disabled.body.state, null, "câmera não devolve estado de porta");
  assert.equal(disabled.body.doorId, null, "câmera não devolve porta");
  assert.equal(disabled.body.controlNodeId, NODE_ID);
  assert.equal(await cameraState(), "disabled", "estado autoritativo persistido");

  // Refletido na Mesa para o Netrunner sem reload.
  const state = await getState(playerToken);
  const camera = (state.session.tacticalMap.hackableObjects ?? []).find((entry) => entry.id === "obj-camera");
  assert.equal(camera?.deviceState, "disabled");
  // A câmera não virou geometria.
  assert.equal((state.session.tacticalMap.geometry?.doors ?? []).some((entry) => entry.id === "obj-camera"), false);
  assert.equal((state.session.tacticalMap.geometry?.walls ?? []).some((entry) => entry.id === "obj-camera"), false);

  // Replay idempotente.
  const replay = await device(playerToken, { objectId: "obj-camera", action: "disable" });
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.applied, false, "estado autoritativo já era o pedido");
  assert.equal(await cameraState(), "disabled");

  const enabled = await device(playerToken, { objectId: "obj-camera", action: "enable" });
  assert.equal(enabled.status, 200, JSON.stringify(enabled.body));
  assert.equal(enabled.body.applied, true);
  assert.equal(enabled.body.cameraState, "online");
  assert.equal(await cameraState(), "online");

  // A porta permanece intocada durante todo o ciclo da câmera.
  assert.equal(await doorState(), "closed");
});

postgresTest("F1.63 o corpo aceita apenas intenção: deviceState forjado é rejeitado", async () => {
  for (const extra of [{ deviceState: "online" }, { cameraState: "disabled" }, { state: "disabled" }]) {
    const refused = await device(playerToken, { objectId: "obj-camera", action: "disable", ...extra });
    assert.equal(refused.status, 400, JSON.stringify(extra));
    assert.equal(refused.body.code, "client_authority_forbidden");
  }
  // O servidor ignora a intenção forjada e resolve a partir do persistido.
  assert.equal(await cameraState(), "online", "nenhuma recusa alterou o estado");
});

postgresTest("F1.63 recusas reais da câmera: Jack In, descoberta, controle, acesso e ação inválida", async () => {
  await setNetrunnerState(actorId, { ...JACKED_IN, isJackedIn: false });
  const offline = await device(playerToken, { objectId: "obj-camera", action: "disable" });
  assert.equal(offline.status, 409, JSON.stringify(offline.body));
  assert.equal(offline.body.code, "not_jacked_in");
  await setNetrunnerState(actorId, JACKED_IN);

  await setDiscovery(actorId, { architectureId: ARCH_ID, discoveredNodeIds: [] });
  const undiscovered = await device(playerToken, { objectId: "obj-camera", action: "disable" });
  assert.equal(undiscovered.status, 403, JSON.stringify(undiscovered.body));
  assert.equal(undiscovered.body.code, "control_node_not_discovered");
  await setDiscovery(actorId, DISCOVERED);

  await setArchitecture(ARCH_UNCONTROLLED);
  const uncontrolled = await device(playerToken, { objectId: "obj-camera", action: "disable" });
  assert.equal(uncontrolled.status, 409, JSON.stringify(uncontrolled.body));
  assert.equal(uncontrolled.body.code, "control_node_not_controlled");
  await setArchitecture(ARCH_CONTROLLED);

  await setArchitecture(ARCH_FOREIGN);
  const foreign = await device(playerToken, { objectId: "obj-camera", action: "disable" });
  assert.equal(foreign.status, 403, JSON.stringify(foreign.body));
  assert.equal(foreign.body.code, "no_access");
  await setArchitecture(ARCH_CONTROLLED);

  const unknown = await device(playerToken, { objectId: "obj-no-camera", action: "disable" });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.code, "hackable_object_not_found");

  // Ação fora do catálogo da câmera.
  const badAction = await device(playerToken, { objectId: "obj-camera", action: "destroy" });
  assert.equal(badAction.status, 400);
  assert.equal(badAction.body.code, "invalid_device_action");

  const gm = await device(gmToken, { objectId: "obj-camera", action: "disable" });
  assert.equal(gm.status, 403, JSON.stringify(gm.body));
  assert.equal(gm.body.code, "player_only");

  assert.equal(await cameraState(), "online", "nenhuma recusa desativou a câmera");
  assert.equal(await doorState(), "closed");
});

postgresTest("F1.63 concorrência: duas intenções simultâneas sobre a mesma câmera gravam uma única vez", async () => {
  const [a, b] = await Promise.all([
    device(playerToken, { objectId: "obj-camera", action: "disable" }),
    device(playerToken, { objectId: "obj-camera", action: "disable" }),
  ]);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(b.status, 200, JSON.stringify(b.body));
  const applied = [a, b].filter((entry) => entry.body.applied === true);
  assert.equal(applied.length, 1, JSON.stringify([a.body, b.body]));
  assert.equal(await cameraState(), "disabled", "estado final único");

  const back = await device(playerToken, { objectId: "obj-camera", action: "enable" });
  assert.equal(back.body.applied, true);
  assert.equal(await cameraState(), "online");
});

postgresTest("F1.63 projeção: Player/GM veem o estado da câmera; a privacidade da NET permanece", async () => {
  await device(playerToken, { objectId: "obj-camera", action: "disable" });

  const playerSees = await getState(playerToken);
  const playerCamera = (playerSees.session.tacticalMap.hackableObjects ?? []).find((entry) => entry.id === "obj-camera");
  assert.equal(playerCamera?.deviceState, "disabled", "o estado físico da câmera é observável, como o da porta");
  assert.equal(playerSees.netArchitecture?.nodes.some((node) => node.id === NODE_ID), true, "nó descoberto segue visível");

  const gmSees = await getState(gmToken);
  const gmCamera = (gmSees.session.tacticalMap.hackableObjects ?? []).find((entry) => entry.id === "obj-camera");
  assert.equal(gmCamera?.deviceState, "disabled");
  assert.equal(gmCamera?.controlNodeId, NODE_ID, "GM vê o Control Node");

  const strangerSees = await getState(otherToken);
  const strangerCamera = (strangerSees.session.tacticalMap.hackableObjects ?? []).find((entry) => entry.id === "obj-camera");
  assert.equal(strangerCamera?.controlNodeId, undefined, "Control Node não descoberto continua oculto");
  assert.equal(Boolean(strangerSees.netArchitecture?.nodes?.some((node) => node.id === NODE_ID)), false, "arquitetura NET privada não vaza");

  await device(playerToken, { objectId: "obj-camera", action: "enable" });
  assert.equal(await cameraState(), "online");
});

postgresTest("F1.63 editor GM configura o estado inicial da câmera, sem propriedades arbitrárias", async () => {
  const draft = baseMap("closed");
  draft.hackableObjects = draft.hackableObjects.map((object) => object.id === "obj-camera"
    ? { ...object, deviceState: "disabled", arbitrary: "nope" }
    : object);
  const saved = await patchMap(gmToken, draft);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(await cameraState(), "disabled", "o GM define o estado inicial ONLINE/DISABLED");

  const persisted = await storedMap();
  const camera = (persisted.hackableObjects ?? []).find((entry) => entry.id === "obj-camera");
  assert.ok(camera, "a câmera persiste com o mesmo id");
  assert.equal("arbitrary" in camera, false, "nenhuma propriedade arbitrária é persistida");
  // Só câmera carrega deviceState: a porta não recebe estado de dispositivo.
  const doorObject = (persisted.hackableObjects ?? []).find((entry) => entry.id === "obj-door");
  assert.ok(doorObject, "a porta persiste com o mesmo id");
  assert.equal("deviceState" in doorObject, false);
  assert.equal(await doorState(), "closed");

  // Estado inicial fora do catálogo cai no default ONLINE, sem erro inventado.
  const invalid = baseMap("closed");
  invalid.hackableObjects = invalid.hackableObjects.map((object) => object.id === "obj-camera" ? { ...object, deviceState: "explosao" } : object);
  assert.equal((await patchMap(gmToken, invalid)).status, 200);
  assert.equal(await cameraState(), "online");

  // O Player continua o fluxo autorizado a partir do estado configurado.
  const disabled = await device(playerToken, { objectId: "obj-camera", action: "disable" });
  assert.equal(disabled.body.applied, true);
  await device(playerToken, { objectId: "obj-camera", action: "enable" });
  assert.equal(await cameraState(), "online");
});

postgresTest("Projeção: Player esconde Control Node não descoberto; GM vê a configuração completa", async () => {
  const player = await getState(playerToken);
  const objects = player.session.tacticalMap.hackableObjects ?? [];
  assert.equal(objects.find((entry) => entry.id === "obj-door")?.controlNodeId, NODE_ID, "descoberto → relação visível");
  assert.equal(objects.find((entry) => entry.id === "obj-plain")?.controlNodeId, undefined, "objeto sem vínculo não ganha");
  assert.equal(player.netArchitecture?.architectureId, ARCH_ID);

  await setDiscovery(actorId, { architectureId: ARCH_ID, discoveredNodeIds: [] });
  const blind = await getState(playerToken);
  const blindObjects = blind.session.tacticalMap.hackableObjects ?? [];
  assert.equal(blindObjects.every((entry) => entry.controlNodeId === undefined), true,
    "Control Node não descoberto some da projeção do Player");
  assert.deepEqual(blind.netArchitecture?.nodes, [], "arquitetura NET privada não vaza");
  await setDiscovery(actorId, DISCOVERED);

  // Outro Player (sem conexão NET) nunca vê a relação lógica.
  const stranger = await getState(otherToken);
  assert.equal(stranger.netArchitecture, null);
  assert.equal((stranger.session.tacticalMap.hackableObjects ?? []).every((entry) => entry.controlNodeId === undefined), true);

  // GM: visão completa, sem propriedades arbitrárias.
  const gm = await getState(gmToken);
  assert.equal(Array.isArray(gm.netArchitectures), true);
  const gmObjects = gm.session.tacticalMap.hackableObjects ?? [];
  assert.equal(gmObjects.find((entry) => entry.id === "obj-door")?.controlNodeId, NODE_ID);
  assert.equal(gmObjects.find((entry) => entry.id === "obj-door")?.geometryDoorId, DOOR_ID);
  assert.equal(gmObjects.find((entry) => entry.id === "obj-plain")?.controlNodeId, undefined);
  const node = gm.netArchitecture?.nodes.find((entry) => entry.id === NODE_ID);
  assert.equal(node?.controlState, "controlled");
});

postgresTest("Editor GM: valida referências e configura tipo/nome/posição/ativo/Control Node/porta inicial", async () => {
  const base = baseMap("closed");

  const badNode = await patchMap(gmToken, { ...base, hackableObjects: [{ id: "x1", type: "door", position: { x: 0.5, y: 0.5 }, controlNodeId: "ctrl-x", geometryDoorId: DOOR_ID, active: true }] });
  assert.equal(badNode.status, 400, JSON.stringify(badNode.body));
  assert.equal(badNode.body.code, "control_node_not_found");

  const badDoor = await patchMap(gmToken, { ...base, hackableObjects: [{ id: "x2", type: "door", position: { x: 0.5, y: 0.5 }, controlNodeId: NODE_ID, geometryDoorId: "door-x", active: true }] });
  assert.equal(badDoor.status, 400, JSON.stringify(badDoor.body));
  assert.equal(badDoor.body.code, "door_geometry_not_found");

  const dupDoor = await patchMap(gmToken, {
    ...base,
    hackableObjects: [
      { id: "x3", type: "door", position: { x: 0.5, y: 0.5 }, controlNodeId: NODE_ID, geometryDoorId: DOOR_ID, active: true },
      { id: "x4", type: "door", position: { x: 0.5, y: 0.6 }, controlNodeId: NODE_ID, geometryDoorId: DOOR_ID, active: true },
    ],
  });
  assert.equal(dupDoor.status, 400, JSON.stringify(dupDoor.body));
  assert.equal(dupDoor.body.code, "duplicate_door_reference");

  const badRef = await patchMap(gmToken, { ...base, hackableObjects: [{ id: "x5", type: "door", position: { x: 0.5, y: 0.5 }, controlNodeId: NODE_ID, geometryDoorId: 5, active: true }] });
  assert.equal(badRef.status, 400, JSON.stringify(badRef.body));
  assert.equal(badRef.body.code, "invalid_door_reference");

  // Propriedade arbitrária não persiste; tipo fora do catálogo não persiste.
  const openMap = baseMap("open");
  openMap.hackableObjects = [
    ...openMap.hackableObjects.map((object) => object.id === "obj-door"
      ? { ...object, name: "Porta da Sala Norte", position: { x: 0.5, y: 0.45 }, hacked: true }
      : object),
    { id: "x-turret", type: "turret", name: "Torre", position: { x: 0.2, y: 0.2 }, active: true },
  ];
  const saved = await patchMap(gmToken, openMap);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(await doorState(), "open", "o GM define o estado inicial da porta");

  const persisted = await storedMap();
  const objects = persisted.hackableObjects ?? [];
  assert.equal(objects.some((entry) => entry.type === "turret"), false, "tipo fora do catálogo é descartado");
  assert.equal(objects.some((entry) => entry.id === "x-turret"), false, "objeto com tipo fora do catálogo não persiste");
  const doorObject = objects.find((entry) => entry.id === "obj-door");
  assert.ok(doorObject, "objeto com id estável continua existindo");
  assert.equal(doorObject.name, "Porta da Sala Norte");
  assert.deepEqual(doorObject.position, { x: 0.5, y: 0.45 });
  assert.equal(doorObject.active, true);
  assert.equal(doorObject.controlNodeId, NODE_ID);
  assert.equal(doorObject.geometryDoorId, DOOR_ID);
  assert.equal("hacked" in doorObject, false, "nenhuma propriedade arbitrária é persistida");

  // Com a porta já aberta, o Player fecha via gateway (estado vem do servidor).
  const close = await device(playerToken, { objectId: "obj-door", action: "close" });
  assert.equal(close.status, 200, JSON.stringify(close.body));
  assert.equal(close.body.applied, true);
  assert.equal(await doorState(), "closed");

  // E o estado inicial aberto do GM é observável pelo Player.
  const reopened = await patchMap(gmToken, baseMap("open"));
  assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
  const playerSees = await getState(playerToken);
  assert.equal(playerSees.session.tacticalMap.geometry?.doors?.find((entry) => entry.id === DOOR_ID)?.state, "open");
  const closeAgain = await device(playerToken, { objectId: "obj-door", action: "close" });
  assert.equal(closeAgain.body.applied, true);
  assert.equal(await doorState(), "closed");
});

postgresTest("Concorrência: duas intenções simultâneas gravam uma única vez (CAS)", async () => {
  const [a, b] = await Promise.all([
    device(playerToken, { objectId: "obj-door", action: "open" }),
    device(playerToken, { objectId: "obj-door", action: "open" }),
  ]);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(b.status, 200, JSON.stringify(b.body));
  const applied = [a, b].filter((entry) => entry.body.applied === true);
  assert.equal(applied.length, 1, JSON.stringify([a.body, b.body]));
  assert.equal(await doorState(), "open");

  const closed = await device(playerToken, { objectId: "obj-door", action: "close" });
  assert.equal(closed.body.applied, true);
  assert.equal(await doorState(), "closed");
});

postgresTest("Porta fechada bloqueia o movimento no Tactical Map; aberta, o caminho é liberado", async () => {
  const { error } = await db!.from("mesa_combats").update({ active_combatant_id: enemyId }).eq("id", combatId);
  assert.ifError(error);
  assert.equal(await doorState(), "closed");

  const blocked = await move(gmToken, { resolutionId: randomUUID(), actorCombatantId: enemyId, targetPosition: { x: 0.9, y: 0.5 } });
  assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
  assert.equal(blocked.body.code, "movement_blocked");
  const { data: before, error: readError } = await db!.from("mesa_combatants").select("position,movement_remaining").eq("id", enemyId).single();
  assert.ifError(readError);
  assert.deepEqual((before as { position: { x: number; y: number } }).position, { x: 0.1, y: 0.5 });
  assert.equal((before as { movement_remaining: number }).movement_remaining, 30, "recusa não cobra movimento");

  const opened = await device(playerToken, { objectId: "obj-door", action: "open" });
  assert.equal(opened.body.applied, true, JSON.stringify(opened.body));
  assert.equal(await doorState(), "open");

  const allowed = await move(gmToken, { resolutionId: randomUUID(), actorCombatantId: enemyId, targetPosition: { x: 0.9, y: 0.5 } });
  assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
  const { data: after, error: afterError } = await db!.from("mesa_combatants").select("position,movement_remaining").eq("id", enemyId).single();
  assert.ifError(afterError);
  assert.deepEqual((after as { position: { x: number; y: number } }).position, { x: 0.9, y: 0.5 });
  assert.equal((after as { movement_remaining: number }).movement_remaining, 14, "16 m descontados do orçamento");

  const closedNow = await device(playerToken, { objectId: "obj-door", action: "close" });
  assert.equal(closedNow.body.applied, true);
  assert.equal(await doorState(), "closed");
});

postgresTest("A rota publica Realtime somente quando houve mudança", () => {
  const route = readFileSync(resolve(ROOT, "src/app/api/mesa/[id]/combat/net/device/route.ts"), "utf8");
  assert.match(route, /if \(changed\)\s+await publishMesaState\(id\)/);
  assert.match(route, /executeControlDeviceEffect/);

  const client = readFileSync(resolve(ROOT, "src/lib/mesa/client.ts"), "utf8");
  assert.match(client, /objectId: input\.objectId, action: input\.action/);
  assert.equal(/state:/.test(client.slice(client.indexOf("controlMesaDevice"))), false,
    "o cliente só envia intenção");

  const panel = readFileSync(resolve(ROOT, "src/components/mesa/player/PlayerNetrunnerPanel.tsx"), "utf8");
  assert.match(panel, /HACKABLE OBJECT/);
  assert.match(panel, /\[ABRIR\]/);
  assert.match(panel, /\[FECHAR\]/);
  assert.match(panel, /JACK IN necessário|describeHackableObjectControl/);
});

after(async () => {
  if (!db) return;
  await db.from("mesa_attack_resolutions").delete().eq("session_id", sessionId);
  await db.from("mesa_combatants").delete().in("id", [actorId, otherCombatantId, enemyId]);
  await db.from("mesa_combats").delete().eq("id", combatId);
  await db.from("mesa_participants").delete().in("id", [gmId, playerId, otherId]);
  await db.from("mesa_sessions").delete().eq("id", sessionId);
});
