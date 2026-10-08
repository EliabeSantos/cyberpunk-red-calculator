import assert from "node:assert/strict";
import test from "node:test";
import { applyProgramDamage, activateBlackIce, brainDamageForIce, iceAttack, resolveNetAttack, slideBlackIce } from "../src/lib/mesa/netCombat.ts";
import { advanceTurn, sortByInitiative } from "../src/lib/combatEngine.ts";
import { netIceCombatantId } from "../src/lib/mesa/store.ts";
import type { NetBlackIce, NetProgram } from "../src/lib/mesa/types.ts";

const rng = (value: number) => ({ d10: () => value, roll: () => ({ total: value, rolls: [value], expression: "1d10", type: "damage", label: "test" }) });
const ice: NetBlackIce = { id: "ice-1", nodeId: "node-1", architectureId: "arch-1", floorIndex: 1, name: "Wisp", type: "anti_personnel", speed: 4, per: 12, def: 10, rezz: 3, maxRezz: 3, attack: 4, state: "inactive", brainDamage: 2 };
const program: NetProgram = { id: "prog-1", name: "Shield", attackBonus: 2, damage: 2, rezz: 2, maxRezz: 2, state: "active" };

test("NET attack uses Interface + Program bonus and defender wins ties", () => {
  assert.deepEqual(resolveNetAttack({ interfaceRank: 4, programAttackBonus: 2, defense: 6, rng: rng(2) }), { roll: 2, bonus: 6, total: 8, defense: 6, hit: true });
  assert.equal(resolveNetAttack({ interfaceRank: 4, programAttackBonus: 0, defense: 6, rng: rng(2) }).hit, false);
});

test("Program Damage reduces REZZ without touching physical HP", () => {
  assert.deepEqual(applyProgramDamage(program, 2), { ...program, rezz: 0, state: "destroyed" });
});

test("Black ICE activation is idempotent and records initiative/engagement", () => {
  const active = activateBlackIce(ice, rng(7), "runner-1");
  assert.equal(active.initiative, 11);
  assert.equal(active.engagedNetrunnerId, "runner-1");
  assert.deepEqual(activateBlackIce(active, rng(1), "runner-2"), active);
});

test("Slide disengages on success and does not destroy ICE", () => {
  const engaged = { ...ice, state: "active" as const, engagedNetrunnerId: "runner-1" };
  const result = slideBlackIce({ ice: engaged, interfaceRank: 8, programBonus: 2, rng: rng(5) });
  assert.equal(result.resolution.hit, true);
  assert.equal(result.ice.engagedNetrunnerId, undefined);
  assert.equal(result.ice.state, "active");
});

test("ICE attack is server-side and anti-personnel damage is separate Brain Damage", () => {
  const result = iceAttack({ ice: { ...ice, state: "active" }, targetDefense: 10, rng: rng(7) });
  assert.equal(result.hit, true);
  assert.equal(brainDamageForIce(ice), 2);
  assert.equal(program.rezz, 2);
});

test("ICE combatant ID is stable/unique and participates in the existing turn order", () => {
  const first = netIceCombatantId("arch-1", "node-1");
  assert.equal(first, netIceCombatantId("arch-1", "node-1"));
  assert.notEqual(first, netIceCombatantId("arch-1", "node-2"));
  const order = sortByInitiative([
    { id: "runner", initiative: 12, isDead: false, sortOrder: 0 },
    { id: first, initiative: 15, isDead: false, sortOrder: 1 },
  ]);
  assert.deepEqual(order.map((entry) => entry.id), [first, "runner"]);
  assert.deepEqual(advanceTurn(order.map((entry) => entry.id), first, 1, () => true), { kind: "turn", activeCombatantId: "runner", round: 1 });
});
