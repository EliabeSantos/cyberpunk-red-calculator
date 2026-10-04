/**
 * F1.2 — Extração das regras de combate do `gmStorage.ts`.
 *
 * A extração é ARQUITETURAL: a regra não mudou de lugar só no papel, ela
 * mudou de arquivo sem mudar de comportamento. Este arquivo protege as duas
 * metades disso:
 *
 *   1. `gmStorage` re-exporta o MESMO objeto de função de cada módulo novo
 *      (copiar a implementação passaria no teste de comportamento, mas seria
 *      exatamente a duplicação que esta etapa existe para eliminar);
 *   2. chamando a função DIRETAMENTE pelo módulo novo, o resultado é o de
 *      sempre — ataques, evasão, dano, recarga, cura e condições.
 *
 * As asserções são as regras ATUAIS, inclusive as divergências conhecidas do
 * F1.0 (§13) — nada aqui corrige ROF, Death Save, wound penalty etc. Quem já
 * cobre essas regras de ponta a ponta é a suíte antiga, importando pelo
 * `gmStorage`; os dois caminhos precisam continuar vendo a mesma função.
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { EncounterData, EncounterParticipant } from "../src/lib/gmStorage.ts";

const gmStorage = await import("../src/lib/gmStorage.ts");
const enemyAttacks = await import("../src/lib/combat/enemyAttacks.ts");
const enemyDamage = await import("../src/lib/combat/enemyDamage.ts");
const participantSupplies = await import("../src/lib/combat/participantSupplies.ts");
const enemyConditions = await import("../src/lib/combat/enemyConditions.ts");

/* -------------------------------------------------------------------------- *
 * Fixtures — a mesma forma salva pelo `saveEncounter` (nada foi afrouxado).
 * -------------------------------------------------------------------------- */

function participante(overrides: Partial<EncounterParticipant> = {}): EncounterParticipant {
  return {
    enemyId: "recruit",
    id: "part-1",
    name: "Recruta",
    archetype: "Ranged Mook",
    faction: "6th Street",
    level: 1,
    threatLevel: "low",
    hp: { current: 35, max: 35 },
    // Corpo "vencido" de propósito: dá para ver a subdérmica valer mais.
    armor: { head: 11, body: 4 },
    conditions: [],
    isPlayer: false,
    weaponName: "Heavy Pistol",
    weaponSkillId: "Handgun",
    weaponSkillName: "Handgun",
    refStat: 6,
    skillValue: 12,
    attackBase: 12,
    evasionSkillName: "Evasion",
    evasionSkillLevel: 5,
    damageExpression: "3d6",
    lastAttackRoll: null,
    lastDamageRoll: null,
    lastEvasionRoll: null,
    initiative: null,
    personalityTraits: [],
    magazine: 8,
    ammo: 8,
    inventory: [{ item: "Heavy Pistol Ammo", quantity: 16 }],
    ...overrides,
  };
}

function encontro(participant: EncounterParticipant = participante()): EncounterData {
  return {
    id: "encontro-1",
    name: "Emboscada",
    faction: "6th Street",
    enemyCount: 1,
    createdAt: "2026-10-03T10:00:00.000Z",
    participants: [participant],
  };
}

const soma = (valores: number[]): number => valores.reduce((total, valor) => total + valor, 0);
const somaModifiers = (modifiers: { value: number }[] | undefined): number =>
  soma((modifiers ?? []).map((modifier) => modifier.value));

/* -------------------------------------------------------------------------- *
 * 1. Re-export de compatibilidade — a MESMA função, não uma cópia.
 * -------------------------------------------------------------------------- */

test("gmStorage re-exporta o MESMO objeto de cada módulo extraído", () => {
  const pares: Array<[string, unknown]> = [
    ["getEnemyEvasionSkill", enemyAttacks.getEnemyEvasionSkill],
    ["getEvasionBase", enemyAttacks.getEvasionBase],
    ["getParticipantAttackModifiers", enemyAttacks.getParticipantAttackModifiers],
    ["getParticipantEvasionModifiers", enemyAttacks.getParticipantEvasionModifiers],
    ["getParticipantInitiativeModifiers", enemyAttacks.getParticipantInitiativeModifiers],
    ["getParticipantInitiativeBonus", enemyAttacks.getParticipantInitiativeBonus],
    ["rollAttack", enemyAttacks.rollAttack],
    ["rollEvasion", enemyAttacks.rollEvasion],
    ["isUnarmedParticipant", enemyDamage.isUnarmedParticipant],
    ["getParticipantDamageExpression", enemyDamage.getParticipantDamageExpression],
    ["getParticipantArmorSP", enemyDamage.getParticipantArmorSP],
    ["rollDamage", enemyDamage.rollDamage],
    ["applyDamageToParticipant", enemyDamage.applyDamageToParticipant],
    ["updateParticipantHP", enemyDamage.updateParticipantHP],
    ["getParticipantInventory", participantSupplies.getParticipantInventory],
    ["getParticipantAmmoState", participantSupplies.getParticipantAmmoState],
    ["getParticipantReloadState", participantSupplies.getParticipantReloadState],
    ["getParticipantHealingItems", participantSupplies.getParticipantHealingItems],
    ["getParticipantSupplies", participantSupplies.getParticipantSupplies],
    ["reloadParticipantWeapon", participantSupplies.reloadParticipantWeapon],
    ["applyParticipantHealingItem", participantSupplies.applyParticipantHealingItem],
    ["addParticipantCondition", enemyConditions.addParticipantCondition],
    ["removeParticipantCondition", enemyConditions.removeParticipantCondition],
  ];

  const viaGmStorage = gmStorage as unknown as Record<string, unknown>;
  for (const [nome, doModulo] of pares) {
    assert.equal(viaGmStorage[nome], doModulo, `gmStorage.${nome} é o MESMO objeto`);
  }
});

/* -------------------------------------------------------------------------- *
 * 2. Ataque e evasão — direto de `enemyAttacks`.
 * -------------------------------------------------------------------------- */

test("ataque vindo do módulo novo gasta 1 bala, soma os implantes e não muta a origem", () => {
  // `weaponSkillId` em minúsculas é o que `normalizeSkillId` grava na criação
  // (`isRangedSkillId` casa só ids normalizados) — é assim que o bônus de
  // Targeting Scope entra no ataque à distância.
  const origem = encontro(
    participante({ weaponSkillId: "handgun", implants: ["Targeting Scope"] }),
  );
  const antes = structuredClone(origem);

  const rolar = enemyAttacks.rollAttack(origem, 0);
  assert.deepEqual(origem, antes, "a origem não foi tocada");

  const p = rolar.participants[0];
  const roll = p.lastAttackRoll;
  assert.ok(roll, "o ataque foi registrado");
  assert.equal(p.ammo, 7, "um tiro = uma bala do pente");
  assert.deepEqual(
    roll.modifiers,
    [{ source: "Targeting Scope (longa distância)", value: 1 }],
    "o bônus do implante entra na rolagem",
  );
  assert.equal(soma(roll.diceRolls), roll.diceTotal, "os dados somam o total de dados");
  assert.equal(
    roll.total,
    12 + roll.diceTotal + somaModifiers(roll.modifiers),
    "attackBase + dados + bônus",
  );
});

test("evasão vindo do módulo novo usa REF + nível e não gasta munição", () => {
  const origem = encontro();
  const antes = structuredClone(origem);

  assert.equal(enemyAttacks.getEvasionBase(participante()), 11, "REF 6 + nível 5");
  assert.equal(enemyAttacks.getEvasionBase({ refStat: 7 }), 7, "ficha antiga cai no REF puro");

  const rolar = enemyAttacks.rollEvasion(origem, 0);
  assert.deepEqual(origem, antes, "a origem não foi tocada");

  const p = rolar.participants[0];
  const roll = p.lastEvasionRoll;
  assert.ok(roll, "a evasão foi registrada");
  assert.equal(p.ammo, 8, "evasão não consome bala");
  assert.equal(
    roll.total,
    11 + roll.diceTotal + somaModifiers(roll.modifiers),
    "base + dados + implantes",
  );
});

/* -------------------------------------------------------------------------- *
 * 3. Dano — direto de `enemyDamage`.
 * -------------------------------------------------------------------------- */

test("dano vindo do módulo novo respeita SP por local, degrada e clampeia em 0", () => {
  const comSubdermica = participante({ armor: { head: 11, body: 4 }, implants: ["Subdermal Armor"] });
  assert.equal(enemyDamage.getParticipantArmorSP(comSubdermica, "head"), 11, "cabeça ignora cyberware");
  assert.equal(enemyDamage.getParticipantArmorSP(comSubdermica, "body"), 11, "vale o maior: 4 × 11");

  const origem = encontro(comSubdermica);
  const antes = structuredClone(origem);

  // 10 contra SP 11 não passa: nada de HP, nada de degradação.
  const raspou = enemyDamage.applyDamageToParticipant(origem, 0, 10, false, "head");
  assert.equal(raspou.participants[0].hp.current, 35);
  assert.equal(raspou.participants[0].armor.head, 11);

  // 20 contra SP 11 do corpo → 9 de dano e a veste perde 1 SP.
  // (Comportamento ATUAL preservado: quem degrada é sempre a veste, mesmo
  // quando quem protegeu foi a subdérmica — pendência do F1.0 §13.)
  const penetrou = enemyDamage.applyDamageToParticipant(origem, 0, 20, false, "body");
  assert.equal(penetrou.participants[0].hp.current, 26, "35 − 9");
  assert.equal(penetrou.participants[0].armor.body, 3, "veste 4 → 3");

  // Dano maior que o HP nunca deixa valor negativo.
  const caiu = enemyDamage.applyDamageToParticipant(origem, 0, 999, false, "body");
  assert.equal(caiu.participants[0].hp.current, 0, "HP clampeado em 0");

  assert.deepEqual(origem, antes, "a origem não foi tocada");
  assert.equal(enemyDamage.updateParticipantHP(origem, 0, -5).participants[0].hp.current, 0);

  const rolar = enemyDamage.rollDamage(encontro(), 0);
  const damage = rolar.participants[0].lastDamageRoll;
  assert.ok(damage, "o dano foi registrado");
  assert.equal(damage.expression, "3d6", "a expressão mostrada continua a da arma");
  assert.equal(soma(damage.rolls), damage.total, "os dados somam o total");
});

/* -------------------------------------------------------------------------- *
 * 4. Recarga e cura — direto de `participantSupplies`.
 * -------------------------------------------------------------------------- */

test("recarga vindo do módulo novo enche o pente pela reserva certa", () => {
  const origem = encontro(participante({ ammo: 0 }));
  const antes = structuredClone(origem);

  const recarga = participantSupplies.reloadParticipantWeapon(origem, 0);
  assert.ok("encounter" in recarga, "recarregou");
  assert.deepEqual(origem, antes, "a origem não foi tocada");

  const depois = recarga.encounter.participants[0];
  assert.equal(depois.ammo, 8, "pente cheio");
  assert.deepEqual(depois.inventory, [{ item: "Heavy Pistol Ammo", quantity: 16 - 8 }]);

  const cheio = participantSupplies.reloadParticipantWeapon(encontro(), 0);
  assert.ok("error" in cheio && cheio.error === "Pente cheio.", "pente cheio recusa");
});

test("cura vindo do módulo novo restaura até o teto e consome a unidade", () => {
  const origem = encontro(
    participante({
      hp: { current: 10, max: 35 },
      inventory: [{ item: "Stim", quantity: 2 }, { item: "Heavy Pistol Ammo", quantity: 16 }],
    }),
  );
  const antes = structuredClone(origem);

  const usou = participantSupplies.applyParticipantHealingItem(origem, 0, "Stim");
  assert.ok("encounter" in usou, "o item foi usado");
  assert.deepEqual(origem, antes, "a origem não foi tocada");

  assert.equal(usou.healed, 5, "Stim recupera 5 HP");
  assert.deepEqual(usou.encounter.participants[0].hp, { current: 15, max: 35 });
  assert.deepEqual(usou.encounter.participants[0].inventory, [
    { item: "Stim", quantity: 1 },
    { item: "Heavy Pistol Ammo", quantity: 16 },
  ]);

  const cheio = participantSupplies.applyParticipantHealingItem(
    encontro(participante({ hp: { current: 35, max: 35 }, inventory: [{ item: "Stim", quantity: 1 }] })),
    0,
    "Stim",
  );
  assert.ok("error" in cheio, "HP máximo recusa a cura");
});

/* -------------------------------------------------------------------------- *
 * 5. Condições — direto de `enemyConditions`.
 * -------------------------------------------------------------------------- */

test("condições vindo do módulo novo adiciona uma vez só e remove pelo id", () => {
  const origem = encontro();
  const antes = structuredClone(origem);

  const adicionou = enemyConditions.addParticipantCondition(origem, 0, { id: "stunned", name: "Stunned" });
  assert.deepEqual(origem, antes, "a origem não foi tocada");
  assert.equal(adicionou.participants[0].conditions.length, 1);

  const repetiu = enemyConditions.addParticipantCondition(adicionou, 0, { id: "stunned", name: "Stunned" });
  assert.equal(repetiu, adicionou, "condição repetida devolve o MESMO encontro");

  const removeu = enemyConditions.removeParticipantCondition(adicionou, 0, "stunned");
  assert.deepEqual(removeu.participants[0].conditions, [], "removeu pelo id");
  assert.deepEqual(adicionou.participants[0].conditions, [{ id: "stunned", name: "Stunned" }]);
});
