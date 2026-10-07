/**
 * Diagnóstico do ataque integrado da Mesa.
 *
 * Estes casos reproduzem o snapshot real de um inimigo: `attackBase` é o valor
 * pronto da definição da arma e pode não ser REF + nível (há 37 divergências no
 * catálogo atual). A resolução, a defesa Evasion e a fonte RNG são as mesmas
 * nos dois sentidos.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createTestRandomSource } from "../src/lib/random.ts";
import { execute } from "../src/lib/combat/engine.ts";
import type { CombatParticipant, CombatState } from "../src/lib/combat/contract.ts";
import { formatMesaAttackEvent } from "../src/lib/mesa/attackAudit.ts";

const enemy = (id: string, name: string): CombatParticipant => ({
  id,
  type: "enemy",
  name,
  source: { characterId: null, sourceKey: id, enemyId: "catalog-enemy" },
  // attackBase 12 is deliberately different from REF 6 + skill level 4 = 10.
  stats: { REF: 6, DEX: 6 },
  skills: { handgun: { stat: "REF", level: 4 }, evasion: { stat: "DEX", level: 4 } },
  weapons: [{ id: `${id}-weapon`, name: "Heavy Pistol", damage: "3d6", skill: "handgun", attackType: "handgun", attackBase: 12, ammo: 8 }],
  combat: { hp: { current: 30, max: 30 }, armor: { head: 0, body: 0 }, criticalInjuries: [], conditions: [], initiative: null, isDead: false },
});

const player = (id: string): CombatParticipant => ({
  id,
  type: "character",
  name: "Solo",
  source: { characterId: id, sourceKey: null, enemyId: null },
  stats: { REF: 7, DEX: 6 },
  skills: { handgun: { stat: "REF", level: 6 }, evasion: { stat: "DEX", level: 4 } },
  weapons: [{ id: `${id}-weapon`, name: "Heavy Pistol", damage: "3d6", skill: "handgun", attackType: "handgun", ammo: 8 }],
  combat: { hp: { current: 30, max: 30 }, armor: { head: 0, body: 0 }, criticalInjuries: [], conditions: [], initiative: null, isDead: false },
});

const state = (participants: CombatParticipant[]): CombatState => ({
  id: "diagnosis-combat",
  status: "active",
  round: 1,
  initiativeStarted: true,
  activeParticipantId: null,
  participants,
});

function attack(
  participants: CombatParticipant[],
  actorId: string,
  targetId: string,
  defense: { type: "dv"; value: number; source: "range_table" } | { type: "evasion" },
  random: number[],
  attackMode: "normal" | "aimed" = "normal",
) {
  return execute(
    state(participants),
    {
      type: "attack",
      actorId,
      targetId,
      weaponId: `${actorId}-weapon`,
      attackType: "handgun",
      attackMode,
      ...(attackMode === "aimed" ? { aimedTarget: "head" as const } : {}),
      defense,
    },
    createTestRandomSource(random),
  );
}

test("HIT/MISS compara total completo contra defenseValue, nunca contra os dados brutos", () => {
  const attacker = player("player");
  const target = enemy("enemy", "Soldier");

  const hitA = attack([attacker, target], attacker.id, target.id, { type: "dv", value: 2, source: "range_table" }, [5]);
  assert.equal(hitA.attackResult?.total, 18); // REF 7 + skill 6 + d10 5
  assert.equal(hitA.attackResult?.defenseValue, 2);
  assert.equal(hitA.attackResult?.hit, true);

  const hitB = attack([attacker, target], attacker.id, target.id, { type: "dv", value: 7, source: "range_table" }, [4]);
  assert.equal(hitB.attackResult?.total, 17);
  assert.equal(hitB.attackResult?.defenseValue, 7);
  assert.equal(hitB.attackResult?.hit, true);

  const missC = attack([attacker, target], attacker.id, target.id, { type: "dv", value: 17, source: "range_table" }, [4]);
  assert.equal(missC.attackResult?.total, 17);
  assert.equal(missC.attackResult?.defenseValue, 17);
  assert.equal(missC.attackResult?.hit, false);

  const missD = attack([attacker, target], attacker.id, target.id, { type: "dv", value: 18, source: "range_table" }, [4]);
  assert.equal(missD.attackResult?.total, 17);
  assert.equal(missD.attackResult?.defenseValue, 18);
  assert.equal(missD.attackResult?.hit, false);
});

test("aimed aplica -8 antes da comparação e preserva o resultado do Engine", () => {
  const attacker = player("player");
  const target = enemy("enemy", "Soldier");
  const result = attack([attacker, target], attacker.id, target.id, { type: "dv", value: 7, source: "range_table" }, [2], "aimed");

  assert.equal(result.attackResult?.total, 7); // 7 + 6 + 2 - 8
  assert.deepEqual(result.attackResult?.modifiers, [{ source: "Aimed shot", value: -8 }]);
  assert.equal(result.attackResult?.hit, false);
});

test("Enemy → Player usa attackBase do snapshot e Evasion real do Player", () => {
  const attacker = enemy("enemy", "Soldier");
  const target = player("player");
  // Attack: base 12 + roll 6 = 18. Defense: DEX 6 + Evasion 4 + roll 7 = 17.
  const result = execute(
    state([attacker, target]),
    {
      type: "attack",
      actorId: attacker.id,
      targetId: target.id,
      weaponId: "enemy-weapon",
      attackType: "handgun",
      attackMode: "normal",
      defense: { type: "evasion" },
    },
    createTestRandomSource([6, 7]),
  );

  assert.equal(result.ok, true);
  assert.equal(result.attackResult?.baseStat.value, 6);
  assert.equal(result.attackResult?.skill.value, 4);
  assert.equal(result.attackResult?.attackBase, 12);
  assert.equal(result.attackResult?.total, 18);
  assert.equal(result.attackResult?.defenseValue, 17);
  assert.equal(result.attackResult?.hit, true);
  assert.deepEqual(result.attackResult?.modifiers, []);
});

test("Player → Enemy usa o mesmo engine e a mesma regra de Evasion", () => {
  const attacker = player("player");
  const target = enemy("enemy", "Soldier");
  // Attack: REF 7 + skill 6 + roll 5 = 18. Defense: DEX 6 + Evasion 4 + roll 3 = 13.
  const result = execute(
    state([attacker, target]),
    {
      type: "attack",
      actorId: attacker.id,
      targetId: target.id,
      weaponId: "player-weapon",
      attackType: "handgun",
      attackMode: "normal",
      defense: { type: "evasion" },
    },
    createTestRandomSource([5, 3]),
  );

  assert.equal(result.ok, true);
  assert.equal(result.attackResult?.attackBase, undefined);
  assert.equal(result.attackResult?.total, 18);
  assert.equal(result.attackResult?.defenseValue, 13);
  assert.equal(result.attackResult?.hit, true);
});

test("Enemy → Enemy segue a mesma comparação e empate continua MISS", () => {
  const attacker = enemy("attacker", "Soldier");
  const target = enemy("target", "Soldier");
  // 12 + 1 = 13; defesa 6 + 4 + 3 = 13: empate é MISS pela regra existente.
  const result = execute(
    state([attacker, target]),
    {
      type: "attack",
      actorId: attacker.id,
      targetId: target.id,
      weaponId: "attacker-weapon",
      attackType: "handgun",
      attackMode: "normal",
      defense: { type: "evasion" },
    },
    createTestRandomSource([1, 1, 3]),
  );

  assert.equal(result.ok, true);
  assert.equal(result.attackResult?.total, 12); // 12 + (1 - 1)
  assert.equal(result.attackResult?.defenseValue, 13);
  assert.equal(result.attackResult?.hit, false);
});

test("CombatLog usa exatamente total e defenseValue produzidos pelo Engine", () => {
  const attacker = player("player");
  const target = enemy("enemy", "Soldier");
  const result = attack([attacker, target], attacker.id, target.id, { type: "evasion" }, [5, 3]);
  assert.equal(result.ok, true);
  assert.ok(result.attackResult);

  const text = formatMesaAttackEvent({ actorName: attacker.name, targetName: target.name, attackResult: result.attackResult });
  assert.match(text, /ataque 18/);
  assert.match(text, /defesa evasion 13 \[3\]/);
  assert.doesNotMatch(text, /defesa evasion 3/);
  assert.match(text, /ACERTO/);
});

test("auditoria de ataque registra Cover server-side sem inventar modificador", () => {
  const attacker = player("player");
  const target = enemy("enemy", "Soldier");
  const result = attack([attacker, target], attacker.id, target.id, { type: "evasion" }, [5, 3]);
  assert.ok(result.attackResult);
  const text = formatMesaAttackEvent({
    actorName: attacker.name,
    targetName: target.name,
    attackResult: result.attackResult,
    tacticalCover: { status: "partial_obstruction", lineOfSight: "clear", covered: false, blockedSamples: 3, totalSamples: 9 },
  });
  assert.match(text, /cover partial_obstruction \(3\/9\)/);
  assert.doesNotMatch(text, /-2|-4/);
});
