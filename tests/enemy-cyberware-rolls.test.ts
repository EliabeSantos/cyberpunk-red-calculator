/**
 * Implantes dos inimigos entram nos DADOS que ele rola — da mesma maneira que
 * na ficha do jogador (mesmo catálogo, mesmo `cyberwareEffects`).
 *
 * Cobre os quatro pontos onde o inimigo soma número:
 *   • ataque (`rollAttack` / `rollEnemyAttack`)
 *   • Evasão (`rollEvasion`)
 *   • Iniciativa (`getParticipantInitiativeBonus` / `rollEnemyInitiative`)
 *   • dano desarmado (`rollDamage` / `rollEnemyDamage`)
 * e o SP do corpo no dano recebido (`getParticipantArmorSP`).
 *
 * Decisão do Mestre (30/09/2026): o inimigo não tem toggle, então o **primeiro
 * estágio** de cada peça conta como ligado — é o que faz Sandevistan e
 * Kerenzikov somarem aqui.
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { EncounterData } from "../src/lib/gmStorage.ts";
import type { Enemy } from "../src/types/enemy.ts";

const {
  getEvasionBase,
  getParticipantArmorSP,
  getParticipantAttackModifiers,
  getParticipantDamageExpression,
  getParticipantEvasionModifiers,
  getParticipantInitiativeBonus,
  getParticipantInitiativeModifiers,
  isUnarmedParticipant,
  rollAttack,
  rollDamage,
  rollEvasion,
} = await import("../src/lib/gmStorage.ts");

const {
  enemyCyberwareView,
  getEnemyAttackModifiers,
  isRangedSkillId,
  isSmartWeaponByName,
} = await import("../src/lib/enemyCyberware.ts");

const { rollEnemyAttack, rollEnemyDamage } = await import("../src/lib/enemyRolls.ts");
const { rollEnemyInitiative } = await import("../src/lib/combatEngine.ts");
const { formatInitiativeMessage } = await import("../src/lib/discord/format.ts");

/** Soma de uma lista de modificadores. */
const sum = (modifiers: readonly { value: number }[]): number =>
  modifiers.reduce((total, modifier) => total + modifier.value, 0);

/** Participante padrão: REF 7, Evasão 5, arma à distância, sem implantes. */
function encounter(
  participant: Partial<EncounterData["participants"][number]> = {},
): EncounterData {
  return {
    id: "encontro-1",
    name: "Emboscada",
    faction: "Maelstrom",
    enemyCount: 1,
    createdAt: "2026-09-30T10:00:00.000Z",
    participants: [
      {
        enemyId: "militante",
        id: "part-1",
        name: "Militante",
        archetype: "Gang",
        faction: "Maelstrom",
        level: 1,
        threatLevel: "low",
        hp: { current: 30, max: 30 },
        armor: { head: 11, body: 11 },
        conditions: [],
        isPlayer: false,
        weaponName: "Heavy Pistol",
        weaponSkillId: "handgun",
        weaponSkillName: "Handgun",
        refStat: 7,
        skillValue: 15,
        attackBase: 15,
        evasionSkillName: "Evasion",
        evasionSkillLevel: 5,
        damageExpression: "3d6",
        lastAttackRoll: null,
        lastDamageRoll: null,
        lastEvasionRoll: null,
        initiative: null,
        personalityTraits: [],
        ...participant,
      },
    ],
  };
}

/* ─── A "visão de ficha": mesmo caminho de resolução da ficha do jogador ─── */

test("implante vira CyberwareItem com o primeiro estágio LIGADO", () => {
  const view = enemyCyberwareView(["Kerenzikov", "  ", "Sandevistan"]);
  assert.equal(view.cyberware.length, 2, "nome vazio/não-string não entra");
  assert.equal(view.cyberware[0].name, "Kerenzikov");
  assert.equal(view.cyberware[0].activeStage, 0, "estágio 1 conta como ativo");
  assert.equal(view.cyberware[1].activeStage, 0);
  // Peça sem activation ignora o campo — nada de efeito colateral.
  assert.equal(enemyCyberwareView(["Neural Link"]).cyberware[0].activeStage, 0);
  // Participante de ficha salva antiga (sem implants) não quebra.
  assert.deepEqual(enemyCyberwareView(undefined).cyberware, []);
  assert.deepEqual(enemyCyberwareView(null).cyberware, []);
});

test("predicados de arma espelham a ficha do jogador", () => {
  assert.equal(isRangedSkillId("handgun"), true);
  assert.equal(isRangedSkillId("Shoulder Arms"), false, "só o id canônico, igual a attacks.ts");
  assert.equal(isRangedSkillId("brawling"), false);
  assert.equal(isSmartWeaponByName("Smart Pistol"), true);
  assert.equal(isSmartWeaponByName("Heavy Pistol"), false);
  assert.equal(isSmartWeaponByName("Desarmado"), false);
});

/* ─── Ataque ─── */

test("Targeting Scope dá +1 em ataque à distância e nada em corpo a corpo", () => {
  const implants = ["Targeting Scope"];
  const ranged = getEnemyAttackModifiers(implants, { skillId: "handgun", ranged: true });
  assert.equal(sum(ranged), 1);
  assert.equal(ranged[0].source, "Targeting Scope (longa distância)");

  assert.equal(sum(getEnemyAttackModifiers(implants, { skillId: "brawling", ranged: false })), 0);

  // O wrapper do participante tira ranged/smart da arma e da perícia dele.
  assert.equal(sum(getParticipantAttackModifiers(encounter({ implants }).participants[0])), 1);
  assert.equal(
    sum(
      getParticipantAttackModifiers(
        encounter({ weaponSkillId: "brawling", weaponName: "Desarmado", implants: ["Gorilla Arms"] })
          .participants[0],
      ),
    ),
    2,
    "corpo a corpo usa a perícia do inimigo, não a lista de à distância",
  );
});

test("Gorilla Arms dá +2 na perícia Briga e arma smart dá +1 só se a arma for smart", () => {
  const gorilla = getEnemyAttackModifiers(["Gorilla Arms"], { skillId: "brawling", ranged: false });
  assert.equal(sum(gorilla), 2, "bônus de perícia entra no ataque, como na ficha");

  const smart = getEnemyAttackModifiers(["Smart Weapon Link"], {
    skillId: "handgun",
    ranged: true,
    smart: true,
  });
  assert.equal(sum(smart), 1, "só o bônus de arma smart");
  assert.equal(smart[0].source, "Smart Weapon Link (arma smart)");
  assert.equal(
    sum(getEnemyAttackModifiers(["Smart Weapon Link"], { skillId: "handgun", ranged: true, smart: false })),
    0,
    "sem arma smart o bônus de Smart Link não vale",
  );
});

test("rollAttack soma os implantes no total e guarda as fontes", () => {
  const data = encounter({ implants: ["Targeting Scope"] });
  for (let i = 0; i < 300; i++) {
    const rolled = rollAttack(data, 0);
    const roll = rolled.participants[0].lastAttackRoll;
    assert.ok(roll);
    assert.equal(roll.diceTotal, roll.diceRolls.reduce((sumValue, value) => sumValue + value, 0));
    assert.equal(roll.total, 15 + roll.diceTotal + 1, "attackBase + dados + Targeting Scope");
    assert.equal(sum(roll.modifiers ?? []), 1);
    assert.equal(roll.modifiers?.[0].source, "Targeting Scope (longa distância)");
  }

  // Sem implante a conta continua a de antes.
  const plain = rollAttack(encounter(), 0).participants[0].lastAttackRoll;
  assert.ok(plain);
  assert.equal(plain.total, 15 + plain.diceTotal);
  assert.equal(sum(plain.modifiers ?? []), 0);
});

/* ─── Evasão ─── */

test("Kerenzikov (estágio ligado) soma +1 na Evasão", () => {
  assert.equal(sum(getParticipantEvasionModifiers({ implants: ["Kerenzikov"] })), 1);
  assert.equal(sum(getParticipantEvasionModifiers({ implants: ["Sandevistan"] })), 1);
  assert.equal(sum(getParticipantEvasionModifiers({ implants: [] })), 0);
});

test("rollEvasion soma os implantes na base sem quebrar ficha antiga", () => {
  const withImplant = encounter({ implants: ["Kerenzikov"] });
  const roll = rollEvasion(withImplant, 0).participants[0].lastEvasionRoll;
  assert.ok(roll);
  assert.equal(roll.total, getEvasionBase(withImplant.participants[0]) + 1 + roll.diceTotal);

  const legacy = encounter({ implants: undefined, evasionSkillLevel: undefined });
  const legacyRoll = rollEvasion(legacy, 0).participants[0].lastEvasionRoll;
  assert.ok(legacyRoll);
  assert.equal(legacyRoll.total, 7 + legacyRoll.diceTotal, "sem implante e sem nível, REF puro");
});

/* ─── Iniciativa ─── */

test("bônus de Iniciativa sai do estágio ligado do implante", () => {
  assert.equal(getParticipantInitiativeBonus({ implants: ["Sandevistan"] }), 4);
  assert.equal(getParticipantInitiativeBonus({ implants: ["Kerenzikov"] }), 2);
  assert.equal(getParticipantInitiativeBonus({ implants: [] }), 0);
  assert.equal(getParticipantInitiativeBonus({}), 0, "participante sem implants não quebra");
  // Peça sem efeito de iniciativa não soma nada.
  assert.equal(getParticipantInitiativeBonus({ implants: ["Neural Link"] }), 0);
  // As fontes sobrevivem para a UI mostrar de onde veio o número.
  const sources = getParticipantInitiativeModifiers({ implants: ["Sandevistan"] });
  assert.equal(sources.length, 1);
  assert.equal(sources[0].source, "Sandevistan");
});

test("a mesa rola 1d10 + REF + bônus de implante, sempre dentro da faixa", () => {
  for (let i = 0; i < 500; i++) {
    const total = rollEnemyInitiative(5, 4);
    assert.ok(total >= 5 + 4 + 1 && total <= 5 + 4 + 10, `total ${total} fora da faixa`);
  }
  // Seed antigo, sem bônus gravado: continua REF + 1d10.
  const plain = rollEnemyInitiative(5);
  assert.ok(plain >= 6 && plain <= 15);
  for (let i = 0; i < 200; i++) {
    const negative = rollEnemyInitiative(0, -2);
    assert.ok(negative >= -1 && negative <= 8, `bônus negativo aceito, total ${negative}`);
  }
});

test("a mensagem de iniciativa do Discord mostra o bônus de implante", () => {
  const payload = {
    sessionCode: "mesa-teste",
    kind: "initiative" as const,
    encounterName: "Emboscada",
    rows: [{ name: "Militante", roll: 7, ref: 5, bonus: 4, total: 16 }],
  };
  const message = formatInitiativeMessage(payload);
  assert.ok(message.includes("**Militante**: d10(7) + 5 REF + 4 implantes = **16**"), message);

  // Sem bônus o formato antigo é byte a byte o mesmo.
  const plain = formatInitiativeMessage({
    ...payload,
    rows: [{ name: "Militante", roll: 7, ref: 5, total: 12 }],
  });
  assert.ok(plain.includes("d10(7) + 5 REF = **12**"));
  assert.ok(!plain.includes("implantes"));
});

/* ─── Dano desarmado ─── */

test("Gorilla Arms acrescenta +1d6 só quando o inimigo está desarmado", () => {
  const armed = encounter({ weaponName: "Heavy Pistol", damageExpression: "3d6", implants: ["Gorilla Arms"] });
  assert.equal(isUnarmedParticipant(armed.participants[0]), false);
  assert.equal(getParticipantDamageExpression(armed.participants[0]), "3d6");

  const unarmed = encounter({ weaponName: "Desarmado", damageExpression: "1d6", implants: ["Gorilla Arms"] });
  assert.equal(isUnarmedParticipant(unarmed.participants[0]), true);
  assert.equal(getParticipantDamageExpression(unarmed.participants[0]), "1d6+1d6");

  const rolled = rollDamage(unarmed, 0).participants[0].lastDamageRoll;
  assert.ok(rolled);
  assert.equal(rolled.rolls.length, 2, "base + dado do implante, os dois rolados");
  assert.equal(rolled.total, rolled.rolls[0] + rolled.rolls[1]);
  assert.equal(rolled.expression, "1d6+1d6");
  for (const value of rolled.rolls) {
    assert.ok(value >= 1 && value <= 6, "só d6 de 1 a 6");
  }
});

test("dano sem implante mantém a rolagem de antes (um dado por vez)", () => {
  const rolled = rollDamage(encounter(), 0).participants[0].lastDamageRoll;
  assert.ok(rolled);
  assert.equal(rolled.rolls.length, 3, "3d6 da arma");
  assert.equal(rolled.expression, "3d6");
  assert.equal(rolled.total, rolled.rolls[0] + rolled.rolls[1] + rolled.rolls[2]);
});

/* ─── SP do corpo (dano recebido) ─── */

test("Subdermal Armor vale no corpo, não na cabeça, e não acumula com a armadura", () => {
  const armored = encounter({ armor: { head: 11, body: 5 }, implants: ["Subdermal Armor"] });
  assert.equal(getParticipantArmorSP(armored.participants[0], "body"), 11, "vale o maior");
  assert.equal(getParticipantArmorSP(armored.participants[0], "head"), 11, "cabeça fica como está");

  // Armadura melhor que o cyberware: a armadura vence (nunca soma).
  const better = encounter({ armor: { head: 11, body: 14 }, implants: ["Subdermal Armor"] });
  assert.equal(getParticipantArmorSP(better.participants[0], "body"), 14);

  // Sem implante, o SP continua sendo o do bestiário.
  assert.equal(getParticipantArmorSP(encounter().participants[0], "body"), 11);
  assert.equal(getParticipantArmorSP({ armor: { head: 0, body: 0 } }, "body"), 0, "sem armor nem implants é 0");
});

/* ─── Melhoriário: /gm/enemies ─── */

function bestiary(cyberware?: string[]): Enemy {
  return {
    id: "militech-solo",
    schemaVersion: 1,
    createdAt: "2026-09-30T00:00:00.000Z",
    updatedAt: "2026-09-30T00:00:00.000Z",
    identity: { name: "Solo Militech", archetype: "Solo", threatLevel: "high", faction: "Militech" },
    stats: { INT: 5, REF: 8, DEX: 7, TECH: 4, COOL: 7, WILL: 6, LUCK: 3, MOVE: 6, BODY: 7, EMP: 3 },
    skills: {
      handgun: { name: "Handgun", stat: "REF", level: 5 },
      brawling: { name: "Brawling", stat: "REF", level: 3 },
    },
    weapons: [
      {
        id: "heavy-pistol",
        name: "Heavy Pistol",
        damage: "3d6",
        attackType: "ranged",
        skill: "handgun",
        attackBase: 16,
      },
    ],
    combat: { hp: { current: 40, max: 40 }, armor: { head: 11, body: 11 }, criticalInjuries: [] },
    conditions: [],
    cyberware,
  } as unknown as Enemy;
}

test("rollEnemyAttack soma os implantes junto do modificador pedido na tela", () => {
  const enemy = bestiary(["Targeting Scope"]);
  const result = rollEnemyAttack(enemy, {
    type: "attack",
    enemyId: enemy.id,
    weaponId: "heavy-pistol",
    modifiers: [{ source: "Modificador GM", value: 2 }],
  });
  assert.ok("result" in result, "ataque válido");
  if (!("result" in result)) return;

  const { total, diceTotal, modifiers } = result.result;
  assert.equal(sum(modifiers), 3, "Targeting Scope +1 e Modificador GM +2");
  assert.equal(total, 8 + 5 + diceTotal + 3, "STAT + perícia + dados + mods");
  assert.ok(modifiers.some((m) => m.source.startsWith("Targeting Scope")), "a fonte aparece na UI");
});

test("rollEnemyAttack sem implante continua com a conta antiga", () => {
  const result = rollEnemyAttack(bestiary(), { type: "attack", enemyId: "x", weaponId: "heavy-pistol" });
  assert.ok("result" in result);
  if (!("result" in result)) return;
  assert.equal(sum(result.result.modifiers), 0);
  assert.equal(result.result.total, 13 + result.result.diceTotal);
});

test("dano desarmado do melhoriário aceita 1d6+BODY/2+1d6 do implante", () => {
  const enemy = bestiary(["Gorilla Arms"]);
  const attack = rollEnemyAttack(enemy, { type: "attack", enemyId: enemy.id, skillId: "brawling" });
  assert.ok("result" in attack);
  if (!("result" in attack)) return;
  assert.equal(attack.result.damageDice, "1d6+3+1d6", "BODY 7 → +3, e o implante soma um d6");

  const damage = rollEnemyDamage(enemy, attack.result.damageDice, "Desarmado");
  assert.ok("result" in damage, "expressão com '+' agora rola em vez de dar erro");
  if (!("result" in damage)) return;
  assert.equal(damage.result.roll.rolls.length, 2, "os dois d6; o +3 é fixo e não vira dado");
  assert.equal(damage.result.total, damage.result.roll.rolls[0] + 3 + damage.result.roll.rolls[1]);
  assert.ok(damage.result.total >= 5 && damage.result.total <= 15);
});
