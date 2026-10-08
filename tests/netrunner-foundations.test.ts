import assert from "node:assert/strict";
import test from "node:test";
import { getQuickhacksForCharacter } from "../src/data/quickhacks.ts";
import { getNetActionsPerTurn } from "../src/lib/roles.ts";
import { canConnectToAccessPoint, canJackIn, canSafeJackOut, connectedNetrunnerState, getCyberdeckSlots, getQuickhackDV, getQuickhackRamCost, getRamMax, ramForReconnect, resolveQuickhackEffect, safeJackOutState, stopAtWirelessAccessPointRange, unsafeJackOutState } from "../src/lib/mesa/netrunner.ts";
import { quickhackDefinitions } from "../src/data/quickhacks.ts";
import { createTestRandomSource } from "../src/lib/random.ts";
import type { TacticalAccessPoint, TacticalMap } from "../src/lib/mesa/types.ts";

const map: TacticalMap = { imageUrl: "", enabled: true, width: 1000, height: 600, pixelsPerMeter: 50 };
const accessPoint: TacticalAccessPoint = {
  id: "ap-1",
  position: { x: 0.5, y: 0.5 },
  connectionTypes: ["wireless", "cable"],
  architectureId: null,
  wirelessRangeMeters: 6,
  active: true,
};

test("Interface Rank usa a tabela RAW de NET Actions", () => {
  assert.equal(getNetActionsPerTurn(1), 2);
  assert.equal(getNetActionsPerTurn(3), 2);
  assert.equal(getNetActionsPerTurn(4), 3);
  assert.equal(getNetActionsPerTurn(6), 3);
  assert.equal(getNetActionsPerTurn(7), 4);
  assert.equal(getNetActionsPerTurn(9), 4);
  assert.equal(getNetActionsPerTurn(10), 5);
});

test("RAM e Cyberdeck derivam exclusivamente do Interface Rank", () => {
  assert.deepEqual([1, 3, 4, 6, 7, 9, 10].map(getRamMax), [8, 8, 10, 10, 12, 12, 14]);
  assert.deepEqual([1, 3, 4, 6, 7, 9, 10].map(getCyberdeckSlots), [6, 6, 7, 7, 8, 8, 9]);
});

test("os 11 Quickhacks possuem custo RAM e DV de catálogo", () => {
  assert.equal(Object.keys(quickhackDefinitions).length, 11);
  assert.equal(getQuickhackRamCost("puppet"), 5);
  assert.equal(getQuickhackRamCost("synapse_burnout"), 4);
  assert.equal(getQuickhackDV("impair_movement"), 8);
  assert.equal(getQuickhackDV("system_reset"), 14);
});

test("efeitos de Quickhack usam duração/rolagem server-side sem inventar Brain Damage", () => {
  const overheat = resolveQuickhackEffect({ quickhackId: "overheat", sourceCombatantId: "n", currentRound: 3, rng: createTestRandomSource([]) });
  assert.equal(overheat.effect.damageAtEndOfTurn, 4);
  assert.equal(overheat.damage, undefined);
  const slow = resolveQuickhackEffect({ quickhackId: "slow", sourceCombatantId: "n", currentRound: 3, rng: createTestRandomSource([6]) });
  assert.equal(slow.effect.moveModifier, -6);
  const puppet = resolveQuickhackEffect({ quickhackId: "puppet", sourceCombatantId: "n", currentRound: 3, rng: createTestRandomSource([]) });
  assert.equal(puppet.effect.controlsAction, true);
  assert.equal(puppet.effect.controlsMove, true);
});

test("Skill Interface legada não altera disponibilidade de Netrunner", () => {
  const withLegacySkill = getQuickhacksForCharacter({ primaryRole: "netrunner", skills: { interface: { level: 0 } }, roleAbilities: [{ abilityId: "interface", rank: 1 }] });
  const withoutSkill = getQuickhacksForCharacter({ primaryRole: "netrunner", skills: {}, roleAbilities: [{ abilityId: "interface", rank: 1 }] });
  assert.equal(withLegacySkill.length, withoutSkill.length);
  assert.equal(getQuickhacksForCharacter({ primaryRole: null, skills: { interface: { level: 10 } }, roleAbilities: [] }).length, 0);
});

test("Jack In wireless exige AP ativo, Cyberdeck e até 6m", () => {
  const inside = canJackIn({ hasCyberdeck: true, isJackedIn: false, accessPoint, connectionType: "wireless", netrunnerPosition: { x: 0.5, y: 0.5 }, map });
  assert.deepEqual(inside, { ok: true });
  const outside = canJackIn({ hasCyberdeck: true, isJackedIn: false, accessPoint, connectionType: "wireless", netrunnerPosition: { x: 0.85, y: 0.5 }, map });
  assert.deepEqual(outside, { ok: false, reason: "out_of_range" });
  assert.deepEqual(canJackIn({ hasCyberdeck: false, isJackedIn: false, accessPoint, connectionType: "wireless", netrunnerPosition: { x: 0.5, y: 0.5 }, map }), { ok: false, reason: "cyberdeck_required" });
  assert.deepEqual(canJackIn({ hasCyberdeck: true, isJackedIn: false, accessPoint: { ...accessPoint, active: false }, connectionType: "wireless", netrunnerPosition: { x: 0.5, y: 0.5 }, map }), { ok: false, reason: "access_point_inactive" });
  assert.deepEqual(canJackIn({ hasCyberdeck: true, isJackedIn: true, accessPoint, connectionType: "wireless", netrunnerPosition: { x: 0.5, y: 0.5 }, map }), { ok: false, reason: "already_jacked_in" });
});

test("conexão por cabo não usa a distância wireless, mas respeita o tipo suportado", () => {
  assert.deepEqual(canConnectToAccessPoint({ accessPoint, connectionType: "cable", netrunnerPosition: { x: 0.99, y: 0.99 }, map }), { ok: true });
  assert.deepEqual(canConnectToAccessPoint({ accessPoint: { ...accessPoint, connectionTypes: ["wireless"] }, connectionType: "cable", netrunnerPosition: { x: 0.5, y: 0.5 }, map }), { ok: false, reason: "connection_type_unsupported" });
});

test("Safe Jack Out só é permitido sem Black ICE engajado", () => {
  assert.equal(canSafeJackOut([]), true);
  assert.equal(canSafeJackOut(["ice-1"]), false);
  assert.equal(safeJackOutState().isJackedIn, false);
  assert.equal(safeJackOutState().unsafeJackOut, false);
  assert.equal(unsafeJackOutState().isJackedIn, false);
  assert.equal(unsafeJackOutState().unsafeJackOut, true);
});

test("Access Point com arquitetura inicia no Floor 1 e Jack Out limpa o Floor", () => {
  const connected = connectedNetrunnerState({ id: "ap-1", architectureId: "arch-1" }, "wireless", 4);
  assert.equal(connected.architectureId, "arch-1");
  assert.equal(connected.currentFloor, 1);
  assert.equal(safeJackOutState(connected).currentFloor, null);
  assert.equal(unsafeJackOutState(connected).currentFloor, null);
});

test("reconnect preserva RAM esgotada e só inicializa estado sem pool", () => {
  assert.equal(ramForReconnect({ ramMax: 10, ramCurrent: 0 }, 4), 0);
  assert.equal(ramForReconnect({ ramMax: 0, ramCurrent: 0 }, 4), 10);
  assert.equal(ramForReconnect({ ramMax: 10, ramCurrent: 99 }, 4), 10);
});

test("movimento wireless para no primeiro ponto acima do alcance e exatamente em 6m não desconecta", () => {
  const exact = stopAtWirelessAccessPointRange({ currentPosition: accessPoint.position, targetPosition: { x: 0.8, y: 0.5 }, accessPoint, map });
  assert.equal(exact.crossed, false);
  const crossed = stopAtWirelessAccessPointRange({ currentPosition: accessPoint.position, targetPosition: { x: 0.9, y: 0.5 }, accessPoint, map });
  assert.equal(crossed.crossed, true);
  assert.equal(crossed.distance, 6);
  assert.equal(Math.round(Math.abs(crossed.position.x - accessPoint.position.x) * map.width / map.pixelsPerMeter), 6);
});

test("rota não aceita estado de conexão ou Unsafe Jack Out enviado pelo cliente", async () => {
  const route = await import("../src/app/api/mesa/[id]/combat/net/connection/route.ts");
  const request = new Request("http://localhost/api/mesa/id/combat/net/connection", {
    method: "POST",
    body: JSON.stringify({ action: "jack_in", combatantId: "c", accessPointId: "ap", connectionType: "wireless", isJackedIn: true }),
    headers: { "content-type": "application/json" },
  });
  const response = await route.POST(request, { params: Promise.resolve({ id: "mesa" }) });
  assert.equal(response.status, 400);
  const body = await response.json() as { code?: string };
  assert.equal(body.code, "client_authority_forbidden");
});
