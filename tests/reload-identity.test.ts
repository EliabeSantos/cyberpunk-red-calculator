/**
 * F0.6 — Identidade da ARMA e da MUNIÇÃO no RELOAD (M7: "reload pode
 * consumir/alterar a munição errada").
 *
 * O problema não estava no índice da arma (`reloadWeapon` sempre achou a arma
 * pelo `weaponId` e a reserva pelo `item.id`), mas na QUALIDADE escolhida para
 * encher o pente: o predicado antigo casava por qualquer cláusula do nome e
 * `find` devolvia o primeiro item do inventário que desse match — um rifle de
 * `shoulder_arms` enchia o pente com "Pistol Ammunition" e uma pistola com
 * "Shotgun Shells" se a escopeta tivesse sido comprada antes.
 *
 * Depois da correção a ficha do jogador usa o MESMO classificador do bestiário
 * e do encontro (`getAmmoKind`) e a MESMA regra de escolha da reserva
 * (`findAmmoIndexByNames`: específico → genérico, nunca de outra qualidade).
 * Nenhuma regra de recarga mudou: continua enchendo até o topo (`magazine`) e
 * consumindo só o que falta.
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { Character, InventoryItem, Weapon } from "../src/types/character.ts";
import type { EncounterData } from "../src/lib/gmStorage.ts";

/** window/localStorage mínimo — mesmo padrão de `tests/encounter-roster.test.ts`. */
const storage = new Map<string, string>();
(globalThis as { window?: unknown }).window = {
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  },
};

const { reloadWeapon } = await import("../src/lib/attacks.ts");
const { createEmptyCharacter } = await import("../src/types/character.ts");
const { upsertCharacter, loadCharacters } = await import("../src/lib/storage.ts");
const {
  reloadParticipantWeapon,
  saveEncounter,
  loadEncounters,
} = await import("../src/lib/gmStorage.ts");

/* -------------------------------------------------------------------------- *
 * Fixtures
 * -------------------------------------------------------------------------- */

const PERSONAGEM_ID = "f06-personagem";

/** Arma com pente. Nome/péricia podem ser sobrescritos para o caso de teste. */
function arma(id: string, overrides: Partial<Weapon> = {}): Weapon {
  return {
    id,
    name: "Heavy Pistol",
    damage: "3d6",
    rateOfFire: 2,
    attackType: "handgun",
    skill: "handgun",
    magazine: 6,
    ammo: 0,
    ...overrides,
  };
}

/** Pilha de munição do catálogo (id === catalogItemId, como no jogo). */
function municao(catalogItemId: string, name: string, quantity: number): InventoryItem {
  return { id: catalogItemId, catalogItemId, name, quantity, category: "ammunition" };
}

const municaoPistol = (quantity = 50): InventoryItem =>
  municao("pistol_ammo", "Pistol Ammunition", quantity);
const municaoRifle = (quantity = 50): InventoryItem =>
  municao("rifle_ammo", "Rifle Ammunition", quantity);
const cartuchosShotgun = (quantity = 20): InventoryItem =>
  municao("shotgun_shells", "Shotgun Shells", quantity);

function personagem(weapons: Weapon[], inventory: InventoryItem[]): Character {
  return { ...createEmptyCharacter(PERSONAGEM_ID), weapons, inventory };
}

function armaDe(character: Character, weaponId: string): Weapon {
  const weapon = character.weapons.find((entry) => entry.id === weaponId);
  assert.ok(weapon, `arma ${weaponId} deveria existir`);
  return weapon;
}

function pilhaDe(character: Character, catalogItemId: string): InventoryItem | undefined {
  return character.inventory.find((entry) => entry.catalogItemId === catalogItemId);
}

/** Narrowing: recarga bem-sucedida devolve o personagem; erro falha o teste. */
function recarregado(
  result: { character: Character } | { error: string },
): Character {
  if ("error" in result) assert.fail(`esperava recarga, veio erro: ${result.error}`);
  return result.character;
}

function recarregadoNoEncontro(
  result: { encounter: EncounterData } | { error: string },
): EncounterData {
  if ("error" in result) assert.fail(`esperava recarga, veio erro: ${result.error}`);
  return result.encounter;
}

/* -------------------------------------------------------------------------- *
 * Teste 1 e 2 — recarregar uma arma não toca a outra
 * -------------------------------------------------------------------------- */

test("Teste 1 — reload em A recarrega só A; B fica exatamente onde estava", () => {
  const original = personagem(
    [arma("weapon-a", { magazine: 6, ammo: 0 }), arma("weapon-b", { magazine: 12, ammo: 5 })],
    [municaoPistol(50)],
  );
  const character = recarregado(reloadWeapon(original, "weapon-a"));

  assert.equal(armaDe(character, "weapon-a").ammo, 6, "A encheu (0 → 6)");
  assert.equal(armaDe(character, "weapon-b").ammo, 5, "B continua com 5/12");
  assert.equal(armaDe(character, "weapon-b").magazine, 12, "pente de B intacto");
  assert.equal(pilhaDe(character, "pistol_ammo")?.quantity, 44, "reserva: 50 − 6");
  // A entrada original não é mutada (o reload devolve um personagem novo).
  assert.equal(armaDe(original, "weapon-a").ammo, 0, "original intacto");
  assert.equal(pilhaDe(original, "pistol_ammo")?.quantity, 50, "reserva original intacta");
});

test("Teste 2 — reload em B recarrega só B; A continua vazia", () => {
  const original = personagem(
    [arma("weapon-a", { magazine: 6, ammo: 0 }), arma("weapon-b", { magazine: 12, ammo: 5 })],
    [municaoPistol(50)],
  );
  const character = recarregado(reloadWeapon(original, "weapon-b"));

  assert.equal(armaDe(character, "weapon-b").ammo, 12, "B encheu (5 → 12)");
  assert.equal(armaDe(character, "weapon-a").ammo, 0, "A continua 0/6");
  assert.equal(pilhaDe(character, "pistol_ammo")?.quantity, 43, "reserva: 50 − 7 (só o que faltava)");
});

/* -------------------------------------------------------------------------- *
 * Teste 3 — mesmo nome não é identidade
 * -------------------------------------------------------------------------- */

test("Teste 3 — duas armas com o MESMO nome continuam independentes", () => {
  const original = personagem(
    [
      arma("weapon-a", { name: "Heavy Pistol", magazine: 6, ammo: 0 }),
      arma("weapon-b", { name: "Heavy Pistol", magazine: 6, ammo: 3 }),
    ],
    [municaoPistol(50)],
  );
  const character = recarregado(reloadWeapon(original, "weapon-a"));

  const iguais = character.weapons.filter((entry) => entry.name === "Heavy Pistol");
  assert.equal(iguais.length, 2, "as duas continuam na ficha");
  assert.equal(armaDe(character, "weapon-a").ammo, 6, "A mudou");
  assert.equal(armaDe(character, "weapon-b").ammo, 3, "B não mudou (nem por nome, nem por posição)");
  assert.equal(pilhaDe(character, "pistol_ammo")?.quantity, 44, "uma única recarga = um único consumo");
});

/* -------------------------------------------------------------------------- *
 * Teste 4 — reordenação preserva a identidade
 * -------------------------------------------------------------------------- */

test("Teste 4 — recarregar B e depois reordenar: B continua sendo a arma alterada", () => {
  const original = personagem(
    [
      arma("weapon-a", { magazine: 6, ammo: 0 }),
      arma("weapon-b", { magazine: 12, ammo: 5 }),
      arma("weapon-c", { magazine: 4, ammo: 4 }),
    ],
    [municaoPistol(50)],
  );
  const character = recarregado(reloadWeapon(original, "weapon-b"));

  // Reordenação (ex.: o jogador reorganiza a ficha) — a identidade não muda.
  const reordered = [character.weapons[2], character.weapons[0], character.weapons[1]]; // [C, A, B]
  const reorderedCharacter: Character = { ...character, weapons: reordered };

  assert.deepEqual(
    reordered.map((entry) => entry.id),
    ["weapon-c", "weapon-a", "weapon-b"],
    "ordem nova",
  );
  assert.equal(armaDe(reorderedCharacter, "weapon-b").ammo, 12, "B é a recarregada");
  assert.equal(armaDe(reorderedCharacter, "weapon-a").ammo, 0, "A intacta");
  assert.equal(armaDe(reorderedCharacter, "weapon-c").ammo, 4, "C intacta");
  assert.equal(pilhaDe(reorderedCharacter, "pistol_ammo")?.quantity, 43, "reserva coerente com UMA recarga");
});

/* -------------------------------------------------------------------------- *
 * Teste 5 — munição reserva
 * -------------------------------------------------------------------------- */

test("Teste 5 — a reserva é consumida exatamente em falta × cargas (regra do projeto)", () => {
  // Pente de 10 totalmente vazio, reserva de 30.
  const vazia = recarregado(
    reloadWeapon(
      personagem([arma("weapon-a", { name: "Assault Rifle", skill: "shoulder_arms", attackType: "rifle", magazine: 10, ammo: 0 })], [municaoRifle(30)]),
      "weapon-a",
    ),
  );
  assert.equal(armaDe(vazia, "weapon-a").ammo, 10, "pente cheio");
  assert.equal(pilhaDe(vazia, "rifle_ammo")?.quantity, 20, "reserva 30 → 20");

  // Pente meio usada: só o que falta é gasto (enchendo até o topo).
  const meio = recarregado(
    reloadWeapon(
      personagem([arma("weapon-a", { name: "Assault Rifle", skill: "shoulder_arms", attackType: "rifle", magazine: 10, ammo: 4 })], [municaoRifle(30)]),
      "weapon-a",
    ),
  );
  assert.equal(armaDe(meio, "weapon-a").ammo, 10, "4 → 10");
  assert.equal(pilhaDe(meio, "rifle_ammo")?.quantity, 24, "reserva 30 → 24 (faltavam 6)");

  // Reserva menor que o que falta → recusa, sem mutar nada.
  const personagemCurto = personagem(
    [arma("weapon-a", { name: "Assault Rifle", skill: "shoulder_arms", attackType: "rifle", magazine: 10, ammo: 0 })],
    [municaoRifle(3)],
  );
  const curto = reloadWeapon(personagemCurto, "weapon-a");
  assert.ok("error" in curto, "reserva insuficiente recusa");
  assert.equal(armaDe(personagemCurto, "weapon-a").ammo, 0, "pente intacto");
  assert.equal(pilhaDe(personagemCurto, "rifle_ammo")?.quantity, 3, "reserva intacta");
});

/* -------------------------------------------------------------------------- *
 * Teste 6 — munição de outro tipo NUNCA entra no pente (o bug M7)
 * -------------------------------------------------------------------------- */

test("Teste 6a — rifle sem munição de rifle recusa em vez de gastar munição de pistola", () => {
  const original = personagem(
    [arma("weapon-rifle", { name: "Assault Rifle", skill: "shoulder_arms", attackType: "rifle", magazine: 25, ammo: 0 })],
    [municaoPistol(50)],
  );
  const result = reloadWeapon(original, "weapon-rifle");

  assert.ok("error" in result, "não havia munição compatível → erro");
  assert.equal(result.error, "Nenhuma munição encontrada no inventário.");
  assert.equal(armaDe(original, "weapon-rifle").ammo, 0, "pente do rifle intacto");
  assert.equal(pilhaDe(original, "pistol_ammo")?.quantity, 50, "munição de pistola intacta");
});

test("Teste 6b — escopeta comprada ANTES não vira munição da pistola (ordem não decide)", () => {
  const original = personagem(
    [arma("weapon-a", { magazine: 6, ammo: 0 })],
    [cartuchosShotgun(20), municaoPistol(50)], // escopeta primeiro no inventário
  );
  const character = recarregado(reloadWeapon(original, "weapon-a"));

  assert.equal(armaDe(character, "weapon-a").ammo, 6, "pistola recarregada");
  assert.equal(pilhaDe(character, "shotgun_shells")?.quantity, 20, "cartuchos de escopeta intactos");
  assert.equal(pilhaDe(character, "pistol_ammo")?.quantity, 44, "gastou a munição de pistola");
});

test("Teste 6c — com as duas pilhas na mochila, escolhe a da QUALIDADE da arma", () => {
  const original = personagem(
    [arma("weapon-rifle", { name: "Assault Rifle", skill: "shoulder_arms", attackType: "rifle", magazine: 25, ammo: 0 })],
    [municaoPistol(50), municaoRifle(40)], // pistola primeiro, mas a certa é a de rifle
  );
  const character = recarregado(reloadWeapon(original, "weapon-rifle"));

  assert.equal(armaDe(character, "weapon-rifle").ammo, 25, "rifle recarregado");
  assert.equal(pilhaDe(character, "pistol_ammo")?.quantity, 50, "munição de pistola intocada");
  assert.equal(pilhaDe(character, "rifle_ammo")?.quantity, 15, "gastou a de rifle (40 − 25)");
});

/* -------------------------------------------------------------------------- *
 * Teste 7 — pente já cheio
 * -------------------------------------------------------------------------- */

test("Teste 7 — pente já cheio devolve erro e não produz mutação nenhuma", () => {
  const original = personagem(
    [arma("weapon-b", { magazine: 12, ammo: 12 })],
    [municaoPistol(50)],
  );
  const result = reloadWeapon(original, "weapon-b");

  assert.ok("error" in result, "pente cheio recusa");
  assert.equal(result.error, "Heavy Pistol já está cheia.");
  assert.deepEqual(original.weapons[0], arma("weapon-b", { magazine: 12, ammo: 12 }), "arma intacta");
  assert.deepEqual(original.inventory, [municaoPistol(50)], "reserva intacta");
});

test("Teste 7b — arma sem magazine e arma inexistente também não mutam", () => {
  const semPente = personagem([arma("weapon-mele", { magazine: undefined, ammo: undefined })], [municaoPistol(50)]);
  const erroPente = reloadWeapon(semPente, "weapon-mele");
  assert.ok("error" in erroPente);
  assert.equal(erroPente.error, "Heavy Pistol não possui magazine.");
  assert.deepEqual(semPente.inventory, [municaoPistol(50)]);

  const desconhecida = reloadWeapon(personagem([arma("weapon-a")], [municaoPistol(50)]), "outra-arma");
  assert.ok("error" in desconhecida);
  assert.equal(desconhecida.error, "Arma não encontrada.");
});

/* -------------------------------------------------------------------------- *
 * Teste 8 — estado persistido
 * -------------------------------------------------------------------------- */

test("Teste 8a — reload → save → load mantém arma, pente e reserva corretos (ficha do jogador)", () => {
  const original = personagem(
    [arma("weapon-a", { magazine: 6, ammo: 0 }), arma("weapon-b", { magazine: 12, ammo: 5 })],
    [municaoPistol(50)],
  );
  const character = recarregado(reloadWeapon(original, "weapon-a"));

  upsertCharacter(character);
  const reloaded = loadCharacters().find((entry) => entry.id === PERSONAGEM_ID);
  assert.ok(reloaded, "personagem persistido");

  assert.equal(armaDe(reloaded, "weapon-a").ammo, 6, "arma recarregada sobrevive ao round trip");
  assert.equal(armaDe(reloaded, "weapon-b").ammo, 5, "arma vizinha intacta");
  assert.equal(pilhaDe(reloaded, "pistol_ammo")?.quantity, 44, "reserva correta após load");
});

test("Teste 8b — reload → save → load no encontro mantém pente e reserva do participante certo", () => {
  const original = encontroDois();
  const encounter = recarregadoNoEncontro(reloadParticipantWeapon(original, 0));

  saveEncounter(encounter);
  const persisted = loadEncounters().find((entry) => entry.id === original.id);
  assert.ok(persisted, "encontro persistido");

  const a = persisted.participants[0];
  const b = persisted.participants[1];
  assert.equal(a.ammo, a.magazine, "participante A recarregado");
  assert.equal(pilhaDeEncontro(a, "Heavy Pistol Ammo")?.quantity, 8, "reserva de A: 16 − 8");
  assert.equal(b.ammo, 5, "participante B intacto (5/8)");
  assert.equal(pilhaDeEncontro(b, "Heavy Pistol Ammo")?.quantity, 16, "reserva de B intacta");
});

/* -------------------------------------------------------------------------- *
 * Caminho do encontro — identidade por participante, não por enemyId/template
 * -------------------------------------------------------------------------- */

function pilhaDeEncontro(
  participant: EncounterData["participants"][number],
  itemName: string,
): { item: string; quantity: number } | undefined {
  return participant.inventory?.find((entry) => entry.item === itemName);
}

/** Dois inimigos do MESMO template (mesmo `enemyId`, mesma arma). */
function encontroDois(): EncounterData {
  const participante = (id: string, name: string, ammo: number) => ({
    enemyId: "maelstrom-recruit",
    id,
    name,
    archetype: "Ranged Mook",
    faction: "Maelstrom",
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
    ammo,
    inventory: [{ item: "Heavy Pistol Ammo", quantity: 16 }],
  });

  return {
    id: "f06-encontro",
    name: "Emboscada F0.6",
    faction: "Maelstrom",
    enemyCount: 2,
    createdAt: "2026-10-02T10:00:00.000Z",
    participants: [participante("part-a", "Sicário", 0), participante("part-b", "Sicário", 5)],
  };
}

test("recarregar um participante não toca o outro, mesmo com mesmo enemyId e mesma arma", () => {
  const original = encontroDois();
  const encounter = recarregadoNoEncontro(reloadParticipantWeapon(original, 0));

  const a = encounter.participants[0];
  const b = encounter.participants[1];

  assert.equal(a.enemyId, b.enemyId, "mesmo template de inimigo");
  assert.equal(a.weaponName, b.weaponName, "mesma arma");
  assert.equal(a.ammo, 8, "A recarregada (0 → 8)");
  assert.equal(pilhaDeEncontro(a, "Heavy Pistol Ammo")?.quantity, 8, "reserva de A: 16 − 8");
  assert.equal(b.ammo, 5, "B intacta (5/8)");
  assert.equal(pilhaDeEncontro(b, "Heavy Pistol Ammo")?.quantity, 16, "reserva de B intacta");
  // O `enemyId` não identifica arma nenhuma: as duas mochilas são objetos separados.
  assert.notEqual(pilhaDeEncontro(a, "Heavy Pistol Ammo"), pilhaDeEncontro(b, "Heavy Pistol Ammo"));
});

test("recarregar o segundo participante mexe só nele", () => {
  const original = encontroDois();
  const encounter = recarregadoNoEncontro(reloadParticipantWeapon(original, 1));

  const a = encounter.participants[0];
  const b = encounter.participants[1];
  assert.equal(a.ammo, 0, "A continua 0/8");
  assert.equal(pilhaDeEncontro(a, "Heavy Pistol Ammo")?.quantity, 16, "reserva de A intacta");
  assert.equal(b.ammo, 8, "B recarregada (5 → 8)");
  assert.equal(pilhaDeEncontro(b, "Heavy Pistol Ammo")?.quantity, 13, "reserva de B: 16 − 3");
});

test("recarregar o segundo participante mexe só nele — pente cheio no encontro recusa", () => {
  const original = encontroDois();
  const full = {
    ...original,
    participants: original.participants.map((entry, index) => (index === 1 ? { ...entry, ammo: 8 } : entry)),
  };
  const result = reloadParticipantWeapon(full, 1);
  assert.ok("error" in result);
  assert.ok(result.error.length > 0);
  assert.equal(full.participants[1].ammo, 8, "nada mutado");
  assert.equal(pilhaDeEncontro(full.participants[1], "Heavy Pistol Ammo")?.quantity, 16, "reserva intacta");
});
