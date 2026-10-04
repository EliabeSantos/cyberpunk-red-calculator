/**
 * F1.7 Parte B — dados do ATAQUE no contrato, sem implementar `attack`.
 *
 * O que este arquivo protege:
 *   1. Gap 1 (skills de inimigos): o adapter recupera a perícia da arma do
 *      encontro com o NÍVEL PURO (`skillValue − REF`) e nunca encaixa a
 *      combinação `REF + nível` no lugar do nível;
 *   2. dado corrompido de skill não gera perícia inventada — o participante
 *      continua representável;
 *   3. Gap 2 (cyberware): as peças instaladas são preservadas no recorte
 *      mínimo que as regras de efeitos leem, sem bônus pré-calculado e sem
 *      campo algum quando não há peças;
 *   4. `attackBase` do encontro (a base que `combat/enemyAttacks.ts` soma
 *      hoje) sobrevive ao adapter; a ficha não tem essa noção;
 *   5. `AttackAction` tem SÓ dados necessários da ação (AST) e o contrato
 *      não importa UI/storage/persistência (AST);
 *   6. o adapter não calcula rolagem de ataque — nenhuma regra duplicada.
 *
 * Nada aqui executa a action `attack`: o motor continua sem essa operação
 * (F1.7 §13) e nenhum cálculo de regra de RED foi alterado.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import type { Character, CyberwareItem, Weapon } from "../src/types/character.ts";
import type { NormalizedEncounterParticipant } from "../src/lib/combat/adapters.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT_SOURCE = readFileSync(resolve(ROOT, "src", "lib", "combat", "contract.ts"), "utf8");
const ADAPTERS_SOURCE = readFileSync(resolve(ROOT, "src", "lib", "combat", "adapters.ts"), "utf8");

const { toCombatParticipant } = await import("../src/lib/combat/adapters.ts");
const { createEmptyCharacter } = await import("../src/types/character.ts");

/* -------------------------------------------------------------------------- *
 * Fixtures — mesmas formas dos testes de contrato (F1.1), montadas à mão.
 * -------------------------------------------------------------------------- */

const TEMPLATE = "scrapper";

function arma(): Weapon {
  return {
    id: "f17-arma",
    catalogItemId: "cat-heavy-pistol",
    name: "Heavy Pistol",
    damage: "3d6",
    rateOfFire: 2,
    attackType: "handgun",
    skill: "handgun",
    magazine: 6,
    ammo: 3,
  };
}

function personagem(overrides: Partial<Character> = {}): Character {
  const base = createEmptyCharacter("f17-personagem");
  const stats = { ...base.stats, REF: 7, BODY: 6 };
  return {
    ...base,
    identity: { ...base.identity, name: "V F1.7" },
    stats,
    skills: { ...base.skills, handgun: { ...base.skills.handgun, level: 4 } },
    weapons: [arma()],
    ...overrides,
  };
}

function participante(overrides: Partial<NormalizedEncounterParticipant> = {}): NormalizedEncounterParticipant {
  return {
    enemyId: TEMPLATE,
    id: "instance-2",
    name: "Scrappy #2",
    archetype: "Scrappy",
    faction: "Maelstrom",
    level: 2,
    threatLevel: "medium",
    hp: { current: 35, max: 35 },
    armor: { head: 11, body: 11 },
    conditions: [],
    isPlayer: false,
    weaponName: "Heavy Pistol",
    weaponSkillId: "handgun",
    weaponSkillName: "Handgun",
    refStat: 6,
    moveStat: 5,
    skillValue: 10,
    attackBase: 12,
    damageExpression: "3d6",
    lastAttackRoll: null,
    lastDamageRoll: null,
    initiative: 14,
    personalityTraits: [],
    magazine: 8,
    ammo: 5,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- *
 * Helpers de AST — mesmos usados pela rede de pureza (comentários não contam).
 * -------------------------------------------------------------------------- */

function importSpecifiers(source: string, fileName: string): string[] {
  const ast = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const specs: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      specs.push(node.moduleSpecifier.getText(ast).replace(/^["']|["']$/g, ""));
    }
    node.forEachChild(visit);
  };
  ast.forEachChild(visit);
  return specs;
}

function interfaceMembers(source: string, interfaceName: string): string[] {
  const ast = ts.createSourceFile("contract.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let members: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
      members = node.members
        .filter((member): member is ts.PropertySignature => ts.isPropertySignature(member))
        .map((member) => (member.name ? member.name.getText(ast) : ""));
    }
    node.forEachChild(visit);
  };
  ast.forEachChild(visit);
  return members;
}

/* -------------------------------------------------------------------------- *
 * 1–2 — Gap 1: skills de inimigos
 * -------------------------------------------------------------------------- */

test("F1.7: o encontro recupera a perícia da arma com o nível puro (skillValue − REF)", () => {
  const combatant = toCombatParticipant(participante());
  const skills = combatant.skills;
  assert.ok(skills, "o encontro deveria expor a perícia da arma (F1.7 Gap 1)");
  assert.deepEqual(skills.handgun, { stat: "REF", level: 4 });

  // Round-trip: REF + nível devolve EXATAMENTE o skillValue gravado — o
  // adapter inverteu a combinação, não reimplementou a conta de ninguém.
  assert.equal((combatant.stats?.REF ?? 0) + skills.handgun.level, 10);
  // E o nível não é a combinação `REF + nível` encaixada onde vai o nível.
  assert.notEqual(skills.handgun.level, 10);
});

test("F1.7: skill corrompida não vira perícia inventada e o participante segue representável", () => {
  const nan = toCombatParticipant(participante({ skillValue: Number.NaN }));
  assert.equal(nan.skills, undefined);
  assert.equal(nan.id, "instance-2");
  assert.equal(nan.source.enemyId, TEMPLATE);

  // Nível daria negativo (3 − 6): dado incoerente não vira skill.
  const negativo = toCombatParticipant(participante({ skillValue: 3 }));
  assert.equal(negativo.skills, undefined);

  const semId = toCombatParticipant(participante({ weaponSkillId: "" }));
  assert.equal(semId.skills, undefined);
  // Sem perícia a arma continua representável (o resto do contrato não muda).
  assert.ok(semId.weapons?.[0]);
  assert.equal(semId.weapons[0].skill, "");
});

test("F1.7: a ficha mantém a perícia canônica (caminho do Character não mudou)", () => {
  const ficha = toCombatParticipant(personagem());
  assert.deepEqual(ficha.skills?.handgun, { stat: "REF", level: 4 });
});

/* -------------------------------------------------------------------------- *
 * 3–4 — Gap 2: cyberware que modifica ataque
 * -------------------------------------------------------------------------- */

test("F1.7: cyberware da ficha é preservado no recorte mínimo (catálogo + estágio)", () => {
  const piece: CyberwareItem = {
    id: "cw-1",
    catalogItemId: "targeting-scope",
    name: "Targeting Scope",
    installedAt: "",
    activeStage: 1,
  };
  const ficha = toCombatParticipant(personagem({ cyberware: [piece] }));
  // DADO bruto: o adapter copia o que a regra de efeitos lê, sem somar bônus.
  assert.deepEqual(ficha.cyberware, [
    { name: "Targeting Scope", catalogItemId: "targeting-scope", activeStage: 1 },
  ]);
});

test("F1.7: implantes do inimigo viram cyberware pela projeção de sempre (primeiro estágio ligado)", () => {
  const inimigo = toCombatParticipant(
    participante({ implants: ["Targeting Scope", "   ", "Subdermal Armor"] }),
  );
  // Mesma projeção de `enemyCyberwareView`: nome aparado, estágio 0 ligado,
  // entrada vazia filtrada — nenhuma política nova inventada no adapter.
  assert.deepEqual(inimigo.cyberware, [
    { name: "Targeting Scope", activeStage: 0 },
    { name: "Subdermal Armor", activeStage: 0 },
  ]);
});

test("F1.7: ausência de cyberware não gera campo nem bônus inventado", () => {
  const ficha = toCombatParticipant(personagem());
  assert.equal("cyberware" in ficha, false);

  const inimigo = toCombatParticipant(participante());
  assert.equal("cyberware" in inimigo, false);

  // E não existe campo de bônus PRÉ-CALCULADO no contrato: modificadores de
  // ataque dependem do contexto (ranged/smart/perícia) e ficam na regra.
  for (const alvo of [ficha, inimigo]) {
    assert.equal("attackModifiers" in alvo, false);
    assert.equal("cyberwareModifiers" in alvo, false);
  }
});

/* -------------------------------------------------------------------------- *
 * 5 — base pronta do ataque do encontro
 * -------------------------------------------------------------------------- */

test("F1.7: attackBase do encontro é preservada; dado não-finito e ficha ficam sem ela", () => {
  const inimigo = toCombatParticipant(participante());
  assert.equal(inimigo.weapons?.[0]?.attackBase, 12);

  const semBase = toCombatParticipant(participante({ attackBase: Number.NaN }));
  assert.equal("attackBase" in (semBase.weapons?.[0] ?? {}), false);

  // `Weapon` da ficha não tem `attackBase` — lá a base é stats + nível.
  const ficha = toCombatParticipant(personagem());
  assert.equal("attackBase" in (ficha.weapons?.[0] ?? {}), false);
});

/* -------------------------------------------------------------------------- *
 * 6 — contrato de AttackAction (AST)
 * -------------------------------------------------------------------------- */

test("F1.8C: AttackAction representa só dados necessários da ação", () => {
  const members = interfaceMembers(CONTRACT_SOURCE, "AttackAction");
  assert.deepEqual(
    [...members].sort(),
    [
      "actorId",
      "aimedTarget",
      "attackMode",
      "attackType",
      "defense",
      "label",
      "modifiers",
      "skillId",
      "targetId",
      "type",
      "weaponId",
    ].sort(),
  );
  // Nada de ficha, encontro, mesa, estado ou storage dentro da action.
  const proibidos = members.filter((name) =>
    /character|encounter|participant|mesa|state|store|sheet/i.test(name),
  );
  assert.deepEqual(proibidos, [], "AttackAction não pode carregar domínio legado");
});

test("F1.7: o contrato não importa UI, storage nem persistência", () => {
  const specs = importSpecifiers(CONTRACT_SOURCE, "contract.ts");
  const permitidos = new Set([
    "@/lib/mesa/types",
    "@/lib/mesa/rollPolicy",
    "@/lib/combatEngine",
    "@/types/attack",
    "@/types/combat",
    "@/lib/combat/damage",
    "@/types/character",
    "@/data/criticalInjuries",
    "@/lib/dice",
  ]);
  for (const spec of specs) {
    assert.ok(permitidos.has(spec), `contract.ts importa "${spec}" fora da lista permitida`);
  }
  for (const proibido of ["@/lib/gmStorage", "@/lib/mesa/store", "react", "next", "client-only"]) {
    assert.ok(!specs.includes(proibido), `contract.ts não pode importar "${proibido}"`);
  }
});

/* -------------------------------------------------------------------------- *
 * 7 — nenhuma regra de ataque duplicada no adapter
 * -------------------------------------------------------------------------- */

test("F1.7: o adapter não calcula rolagem de ataque", () => {
  assert.ok(!ADAPTERS_SOURCE.includes("rollAttack"), "adapters.ts não deve rolar ataque");
  assert.ok(!ADAPTERS_SOURCE.includes("rollDice"), "adapters.ts não deve rolar dados");
  assert.ok(!ADAPTERS_SOURCE.includes("Math.random"), "adapters.ts não deve sortear nada");

  const specs = importSpecifiers(ADAPTERS_SOURCE, "adapters.ts");
  const regrasDeAtaque = ["@/lib/attacks", "@/lib/combat/enemyAttacks", "@/lib/enemyRolls"];
  for (const spec of specs) {
    assert.ok(!regrasDeAtaque.includes(spec), `adapters.ts importa a regra de ataque "${spec}"`);
  }
});
