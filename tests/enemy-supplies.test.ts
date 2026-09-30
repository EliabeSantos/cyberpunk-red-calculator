/**
 * Suprimentos dos inimigos — munição e itens de cura.
 *
 * Prova as decisões de 30/09/2026:
 *   · munição é GARANTIDA (JSON + 2 cargas quando ele não trouxe nada);
 *   · cura é só UMA POSSIBILIDADE (50%, 1 ou 2 unidades, nunca obrigatória);
 *   · depois de pronta, a mochila roda exatamente como a do jogador: o tiro
 *     gasta 1 bala, ↻ recarregar consome a reserva e o curativo restaura HP.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  applyReload,
  consumeSupply,
  findAmmoSupplyIndex,
  getAmmoKind,
  getEnemySupplies,
  getSupplyHealAmount,
  healingSupplyPool,
  isHealingSupply,
  planReload,
  MAGAZINES_PER_ENEMY,
} from "../src/data/enemySupplies.ts";
import { gmEnemyCatalog, parseInventoryFromNotes, withDerivedSupplies } from "../src/data/gm-enemies.ts";
import type { EncounterData } from "../src/lib/gmStorage.ts";

const {
  rollAttack,
  reloadParticipantWeapon,
  applyParticipantHealingItem,
  getParticipantAmmoState,
  getParticipantHealingItems,
  getParticipantReloadState,
  getParticipantInventory,
} = await import("../src/lib/gmStorage.ts");

/** rng que entrega uma sequência fixa (e trava no último valor). */
function sequence(...values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    return value;
  };
}

/** rng que nunca deixa cair cura (0.99 nunca é < 0.5). */
const noHealing = (): number => 0.99;

const heavyPistol = {
  id: "heavy_pistol",
  name: "Heavy Pistol",
  damage: "3d6",
  attackType: "ranged" as const,
  skill: "Handgun",
  attackBase: 12,
  magazine: 8,
  ammo: 8,
};

/* -------------------------------------------------------------------------- *
 * Qualidade de munição
 * -------------------------------------------------------------------------- */

test("a qualidade da munição sai do nome da arma, e da perícia só quando o nome não ajuda", () => {
  assert.equal(getAmmoKind(heavyPistol), "pistol");
  assert.equal(getAmmoKind({ ...heavyPistol, name: "Assault Rifle", skill: "Shoulder Arms", magazine: 25 }), "rifle");
  assert.equal(getAmmoKind({ ...heavyPistol, name: "SMG", skill: "Autofire", magazine: 40 }), "smg");
  assert.equal(getAmmoKind({ ...heavyPistol, name: "Shotgun", skill: "Shoulder Arms", magazine: 4 }), "shotgun");
  // Heavy Machine Gun não pode ser lido como "smg" nem como pistola.
  assert.equal(getAmmoKind({ ...heavyPistol, name: "Heavy Machine Gun", skill: "Heavy Weapons", magazine: 50 }), "rifle");

  // Sem nome, a perícia decide.
  assert.equal(getAmmoKind({ name: "", skill: "Handgun" }), "pistol");
  assert.equal(getAmmoKind({ name: "", skill: "Shoulder Arms" }), "rifle");
  assert.equal(getAmmoKind({ name: "", skill: "Autofire" }), "smg");

  // Corpo a corpo não tem munição nenhuma.
  assert.equal(getAmmoKind({ ...heavyPistol, name: "Heavy Melee Weapon", attackType: "melee", magazine: undefined }), null);
  assert.equal(getAmmoKind({ name: "", skill: "Melee Weapon" }), null);
  assert.equal(getAmmoKind(null), null);
});

test("a munição específica é preferida e a de OUTRA arma nunca é consumida", () => {
  const pistolAmmo = { item: "Heavy Pistol Ammo", quantity: 16 };
  const shells = { item: "Shotgun Shells", quantity: 8 };

  assert.equal(findAmmoSupplyIndex([pistolAmmo, shells], "pistol"), 0);
  assert.equal(findAmmoSupplyIndex([pistolAmmo, shells], "shotgun"), 1);

  // Genérico ("Ammo") serve para qualquer arma que não tenha específica...
  const generic = { item: "Ammo", quantity: 100 };
  assert.equal(findAmmoSupplyIndex([generic], "rifle"), 0);
  // ...mas pistola não abre caixa de cartuchos de escopeta.
  assert.equal(findAmmoSupplyIndex([pistolAmmo], "shotgun"), -1);
  assert.equal(findAmmoSupplyIndex([], "pistol"), -1);
});

/* -------------------------------------------------------------------------- *
 * Criação do encontro
 * -------------------------------------------------------------------------- */

test("arma à distância sem munição no JSON recebe 2 cargas cheias", () => {
  const supplies = getEnemySupplies([], heavyPistol, noHealing);

  assert.deepEqual(supplies, [
    { item: "Pistol Ammunition", quantity: 8 * MAGAZINES_PER_ENEMY },
  ]);
});

test("o inventário do JSON é palavra final: nada é cortado nem duplicado", () => {
  const base = [
    { item: "Heavy Pistol Ammo", quantity: 16 },
    { item: "Trauma Patch", quantity: 1 },
    { item: "Agent", quantity: 1 },
  ];
  // rng que PASSARIA na rolagem de cura: ainda assim nada muda.
  const supplies = getEnemySupplies(base, heavyPistol, sequence(0.1, 0.1, 0.1));

  assert.deepEqual(supplies, base, "munição compatível e cura já presentes = intocável");
});

test("mochila vinda como texto da nota de GM é lida de volta", () => {
  const items = parseInventoryFromNotes(
    "Faction: 6th Street\nLevel: 1\nInventory: Heavy Pistol Ammo (16), Agent (1)",
  );
  assert.deepEqual(items, [
    { item: "Heavy Pistol Ammo", quantity: 16 },
    { item: "Agent", quantity: 1 },
  ]);
  assert.deepEqual(parseInventoryFromNotes("Faction: Maelstrom"), []);
  assert.deepEqual(parseInventoryFromNotes(undefined), []);
});

test("corpo a corpo e arma sem pente não recebem munição", () => {
  const knife = { id: "k", name: "Combat Knife", damage: "1d6", attackType: "melee" as const, skill: "Melee Weapon", attackBase: 9 };
  assert.deepEqual(getEnemySupplies([], knife, noHealing), []);
  // Nem munição, nem cura (rng travado em 0.99 nunca sorteia).
  assert.equal(getEnemySupplies([], knife, noHealing).length, 0);
});

test("cura é possibilidade: sem sorteio não entra nada, com sorteio entra 1 ou 2 unidades", () => {
  const pool = healingSupplyPool();
  assert.ok(pool.length >= 2, "o pool de cura existe");

  // 0.99 nunca é < 0.5 → a chance falha e o inimigo vai sem cura.
  assert.equal(getEnemySupplies([], heavyPistol, noHealing).some((i) => isHealingSupply(i.item)), false);

  // 0.1 passa na chance, aponta o primeiro do pool e fecha com 1 unidade.
  const lucky = getEnemySupplies([], heavyPistol, sequence(0.1, 0.1, 0.9));
  assert.deepEqual(
    lucky.find((i) => isHealingSupply(i.item)),
    { item: pool[0], quantity: 1 },
  );

  // Mesma chance, quantidade no alto → 2 unidades do último do pool.
  const stacked = getEnemySupplies([], heavyPistol, sequence(0.1, 0.99, 0.1));
  assert.deepEqual(
    stacked.find((i) => isHealingSupply(i.item)),
    { item: pool[pool.length - 1], quantity: 2 },
  );
});

/* -------------------------------------------------------------------------- *
 * Quanto cada item cura
 * -------------------------------------------------------------------------- */

test("HP curado sai do catálogo do jogador, com reserva para os nomes do bestiário", () => {
  assert.equal(getSupplyHealAmount("Stim"), 5);
  assert.equal(getSupplyHealAmount("MaxDoc"), 10);
  // Nomes do JSON do bestiário que não têm ficha no catálogo.
  assert.equal(getSupplyHealAmount("Trauma Patch"), 5);
  assert.equal(getSupplyHealAmount("Combat Stim"), 5);
  assert.equal(getSupplyHealAmount("Protein Pack"), 3);

  assert.equal(getSupplyHealAmount("Basic Medkit"), null, "não restaura HP");
  assert.equal(getSupplyHealAmount("Agent"), null);
  assert.equal(getSupplyHealAmount(""), null);
  assert.equal(isHealingSupply("Ammo"), false);
});

/* -------------------------------------------------------------------------- *
 * Fichas antigas
 * -------------------------------------------------------------------------- */

test("inimigo pré-mapeado ganha pente e mochila sem perder o que já tinha", () => {
  // É exatamente o formato dos `preMappedEnemies`: `ammo` é a CAPACIDADE e a
  // mochila só existe dentro do texto da nota de GM.
  const legacy = withDerivedSupplies({
    id: "x",
    schemaVersion: 1,
    createdAt: "2026-09-26T00:00:00.000Z",
    updatedAt: "2026-09-26T00:00:00.000Z",
    identity: { name: "Elite", archetype: "Elite Leader", threatLevel: "extreme" },
    stats: { INT: 5, REF: 6, DEX: 5, TECH: 4, COOL: 5, WILL: 5, LUCK: 3, MOVE: 5, BODY: 5, EMP: 4 },
    skills: {},
    weapons: [
      { id: "p", name: "Very Heavy Pistol", damage: "4d6", attackType: "ranged", skill: "Handgun", attackBase: 18, ammo: 8 },
      { id: "m", name: "Heavy Melee Weapon", damage: "3d6", attackType: "melee", skill: "Melee Weapon", attackBase: 18 },
    ],
    combat: { hp: { current: 55, max: 55 }, armor: { head: 14, body: 14 }, criticalInjuries: [] },
    gmNotes: "Faction: Aldecaldos\nInventory: Very Heavy Pistol Ammo (16), Radio (1)",
    conditions: [],
  });

  assert.equal(legacy.weapons[0].magazine, 8, "ammo vira capacidade do pente");
  assert.equal(legacy.weapons[1].magazine, undefined, "corpo a corpo continua sem pente");
  assert.deepEqual(legacy.inventory, [
    { item: "Very Heavy Pistol Ammo", quantity: 16 },
    { item: "Radio", quantity: 1 },
  ]);

  // Só preenche o que falta: a mochila já declarada não é substituída.
  const already = withDerivedSupplies({ ...legacy, inventory: [{ item: "SMG Ammo", quantity: 40 }] });
  assert.deepEqual(already.inventory, [{ item: "SMG Ammo", quantity: 40 }]);
});

test("todo inimigo do catálogo abriu com pente (arma à distância) e mochila definida", () => {
  assert.ok(gmEnemyCatalog.length > 0);
  for (const enemy of gmEnemyCatalog) {
    assert.ok(Array.isArray(enemy.inventory), `${enemy.id} sem mochila`);
    for (const weapon of enemy.weapons) {
      if (weapon.attackType !== "ranged") continue;
      assert.equal(typeof weapon.magazine, "number", `${enemy.id}/${weapon.id} sem pente`);
      assert.equal(weapon.ammo, weapon.magazine, `${enemy.id}/${weapon.id} não nasce cheio`);
    }
  }
});

/* -------------------------------------------------------------------------- *
 * Recarregar
 * -------------------------------------------------------------------------- */

test("recarregar enche o pente e desconta da reserva (some quando zera)", () => {
  const inventory = [{ item: "Heavy Pistol Ammo", quantity: 16 }];
  const plan = planReload({ name: "Heavy Pistol", skill: "Handgun" }, 0, 8, inventory);

  assert.equal(plan.canReload, true);
  assert.equal(plan.itemIndex, 0);
  assert.equal(plan.reserve, 16);
  assert.equal(plan.reason, null);

  const next = applyReload(plan, inventory);
  assert.deepEqual(next, [{ item: "Heavy Pistol Ammo", quantity: 8 }]);

  // Reserva exatamente igual ao que falta → item some da mochila.
  const exact = applyReload(planReload({ name: "Heavy Pistol", skill: "Handgun" }, 3, 8, [{ item: "Ammo", quantity: 5 }]), [
    { item: "Ammo", quantity: 5 },
  ]);
  assert.deepEqual(exact, []);
});

test("recarregar recusa pente cheio, munição incompatível e reserva curta", () => {
  const full = planReload({ name: "Heavy Pistol", skill: "Handgun" }, 8, 8, [{ item: "Heavy Pistol Ammo", quantity: 16 }]);
  assert.equal(full.canReload, false);
  assert.equal(full.reason, "Pente cheio.");

  const noAmmo = planReload({ name: "Heavy Pistol", skill: "Handgun" }, 0, 8, [{ item: "Agent", quantity: 1 }]);
  assert.equal(noAmmo.canReload, false);
  assert.equal(noAmmo.reason, "Sem munição compatível na mochila.");
  assert.equal(applyReload(noAmmo, [{ item: "Agent", quantity: 1 }]), null);

  const short = planReload({ name: "Heavy Pistol", skill: "Handgun" }, 0, 8, [{ item: "Heavy Pistol Ammo", quantity: 3 }]);
  assert.equal(short.canReload, false);
  assert.equal(short.reason, "Munição insuficiente: faltam 5 balas.");
});

/* -------------------------------------------------------------------------- *
 * Cartão do encontro
 * -------------------------------------------------------------------------- */

/** Participante de encontro com pistola de pente 8 cheio. */
function encounter(
  participant: Partial<EncounterData["participants"][number]> = {},
): EncounterData {
  return {
    id: "encontro-1",
    name: "Emboscada",
    faction: "6th Street",
    enemyCount: 1,
    createdAt: "2026-09-30T10:00:00.000Z",
    participants: [
      {
        enemyId: "recruit",
        id: "part-1",
        name: "Recruta",
        archetype: "Ranged Mook",
        faction: "6th Street",
        level: 1,
        threatLevel: "low",
        hp: { current: 35, max: 35 },
        armor: { head: 11, body: 11 },
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
        ...participant,
      },
    ],
  };
}

test("cada tiro gasta 1 bala do pente — e nunca deixa o pente negativo", () => {
  let current = encounter();
  for (let i = 0; i < 8; i++) {
    current = rollAttack(current, 0);
    assert.equal(current.participants[0].ammo, 7 - i, `tiro ${i + 1}`);
  }
  assert.equal(current.participants[0].ammo, 0, "pente zera");
  // Continuar atirando com o pente vazio não deixa valor negativo (a UI é quem
  // bloqueia, do mesmo jeito que a ficha do jogador).
  current = rollAttack(current, 0);
  assert.equal(current.participants[0].ammo, 0);
  // A reserva não foi tocada.
  assert.deepEqual(current.participants[0].inventory, [{ item: "Heavy Pistol Ammo", quantity: 16 }]);
});

test("arma corpo a corpo e ficha salva antiga (sem pente) não gastam nada", () => {
  const melee = encounter({ weaponName: "Combat Knife", weaponSkillId: "Melee Weapon", magazine: undefined, ammo: undefined, inventory: [] });
  assert.equal(getParticipantAmmoState(melee.participants[0]), null);
  assert.equal(getParticipantReloadState(melee.participants[0]), null, "o botão de recarregar some");

  const rolled = rollAttack(melee, 0);
  assert.equal(rolled.participants[0].ammo, undefined, "nada a gastar");

  // Ficha salva antiga: sem campo nenhum, mas a UI lê lista vazia e não quebra.
  const old = encounter({ magazine: undefined, ammo: undefined, inventory: undefined });
  assert.equal(old.participants[0].inventory, undefined, "o campo fica como estava");
  assert.deepEqual(getParticipantInventory(old.participants[0]), [], "mochila ausente vira lista vazia");
  assert.deepEqual(getParticipantHealingItems(old.participants[0]), []);
});

test("recarregar pelo cartão consome a reserva certa e devolve o pente cheio", () => {
  const fired = { ...encounter({ ammo: 0 }) };

  const reloaded = reloadParticipantWeapon(fired, 0);
  assert.ok("encounter" in reloaded, "recarregou");
  const after = reloaded.encounter.participants[0];
  assert.equal(after.ammo, 8, "pente cheio");
  assert.deepEqual(after.inventory, [{ item: "Heavy Pistol Ammo", quantity: 16 - 8 }]);

  // Pente cheio → recusa, sem tocar na mochila.
  const full = reloadParticipantWeapon(encounter(), 0);
  assert.ok("error" in full && full.error === "Pente cheio.");
});

test("item de cura restaura HP até o teto e some da mochila", () => {
  const base = encounter({
    hp: { current: 10, max: 35 },
    inventory: [{ item: "Stim", quantity: 2 }, { item: "Heavy Pistol Ammo", quantity: 16 }],
  });

  const used = applyParticipantHealingItem(base, 0, "Stim");
  assert.ok("encounter" in used, "o curativo foi usado");
  assert.equal(used.healed, 5, "Stim recupera 5 HP");
  assert.deepEqual(used.encounter.participants[0].hp, { current: 15, max: 35 });
  assert.deepEqual(used.encounter.participants[0].inventory, [
    { item: "Stim", quantity: 1 },
    { item: "Heavy Pistol Ammo", quantity: 16 },
  ]);

  // Cheio → nada a curar; item que não cura → não existe na mochila.
  const full = applyParticipantHealingItem(
    encounter({ hp: { current: 35, max: 35 }, inventory: [{ item: "Stim", quantity: 1 }] }),
    0,
    "Stim",
  );
  assert.ok("error" in full, "HP máximo recusa a cura");
  const agent = applyParticipantHealingItem(
    encounter({ hp: { current: 10, max: 35 }, inventory: [{ item: "Agent", quantity: 1 }] }),
    0,
    "Agent",
  );
  assert.ok("error" in agent, "Agent não cura");
});

test("a cura para exatamente no HP máximo (nunca passa do teto)", () => {
  const nearlyDead = encounter({
    hp: { current: 33, max: 35 },
    inventory: [{ item: "Stim", quantity: 1 }],
  });
  const used = applyParticipantHealingItem(nearlyDead, 0, "Stim");
  assert.ok("encounter" in used);
  assert.equal(used.healed, 2, "só o que faltava");
  assert.equal(used.encounter.participants[0].hp.current, 35);
});

test("o cartão lista os curativos com o valor que cada um devolve", () => {
  const items = getParticipantHealingItems({
    inventory: [{ item: "Trauma Patch", quantity: 1 }, { item: "Agent", quantity: 1 }, { item: "Ammo", quantity: 10 }],
  });
  assert.deepEqual(items, [{ name: "Trauma Patch", quantity: 1, amount: 5 }]);
});

test("abrir 1 unidade zera a pilha sem apagar as demais", () => {
  const inventory = [
    { item: "Stim", quantity: 1 },
    { item: "Heavy Pistol Ammo", quantity: 16 },
  ];
  assert.deepEqual(consumeSupply(inventory, "Stim"), [{ item: "Heavy Pistol Ammo", quantity: 16 }]);
  assert.deepEqual(consumeSupply(inventory, "Agent"), inventory, "item inexistente não muda nada");
});
