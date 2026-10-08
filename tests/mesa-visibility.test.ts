import assert from "node:assert/strict";
import test from "node:test";

import type { MesaCombatant, TacticalMap, TacticalPosition } from "../src/lib/mesa/types.ts";
import {
  isTacticalTargetVisibleToPlayer,
  projectCombatForPlayer,
  projectCombatantsForPlayer,
  projectCombatantsForViewer,
  resolveTacticalVisibility,
} from "../src/lib/mesa/visibility.ts";

const map: TacticalMap = {
  imageUrl: "",
  enabled: true,
  width: 1000,
  height: 600,
  pixelsPerMeter: 50,
  geometry: { walls: [], doors: [] },
};

const point = (x: number, y = 0.5): TacticalPosition => ({ x, y });

function combatant(
  id: string,
  kind: "character" | "enemy",
  position: TacticalPosition | undefined,
  participantId: string | null = kind === "character" ? id : null,
): MesaCombatant {
  return {
    id,
    combatId: "combat",
    sessionId: "session",
    kind,
    characterId: kind === "character" ? id : null,
    participantId,
    name: id,
    sourceKey: null,
    supplies: null,
    armor: null,
    criticalInjuries: [],
    initiative: null,
    initiativeDetail: null,
    actionsMax: 2,
    actionsRemaining: 2,
    movementMax: 6,
    movementRemaining: 6,
    hpCurrent: 20,
    hpMax: 20,
    isDead: false,
    conditions: [],
    sortOrder: 0,
    ...(position ? { position } : {}),
  };
}

const viewer = combatant("player", "character", point(0.1), "participant");
const visibleEnemy = combatant("visible-enemy", "enemy", point(0.3));
const hiddenEnemy = combatant("hidden-enemy", "enemy", point(0.9));

function positions(entries: MesaCombatant[]): ReadonlyMap<string, TacticalPosition | null> {
  return new Map(entries.map((entry) => [entry.id, entry.position ?? null]));
}

test("Player recebe Enemy com LOS livre e mantém seu próprio token", () => {
  const entries = [viewer, visibleEnemy];
  const projection = projectCombatantsForPlayer(entries, "participant", map, positions(entries));
  assert.deepEqual(projection.map((entry) => entry.id), ["player", "visible-enemy"]);
});

test("Enemy atrás de parede é omitido, sem placeholder ou metadata oculto", () => {
  const blockedMap = {
    ...map,
    geometry: {
      walls: [{ id: "wall", type: "wall" as const, start: point(0.5, 0.1), end: point(0.5, 0.9) }],
      doors: [],
    },
  };
  const projection = projectCombatantsForPlayer([viewer, hiddenEnemy], "participant", blockedMap, positions([viewer, hiddenEnemy]));
  assert.deepEqual(projection.map((entry) => entry.id), ["player"]);
  assert.equal(JSON.stringify(projection).includes("hidden-enemy"), false);
});

test("porta fechada oculta e porta aberta revela o Enemy", () => {
  const closed = {
    ...map,
    geometry: {
      walls: [],
      doors: [{ id: "door", type: "door" as const, start: point(0.5, 0.1), end: point(0.5, 0.9), state: "closed" as const }],
    },
  };
  const closedProjection = projectCombatantsForPlayer([viewer, hiddenEnemy], "participant", closed, positions([viewer, hiddenEnemy]));
  assert.deepEqual(closedProjection.map((entry) => entry.id), ["player"]);

  const open = { ...closed, geometry: { ...closed.geometry, doors: [{ ...closed.geometry.doors[0], state: "open" as const }] } };
  const openProjection = projectCombatantsForPlayer([viewer, hiddenEnemy], "participant", open, positions([viewer, hiddenEnemy]));
  assert.deepEqual(openProjection.map((entry) => entry.id), ["player", "hidden-enemy"]);
});

test("obstáculo destruído não bloqueia visibilidade", () => {
  const destroyedWallMap = {
    ...map,
    geometry: {
      walls: [{ id: "wall", type: "wall" as const, start: point(0.5, 0.1), end: point(0.5, 0.9), destroyed: true }],
      doors: [],
    },
  };
  assert.equal(resolveTacticalVisibility(viewer.position, hiddenEnemy.position, destroyedWallMap), "visible");
});

test("movimento confirmado muda a projeção sem lista descoberta client-side", () => {
  const first = projectCombatantsForPlayer([viewer, hiddenEnemy], "participant", map, positions([viewer, hiddenEnemy]));
  assert.deepEqual(first.map((entry) => entry.id), ["player", "hidden-enemy"]);

  const blockedMap = {
    ...map,
    geometry: {
      walls: [{ id: "wall", type: "wall" as const, start: point(0.5, 0.1), end: point(0.5, 0.9) }],
      doors: [],
    },
  };
  const afterMove = projectCombatantsForPlayer([viewer, hiddenEnemy], "participant", blockedMap, positions([viewer, hiddenEnemy]));
  assert.deepEqual(afterMove.map((entry) => entry.id), ["player"]);
});

test("GM recebe todos os tokens e alvo oculto falha fechado", () => {
  const entries = [viewer, hiddenEnemy];
  assert.deepEqual(
    projectCombatantsForViewer(entries, "gm", null, map, positions(entries)).map((entry) => entry.id),
    ["player", "hidden-enemy"],
  );
  assert.equal(isTacticalTargetVisibleToPlayer(viewer.position, hiddenEnemy.position, {
    ...map,
    geometry: { walls: [{ id: "wall", type: "wall", start: point(0.5, 0.1), end: point(0.5, 0.9) }], doors: [] },
  }), false);
  assert.equal(isTacticalTargetVisibleToPlayer(undefined, hiddenEnemy.position, map), false);
});

test("Players continuam vendo Characters sem aplicar filtro de Enemy", () => {
  const otherPlayer = combatant("other-player", "character", point(0.9), "other-participant");
  const blockedMap = {
    ...map,
    geometry: {
      walls: [{ id: "wall", type: "wall" as const, start: point(0.5, 0.1), end: point(0.5, 0.9) }],
      doors: [],
    },
  };
  const projection = projectCombatantsForPlayer([viewer, otherPlayer, hiddenEnemy], "participant", blockedMap, positions([viewer, otherPlayer, hiddenEnemy]));
  assert.deepEqual(projection.map((entry) => entry.id), ["player", "other-player"]);
});

test("Enemy em Stealth com LOS permanece omitido até ser detectado pelo observer", () => {
  const stealthed = { ...visibleEnemy, stealthState: "stealthed" as const };
  const entries = [viewer, stealthed];
  assert.deepEqual(projectCombatantsForPlayer(entries, "participant", map, positions(entries)).map((entry) => entry.id), ["player"]);
  const detected = { ...stealthed, detectedBy: [viewer.id] };
  assert.deepEqual(projectCombatantsForPlayer([viewer, detected], "participant", map, positions([viewer, detected])).map((entry) => entry.id), ["player", "visible-enemy"]);
});

test("projeção não vaza ID ativo, contagem ou eventos de Enemy oculto", () => {
  const entries = [viewer, hiddenEnemy];
  const projected = projectCombatForPlayer({
    id: "combat",
    sessionId: "session",
    status: "active",
    round: 1,
    activeCombatantId: hiddenEnemy.id,
    turnStartedAt: null,
    initiativeStarted: true,
    createdAt: "now",
    eventLog: [
      { at: "now", kind: "enemy", text: "1 inimigo(s) adicionado(s)" },
      { at: "now", kind: "action", text: `${hiddenEnemy.name}: atacou` },
      { at: "now", kind: "action", text: "player: moveu" },
    ],
  }, entries, [viewer]);
  assert.equal(projected?.activeCombatantId, null);
  assert.deepEqual(projected?.eventLog.map((event) => event.text), ["player: moveu"]);
  assert.equal(JSON.stringify(projected).includes(hiddenEnemy.id), false);
});
