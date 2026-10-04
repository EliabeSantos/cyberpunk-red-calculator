/**
 * F1.1 — Testes de CONTRATO do Combat Engine.
 *
 * Prova que os DOIS modelos atuais (`Character` da ficha e
 * `EncounterParticipant` do encontro) são representáveis pelo contrato comum
 * `CombatParticipant`, sem que nenhum deles mude de forma e sem que o adapter
 * execute uma única regra.
 *
 * O que este arquivo protege:
 *   1. os campos mínimos do contrato (§15 do relatório F1.1);
 *   2. a identidade de INSTÂNCIA × TEMPLATE (F0.4/F0.5);
 *   3. campos opcionais ficam ausentes quando a origem não os tem;
 *   4. o adapter não muta a origem.
 *
 * Ele NÃO testa regras de combate — nada aqui rola dano, ataque, cura ou
 * iniciativa (404 testes anteriores continuam sendo os donos disso).
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { Character, Weapon } from "../src/types/character.ts";
import type { NormalizedEncounterParticipant } from "../src/lib/combat/adapters.ts";
import type {
  CombatAction,
  CombatParticipant,
  CombatResult,
  CombatState,
} from "../src/lib/combat/contract.ts";

const { createEmptyCharacter } = await import("../src/types/character.ts");
const { calculateMaximumHitPoints } = await import("../src/lib/calculations.ts");
const { toCombatParticipant } = await import("../src/lib/combat/adapters.ts");
const { criticalInjuryTables } = await import("../src/data/criticalInjuries.ts");

/* -------------------------------------------------------------------------- *
 * Fixtures — montadas à mão a partir dos tipos reais (nada de factory mágica).
 * -------------------------------------------------------------------------- */

const PERSONAGEM_ID = "f11-personagem";
const TEMPLATE = "scrapper";

function arma(overrides: Partial<Weapon> = {}): Weapon {
  return {
    id: "f11-arma",
    catalogItemId: "cat-heavy-pistol",
    name: "Heavy Pistol",
    damage: "3d6",
    rateOfFire: 2,
    attackType: "handgun",
    skill: "handgun",
    magazine: 6,
    ammo: 3,
    ...overrides,
  };
}

/** Character mínimo realista: STATS coerentes, perícia upada, HP e lesão. */
function personagem(): Character {
  const base = createEmptyCharacter(PERSONAGEM_ID);
  const stats = { ...base.stats, REF: 7, BODY: 6, WILL: 5, MOVE: 6 };
  return {
    ...base,
    identity: { ...base.identity, name: "V teste" },
    stats,
    skills: { ...base.skills, handgun: { ...base.skills.handgun, level: 4 } },
    combat: {
      ...base.combat,
      hp: { current: 27, max: calculateMaximumHitPoints(stats) },
      armor: { head: 11, body: 13 },
      criticalInjuries: [criticalInjuryTables.body[0]],
      deathSaveDC: 6,
      deathSaveFailures: 1,
      isDead: false,
    },
    weapons: [arma()],
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
    conditions: [{ id: "stunned", name: "Atordoado" }],
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
    personalityTraits: [
      { id: "t1", name: "Grosseiro", description: "Não mede palavras." },
    ],
    magazine: 8,
    ammo: 5,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- *
 * 1 — Character → CombatParticipant
 * -------------------------------------------------------------------------- */

test("Character → CombatParticipant preserva identidade, folha e estado", () => {
  const character = personagem();
  const combatant: CombatParticipant = toCombatParticipant(character);

  assert.equal(combatant.id, PERSONAGEM_ID);
  assert.equal(combatant.type, "character");
  assert.equal(combatant.name, "V teste");
  assert.deepEqual(combatant.source, {
    characterId: PERSONAGEM_ID,
    sourceKey: null,
    enemyId: null,
  });

  // STATS necessários para as regras de combate.
  assert.equal(combatant.stats?.REF, 7);
  assert.equal(combatant.stats?.BODY, 6);
  assert.equal(combatant.stats?.MOVE, 6);
  assert.equal(combatant.stats?.WILL, 5);

  // Perícias: só o que a regra lê (STAT + nível), sem perder o nível upado.
  assert.deepEqual(combatant.skills?.handgun, { stat: "REF", level: 4 });
  assert.equal(Object.keys(combatant.skills ?? {}).length, Object.keys(character.skills).length);

  // Armas com a identidade que o F0.6 exige.
  assert.equal(combatant.weapons?.length, 1);
  assert.equal(combatant.weapons?.[0].id, "f11-arma");
  assert.equal(combatant.weapons?.[0].name, "Heavy Pistol");
  assert.equal(combatant.weapons?.[0].damage, "3d6");
  assert.equal(combatant.weapons?.[0].magazine, 6);
  assert.equal(combatant.weapons?.[0].ammo, 3);

  // HP / armadura / lesões / death save.
  assert.equal(combatant.combat.hp.current, 27);
  assert.equal(combatant.combat.hp.max, calculateMaximumHitPoints(character.stats));
  assert.deepEqual(combatant.combat.armor, { head: 11, body: 13 });
  assert.equal(combatant.combat.criticalInjuries.length, 1);
  assert.equal(combatant.combat.criticalInjuries[0].name, criticalInjuryTables.body[0].name);
  assert.deepEqual(combatant.combat.deathSave, { dc: 6, failures: 1 });

  // Ficha não persiste iniciativa nem condição; economia não é dela.
  assert.equal(combatant.combat.initiative, null);
  assert.deepEqual(combatant.combat.conditions, []);
  assert.equal(combatant.combat.isDead, false);
  assert.equal(combatant.economy, undefined);
});

test("F1.5: os dois adapters preenchem cyberwareSP (só o corpo tem SP)", () => {
  // Subdermal Armor (catálogo `subdermal_armor`, body_sp 11) na ficha.
  const character: Character = {
    ...personagem(),
    cyberware: [
      { id: "f15-cw", catalogItemId: "subdermal_armor", name: "Subdermal Armor", installedAt: "" },
    ],
  };
  assert.deepEqual(toCombatParticipant(character).combat.cyberwareSP, { head: 0, body: 11 });

  // O MESMO cyberware pelo nome, como o encontro guarda (`implants`).
  const encontro = toCombatParticipant(participante({ implants: ["Subdermal Armor"] }));
  assert.deepEqual(encontro.combat.cyberwareSP, { head: 0, body: 11 });

  // Sem implante o campo continua presente e zerado — não "ausente".
  assert.deepEqual(toCombatParticipant(personagem()).combat.cyberwareSP, { head: 0, body: 0 });
  assert.deepEqual(toCombatParticipant(participante()).combat.cyberwareSP, { head: 0, body: 0 });
});

/* -------------------------------------------------------------------------- *
 * 2 — EncounterParticipant → CombatParticipant
 * -------------------------------------------------------------------------- */

test("EncounterParticipant → CombatParticipant preserva o estado do encontro", () => {
  const combatant = toCombatParticipant(participante());

  assert.equal(combatant.id, "instance-2");
  assert.equal(combatant.type, "enemy");
  assert.equal(combatant.name, "Scrappy #2");
  assert.deepEqual(combatant.source, {
    characterId: null,
    sourceKey: "instance-2",
    enemyId: TEMPLATE,
  });

  // O encontro só conhece REF (+MOVE quando existe): nada é inventado.
  assert.deepEqual(combatant.stats, { REF: 6, MOVE: 5 });

  assert.equal(combatant.weapons?.length, 1);
  assert.equal(combatant.weapons?.[0].name, "Heavy Pistol");
  assert.equal(combatant.weapons?.[0].damage, "3d6");
  assert.equal(combatant.weapons?.[0].skill, "handgun");
  assert.equal(combatant.weapons?.[0].magazine, 8);
  assert.equal(combatant.weapons?.[0].ammo, 5);

  assert.deepEqual(combatant.combat.hp, { current: 35, max: 35 });
  assert.deepEqual(combatant.combat.armor, { head: 11, body: 11 });
  assert.deepEqual(combatant.combat.conditions, [{ id: "stunned", name: "Atordoado" }]);
  assert.equal(combatant.combat.initiative, 14);
  assert.equal(combatant.combat.isDead, false);

  // Contexto sem death save e sem lesões rastreadas — presença honesta.
  assert.equal(combatant.combat.deathSave, undefined);
  assert.deepEqual(combatant.combat.criticalInjuries, []);
  assert.equal(combatant.economy, undefined);

  // Estado de morte do inimigo continua sendo HP ≤ 0 (mesmo critério da mesa).
  const derrotado = toCombatParticipant(participante({ hp: { current: 0, max: 35 } }));
  assert.equal(derrotado.combat.isDead, true);
});

/* -------------------------------------------------------------------------- *
 * 3 — identidade da instância
 * -------------------------------------------------------------------------- */

test("id é a INSTÂNCIA e source mantém template e origem separados", () => {
  const combatant = toCombatParticipant(
    participante({ enemyId: "scrapper", id: "instance-2" }),
  );

  assert.equal(combatant.id, "instance-2");
  // `sourceKey` é a chave estável da instância — é o que vira
  // `mesa_combatants.source_key` (gmStorage.ts:170-174), nunca o template.
  assert.equal(combatant.source.sourceKey, "instance-2");
  // O template continua referenciado, mas NO LUGAR dele: `source.enemyId`.
  assert.equal(combatant.source.enemyId, "scrapper");
  assert.notEqual(combatant.id, "scrapper");
});

/* -------------------------------------------------------------------------- *
 * 4 — dois participantes do mesmo template
 * -------------------------------------------------------------------------- */

test("dois participantes do mesmo template produzem ids diferentes", () => {
  const primeiro = toCombatParticipant(participante({ enemyId: "scrapper", id: "instance-1" }));
  const segundo = toCombatParticipant(participante({ enemyId: "scrapper", id: "instance-2" }));

  assert.equal(primeiro.id, "instance-1");
  assert.equal(segundo.id, "instance-2");
  assert.notEqual(primeiro.id, segundo.id);
  assert.equal(primeiro.source.enemyId, segundo.source.enemyId);
  assert.equal(primeiro.source.sourceKey, "instance-1");
  assert.equal(segundo.source.sourceKey, "instance-2");
});

/* -------------------------------------------------------------------------- *
 * 5 — adapters não mutam a origem
 * -------------------------------------------------------------------------- */

test("adapters não mutam a origem", () => {
  const character = personagem();
  const participant = participante();
  const characterSnapshot = structuredClone(character);
  const participantSnapshot = structuredClone(participant);

  const fromCharacter = toCombatParticipant(character);
  const fromParticipant = toCombatParticipant(participant);

  assert.deepEqual(character, characterSnapshot);
  assert.deepEqual(participant, participantSnapshot);

  // A cópia é independente: mexer nela não alcança a origem.
  fromCharacter.combat.hp.current = 0;
  fromParticipant.combat.armor.body = 0;
  assert.equal(character.combat.hp.current, 27);
  assert.equal(participant.armor.body, 11);
});

/* -------------------------------------------------------------------------- *
 * 6 — campos opcionais
 * -------------------------------------------------------------------------- */

test("campos opcionais ficam ausentes quando a origem não os tem", () => {
  // a) economia: nenhum dos dois contextos tem orçamento de Actions.
  const ficha = toCombatParticipant(personagem());
  const encontro = toCombatParticipant(participante());
  assert.equal(ficha.economy, undefined);
  assert.equal(encontro.economy, undefined);

  // b) death save: a ficha tem, o encontro (inimigo) não.
  assert.deepEqual(ficha.combat.deathSave, { dc: 6, failures: 1 });
  assert.equal(encontro.combat.deathSave, undefined);

  // c) ammo: arma de corpo a corpo não tem pente nem balas — e o adapter não
  //    cria `ammo: 0` nem `magazine: 0` para "preencher" o contrato.
  const desarmado = toCombatParticipant(
    participante({
      weaponName: "Combat Knife",
      weaponSkillId: "melee_weapons",
      damageExpression: "1d6",
      magazine: undefined,
      ammo: undefined,
    }),
  );
  assert.equal("ammo" in (desarmado.weapons?.[0] ?? {}), false);
  assert.equal("magazine" in (desarmado.weapons?.[0] ?? {}), false);

  // d) arma da ficha sem campo de munição também não nasce com um.
  const semMunicao = toCombatParticipant({
    ...personagem(),
    weapons: [arma({ magazine: undefined, ammo: undefined })],
  });
  assert.equal("ammo" in (semMunicao.weapons?.[0] ?? {}), false);

  // e) skills: a ficha tem a ficha de perícia inteira. O encontro não tem
  //    ficha de perícia — mas desde o F1.7 ele expõe a PERÍCIA DA ARMA com
  //    o nível puro (`skillValue − REF`): a origem TEM os dados, então este
  //    campo deixa de ser ausente (pendência §6 do F1.1 fechada no F1.7 §6;
  //    esta asserção foi atualizada junto com o comportamento exigido).
  assert.deepEqual(encontro.skills?.handgun, { stat: "REF", level: 4 });
  assert.notEqual(ficha.skills, undefined);
});

/* -------------------------------------------------------------------------- *
 * 7 — teste de contrato (§15 do relatório F1.1)
 * -------------------------------------------------------------------------- */

test("contrato: campos mínimos de CombatParticipant, CombatState, CombatAction e CombatResult", () => {
  const participant = toCombatParticipant(personagem());

  // CombatParticipant
  assert.equal(typeof participant.id, "string");
  assert.equal(typeof participant.type, "string");
  assert.equal(typeof participant.name, "string");
  assert.ok(participant.combat.hp);
  assert.equal(typeof participant.combat.hp.max, "number");
  assert.ok(participant.combat.armor);
  // initiative pode ser null; economy pode ficar de fora.
  assert.equal(participant.combat.initiative, null);
  assert.equal(participant.economy, undefined);

  // CombatState — sem `order` e sem relógio, como o F1.0 definiu.
  const state: CombatState = {
    id: "combat-1",
    status: "active",
    round: 2,
    initiativeStarted: true,
    activeParticipantId: participant.id,
    participants: [participant],
  };
  assert.equal(state.participants.length, 1);
  assert.equal(state.round, 2);
  assert.equal("order" in state, false);
  assert.equal("turnStartedAt" in state, false);
  assert.equal("eventLog" in state, false);

  // CombatAction — união fechada, sem custo embutido.
  const action: CombatAction = { type: "attack", actorId: participant.id, targetId: participant.id, attackType: "handgun", attackMode: "normal", defense: { type: "dv", value: 10, source: "range_table" } };
  assert.equal(action.type, "attack");
  const lifecycle: CombatAction = { type: "end_turn", actorId: null };
  assert.equal(lifecycle.type, "end_turn");

  // CombatResult — contrato comum das próximas etapas.
  const result: CombatResult = {
    ok: true,
    state,
    changes: [],
    rolls: [],
    events: [],
  };
  assert.equal(result.ok, true);
  assert.equal(result.state.id, "combat-1");
  assert.deepEqual(result.events, []);
  assert.equal(result.errors, undefined);
});

/* -------------------------------------------------------------------------- *
 * 8 — normalização exigida (F0.4/F0.5: nenhuma geração de id nova)
 * -------------------------------------------------------------------------- */

test("adapter recusa participante sem id de instância", () => {
  const semId = { ...participante(), id: "" } as NormalizedEncounterParticipant;
  assert.throws(() => toCombatParticipant(semId), /ensureEncounterIds/);
});
