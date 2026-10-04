/**
 * F0.3 — IDs canônicos das perícias dos INIMIGOS.
 *
 * O problema: o bestiário guardava `enemy.skills` pelo **rótulo** ("Handgun",
 * "Brawling", "Shoulder Arms") enquanto o resto do sistema consulta o **id
 * canônico da ficha** (`handgun`, `brawling`, `shoulder_arms` — o catálogo de
 * `src/data/skills.ts`). A caixa diferente fazia o lookup falhar:
 *
 *   • o ataque DESARMADO de TODOS os inimigos devolvia
 *     `Perícia "brawling" não encontrada no inimigo`;
 *   • `calculateEnemySkillBase(enemy, "brawling")` devolvia 0;
 *   • `isRangedSkillId("Shoulder Arms")` era false → o bônus de Targeting
 *     Scope sumia do participante do encontro;
 *   • `getEnemySkillModifiers(cyberware, "Perception")` devolvia [] → o bônus
 *     do Audio Filter não entrava na rolagem;
 *   • a munição caía fora do ramo certo em `getAmmoKind` (`shoulder_arms`
 *     não contém "shoulder arms").
 *
 * A correção normaliza os DADOS na fronteira (catálogo, carga de
 * localStorage e criação) usando `normalizeSkillId` — a fonte única é o
 * `baseSkillDefinitions` de `src/data/skills.ts`, sem catálogo paralelo — e
 * deixa o lookup tolerante dos dois lados (`getEnemySkill`). O RÓTULO
 * visível (`skill.name`, `weaponSkillName`, o detalhe do ataque) não muda.
 *
 * Os dados legados EXISTEM de verdade: o JSON do bestiário tem as chaves em
 * caixa mista e os encontros gravados antes desta correção guardavam
 * `weaponSkillId` como rótulo (o formato que `createEncounter` escrevia).
 * Por isso o teste 4 cobre a carga real, não uma simulação.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { getAmmoKind } from "../src/data/enemySupplies.ts";
import { gmEnemyCatalog } from "../src/data/gm-enemies.ts";
import { getSkillLabel, normalizeSkillId, skillDefinitions } from "../src/data/skills.ts";
import { isRangedSkillId } from "../src/lib/enemyCyberware.ts";
import { getAvailableEnemyAttacks, rollEnemyAttack, rollEnemySkillCheck } from "../src/lib/enemyRolls.ts";
import {
  calculateEnemySkillBase,
  createEmptyEnemy,
  getEnemySkill,
  newEnemySkillId,
  withCanonicalSkillIds,
  type Enemy,
} from "../src/types/enemy.ts";

/** window/localStorage mínimo — mesmo padrão de `tests/mesa-membership-store.test.ts`. */
const storage = new Map<string, string>();
(globalThis as { window?: unknown }).window = {
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  },
};

const { getEnemy, loadEncounters, saveEncounter, saveEnemies, upsertEnemy, getEnemyEvasionSkill } = await import(
  "../src/lib/gmStorage.ts"
);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Inimigo no FORMATO ANTIGO (chave = rótulo), como o JSON do bestiário gravava. */
function legacyEnemy(): Enemy {
  return {
    ...createEmptyEnemy("inimigo-legado"),
    identity: { name: "Militante Legado", archetype: "Gang", threatLevel: "low" },
    stats: { INT: 5, REF: 7, DEX: 6, TECH: 4, COOL: 5, WILL: 5, LUCK: 3, MOVE: 5, BODY: 6, EMP: 4 },
    skills: {
      Handgun: { name: "Handgun", stat: "REF", level: 4 },
      "Shoulder Arms": { name: "Shoulder Arms", stat: "REF", level: 3 },
      Evasion: { name: "Evasion", stat: "REF", level: 5 },
    },
    weapons: [
      {
        id: "w-pistola",
        name: "Heavy Pistol",
        damage: "3d6",
        attackType: "ranged",
        skill: "Handgun",
        attackBase: 11,
        magazine: 8,
        ammo: 8,
      },
      {
        id: "w-fuzil",
        name: "Assault Rifle",
        damage: "5d6",
        attackType: "ranged",
        skill: "Shoulder Arms",
        attackBase: 10,
        magazine: 25,
        ammo: 25,
      },
    ],
  };
}

/** Participante de encontro gravado com `weaponSkillId` escrito como rótulo. */
function legacyEncounter() {
  return {
    id: "encontro-legado",
    name: "Emboscada",
    faction: "Maelstrom",
    enemyCount: 1,
    createdAt: "2026-09-27T10:00:00.000Z",
    participants: [
      {
        enemyId: "inimigo-legado",
        id: "part-1",
        name: "Militante Legado",
        archetype: "Gang",
        faction: "Maelstrom",
        level: 1,
        threatLevel: "low",
        hp: { current: 30, max: 30 },
        armor: { head: 11, body: 11 },
        conditions: [],
        isPlayer: false,
        weaponName: "Assault Rifle",
        weaponSkillId: "Shoulder Arms",
        weaponSkillName: "Shoulder Arms",
        refStat: 7,
        skillValue: 10,
        attackBase: 10,
        evasionSkillName: "Evasion",
        evasionSkillLevel: 5,
        damageExpression: "5d6",
        lastAttackRoll: null,
        lastDamageRoll: null,
        lastEvasionRoll: null,
        initiative: null,
        personalityTraits: [],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Teste 1 — skill canônica
// ---------------------------------------------------------------------------

test("Teste 1 — o catálogo usa o id canônico da ficha e mantém o rótulo", () => {
  for (const enemy of gmEnemyCatalog) {
    for (const key of Object.keys(enemy.skills)) {
      assert.equal(
        normalizeSkillId(key),
        key,
        `${enemy.identity.name}: a chave "${key}" não é o id canônico`,
      );
      assert.ok(
        Object.hasOwn(skillDefinitions, key),
        `${enemy.identity.name}: "${key}" não existe no catálogo de skills da ficha`,
      );
    }
    for (const weapon of enemy.weapons) {
      assert.equal(
        normalizeSkillId(weapon.skill),
        weapon.skill,
        `${enemy.identity.name}: "${weapon.name}" usa a perícia "${weapon.skill}" fora do padrão`,
      );
    }
  }

  const recruit = gmEnemyCatalog.find((enemy) => Object.hasOwn(enemy.skills, "handgun"));
  assert.ok(recruit, "o catálogo tem alguém com Handgun");
  const handgun = recruit.skills.handgun;
  assert.equal(handgun.name, "Handgun", "o RÓTULO visível continua em caixa mista");

  // A mesma perícia é encontrada pelo id e por qualquer grafia antiga.
  assert.equal(getEnemySkill(recruit.skills, "handgun"), handgun);
  assert.equal(getEnemySkill(recruit.skills, "Handgun"), handgun, "rótulo legado encontra o mesmo registro");
  assert.equal(getEnemySkill(recruit.skills, "HANDGUN"), handgun, "caixa alternativa também");

  // E o valor base não é mais 0 por causa da caixa.
  assert.equal(calculateEnemySkillBase(recruit, "handgun"), recruit.stats.REF + handgun.level);
  assert.equal(
    calculateEnemySkillBase(recruit, "Handgun"),
    recruit.stats.REF + handgun.level,
    "lookup por rótulo não pode devolver 0",
  );
  assert.equal(getSkillLabel("handgun"), "Handgun", "id → rótulo, para a UI não reescrever o texto");
});

// ---------------------------------------------------------------------------
// Teste 2 — lookup de ataque
// ---------------------------------------------------------------------------

test("Teste 2 — ataque do inimigo (arma e desarmado) acha a perícia certa", () => {
  let rolled = 0;
  for (const enemy of gmEnemyCatalog) {
    const attacks = getAvailableEnemyAttacks(enemy);
    const unarmed = attacks.find((attack) => attack.id === "unarmed");
    assert.ok(unarmed, `${enemy.identity.name} sempre tem ataque desarmado`);

    const brawling = getEnemySkill(enemy.skills, "brawling");
    const declaresBrawling = Object.entries(enemy.skills).some(
      ([key]) => normalizeSkillId(key) === "brawling",
    );
    const roll = rollEnemyAttack(enemy, unarmed.context);
    if (declaresBrawling) {
      // ANTES desta correção isto devolvia `Perícia "brawling" não encontrada`.
      assert.ok(brawling, `${enemy.identity.name}: declara Brawling mas o lookup não achou`);
      assert.ok(
        "result" in roll,
        `${enemy.identity.name}: desarmado → ${"error" in roll ? roll.error : "ok"}`,
      );
      if ("result" in roll) {
        assert.equal(roll.result.skill.id, "brawling", "o resultado expõe o id canônico");
        assert.equal(roll.result.skill.name, "Brawling", "mostra o rótulo, não o id");
        assert.equal(
          roll.result.skill.value,
          enemy.stats[brawling.stat] + brawling.level,
          "o valor da perícia é STAT + nível, não o REF puro",
        );
        rolled += 1;
      }
    } else {
      // Sem Brawling no bestiário o desarmado fica com o REF — dado ausente,
      // não caixa errada (fica registrado como pendência, não é este o escopo).
      assert.ok("error" in roll, `${enemy.identity.name}: sem Brawling, o erro é esperado`);
    }

    for (const attack of attacks) {
      if (attack.id === "unarmed") continue;
      const skillId = attack.context.skillId;
      assert.ok(skillId, `${enemy.identity.name}/${attack.id} declara a perícia`);
      // O detalhe mostrado na UI é sempre o RÓTULO (id canônico ou não).
      assert.ok(
        attack.detail.includes(getSkillLabel(skillId)),
        `${enemy.identity.name}/${attack.id}: "${attack.detail}" não mostra o rótulo "${getSkillLabel(skillId)}"`,
      );
      if (!getEnemySkill(enemy.skills, skillId)) continue; // perícia ausente no bestiário = pendência de dado
      const weaponRoll = rollEnemyAttack(enemy, attack.context);
      assert.ok(
        "result" in weaponRoll,
        `${enemy.identity.name}/${attack.id} → ${"error" in weaponRoll ? weaponRoll.error : "ok"}`,
      );
      rolled += 1;
    }
  }
  assert.ok(rolled > 100, `esperava dezenas de rolagens válidas, veio ${rolled}`);
});

// ---------------------------------------------------------------------------
// Teste 3 — Evasion
// ---------------------------------------------------------------------------

test("Teste 3 — Evasion continua sendo encontrada nos dois formatos", () => {
  let checked = 0;
  for (const enemy of gmEnemyCatalog) {
    const evasion = getEnemySkill(enemy.skills, "evasion");
    const found = getEnemyEvasionSkill(enemy);
    if (evasion) {
      assert.equal(found.name, "Evasion", "rótulo intacto");
      assert.equal(found.level, evasion.level);

      const roll = rollEnemySkillCheck(enemy, {
        type: "skill_check",
        enemyId: enemy.id,
        skillId: "evasion",
      });
      assert.ok(
        "result" in roll,
        `${enemy.identity.name}: teste de Evasion → ${"error" in roll ? roll.error : "ok"}`,
      );
      if ("result" in roll) {
        assert.equal(roll.result.skillName, "Evasion", "a UI recebe o rótulo");
        assert.equal(roll.result.skillLevel, evasion.level);
      }
      checked += 1;
    } else {
      assert.equal(found.level, 0, "sem Evasion declarada, o nível é 0 (a base vira REF)");
    }
  }
  assert.ok(checked > 50, `esperava dezenas de inimigos com Evasion, veio ${checked}`);

  // Chave legada em caixa mista (o formato do JSON do bestiário).
  const legacy = { ...legacyEnemy(), skills: { Evasion: { name: "Evasion", stat: "REF" as const, level: 5 } } };
  assert.equal(getEnemySkill(legacy.skills, "evasion")?.level, 5, "chave antiga continua legível");
  assert.equal(getEnemyEvasionSkill(legacy).level, 5);
  assert.deepEqual(Object.keys(withCanonicalSkillIds(legacy).skills), ["evasion"], "a chave migra");
  assert.equal(withCanonicalSkillIds(legacy).skills.evasion.name, "Evasion", "o rótulo não muda");
});

// ---------------------------------------------------------------------------
// Teste 4 — dados legados
// ---------------------------------------------------------------------------

test("Teste 4 — dados legados em caixa mista continuam sendo lidos", () => {
  const legacy = legacyEnemy();

  // (a) normalização pura: chaves viram id, rótulos ficam onde estão.
  const normalized = withCanonicalSkillIds(legacy);
  assert.deepEqual(Object.keys(normalized.skills), ["handgun", "shoulder_arms", "evasion"]);
  assert.deepEqual(
    Object.values(normalized.skills).map((skill) => skill.name),
    ["Handgun", "Shoulder Arms", "Evasion"],
    "os RÓTULOS visíveis não são reescritos",
  );
  assert.deepEqual(normalized.weapons.map((weapon) => weapon.skill), ["handgun", "shoulder_arms"]);
  assert.equal(normalized.weapons[0].name, "Heavy Pistol", "nada mais do inimigo muda");
  // E o formato ANTIGO continua legível sem passar por nada.
  assert.equal(getEnemySkill(legacy.skills, "brawling"), undefined, "sem Brawling declarado não acha");
  assert.equal(getEnemySkill(legacy.skills, "Handgun")?.level, 4);

  // (b) caminho real de persistência: gravou no formato antigo, carregou canônico.
  saveEnemies([legacy]);
  const loaded = getEnemy("inimigo-legado");
  assert.ok(loaded, "o inimigo legado é recarregado");
  assert.deepEqual(Object.keys(loaded.skills), ["handgun", "shoulder_arms", "evasion"]);
  assert.deepEqual(loaded.weapons.map((weapon) => weapon.skill), ["handgun", "shoulder_arms"]);
  assert.equal(getEnemySkill(loaded.skills, "Handgun")?.name, "Handgun", "lookup por rótulo ainda funciona");
  // O bônus de implante depende do id canônico.
  assert.equal(isRangedSkillId(loaded.weapons[1].skill), true, "Targeting Scope volta a contar");

  // (c) encontro gravado com `weaponSkillId` = rótulo.
  saveEncounter(legacyEncounter());
  const [encounter] = loadEncounters();
  assert.ok(encounter, "o encontro legado é recarregado");
  assert.equal(encounter.participants[0].weaponSkillId, "shoulder_arms");
  assert.equal(encounter.participants[0].weaponSkillName, "Shoulder Arms", "o nome mostrado não muda");
  assert.equal(isRangedSkillId(encounter.participants[0].weaponSkillId), true);
});

// ---------------------------------------------------------------------------
// Teste 5 — criação de inimigo
// ---------------------------------------------------------------------------

test("Teste 5 — a criação de inimigo produz o ID canônico", () => {
  // A regra que `addSkill` usa é a MESMA função testada aqui.
  assert.equal(newEnemySkillId("Handgun"), "handgun");
  assert.equal(newEnemySkillId("Shoulder Arms"), "shoulder_arms");
  assert.equal(newEnemySkillId("Electronics/Security Tech"), "electronics_security");
  assert.equal(
    newEnemySkillId("Throwing Knife"),
    "throwing_knife",
    "perícia que a ficha não conhece vira slug, não fica com espaço nem caixa mista",
  );
  assert.match(newEnemySkillId(), /^skill_\d+$/, "a personalizada sem nome ganha chave estável");

  // Objeto que o formulário monta: chave = id, `name` = rótulo.
  const enemy = createEmptyEnemy("inimigo-novo");
  enemy.identity = { name: "Recruta", archetype: "Gang", threatLevel: "low" };
  enemy.skills = {
    [newEnemySkillId("Handgun")]: { name: "Handgun", stat: "REF", level: 3 },
    [newEnemySkillId("Brawling")]: { name: "Brawling", stat: "DEX", level: 2 },
  };
  enemy.weapons = [
    {
      id: "w-pistola",
      name: "Medium Pistol",
      damage: "2d6",
      attackType: "ranged",
      skill: normalizeSkillId("Handgun"),
      attackBase: 8,
      magazine: 12,
      ammo: 12,
    },
  ];

  assert.deepEqual(Object.keys(enemy.skills), ["handgun", "brawling"]);
  assert.equal(enemy.skills.handgun.name, "Handgun", "o rótulo é o que a UI mostra");
  assert.equal(enemy.weapons[0].skill, "handgun");

  upsertEnemy(enemy);
  const stored = getEnemy("inimigo-novo");
  assert.ok(stored);
  assert.deepEqual(Object.keys(stored.skills), ["handgun", "brawling"], "gravou canônico");
  assert.equal(stored.weapons[0].skill, "handgun");
  assert.equal(getEnemySkill(stored.skills, "Handgun")?.level, 3, "o rótulo ainda encontra a perícia");
});

// ---------------------------------------------------------------------------
// Teste 6 — round trip
// ---------------------------------------------------------------------------

test("Teste 6 — create → save → load → roll encontra a perícia", () => {
  // Formulário gravou NO FORMATO ANTIGO (chave = rótulo): o que existia antes.
  const beforeFix = legacyEnemy();
  beforeFix.id = "round-trip";
  upsertEnemy(beforeFix);

  const loaded = getEnemy("round-trip");
  assert.ok(loaded, "recarregou");
  assert.deepEqual(Object.keys(loaded.skills), ["handgun", "shoulder_arms", "evasion"]);
  assert.equal(loaded.weapons[0].skill, "handgun");

  const attack = rollEnemyAttack(loaded, {
    type: "attack",
    enemyId: loaded.id,
    weaponId: "w-pistola",
  });
  assert.ok(
    "result" in attack,
    `depois de salvar e carregar o ataque precisa rolar → ${"error" in attack ? attack.error : "ok"}`,
  );
  if ("result" in attack) {
    assert.equal(attack.result.skill.name, "Handgun", "rótulo no resultado");
    assert.equal(attack.result.skill.value, loaded.stats.REF + 4, "STAT + nível da perícia salva");
  }

  const skill = rollEnemySkillCheck(loaded, {
    type: "skill_check",
    enemyId: loaded.id,
    skillId: "shoulder_arms",
  });
  assert.ok(
    "result" in skill,
    `teste de perícia com o id canônico → ${"error" in skill ? skill.error : "ok"}`,
  );
  if ("result" in skill) assert.equal(skill.result.skillName, "Shoulder Arms");

  // A munição lê a perícia pelo id e continua acertando o mesmo tipo de bala.
  assert.equal(getAmmoKind({ name: "Heavy Pistol", skill: "handgun", attackType: "ranged", magazine: 8 }), "pistol");
  assert.equal(getAmmoKind({ name: "Fuzil", skill: "shoulder_arms", attackType: "ranged", magazine: 25 }), "rifle");
  assert.equal(
    getAmmoKind({ name: "Fuzil", skill: "Shoulder Arms", attackType: "ranged", magazine: 25 }),
    "rifle",
    "o rótulo legado continua funcionando",
  );
});
