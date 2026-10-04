/**
 * F1.8D.2 — WEAPON DAMAGE RESOLVER
 *
 *     AttackAction → Attack Engine → AttackResult (hit)
 *                                       ↓
 *                          rollWeaponDamage(actor, attack, rng)
 *                                       ↓  DiceResult (dano bruto)
 *                          DamageAction.amount = roll.total
 *                                       ↓
 *                          Damage Engine → DamageResult.rawDamage
 *
 * O que esta suíte cobre (§15 do plano F1.8D.2):
 *
 *   1. 1d6 — um dado, um resultado;
 *   2. 2d6 — dois resultados e a soma;
 *   3/4. mínimo e máximo de todos os dados;
 *   5. determinismo — duas FONTES INDEPENDENTES com a mesma sequência;
 *   6. consumo — um 2d6 consome exatamente dois valores;
 *   7. arma inexistente → `CombatError`;
 *   8. definição de dano inválida → `CombatError`;
 *   9. MISS → nenhuma rolagem, nenhum dado consumido;
 *  10. HIT → dá para montar o `DamageAction` com o total;
 *  11. integração — o total chega INTACTO ao `DamageResult.rawDamage`.
 *
 * Nenhuma regra nova: a rolagem é o `rollDice` canônico de `src/lib/dice.ts`
 * (parser `NdM`, fonte `RandomSource`), o mesmo que ficha e encontro usam.
 * Aqui não existe armadura, Critical Injury, Local de Impacto, autofire,
 * parry nem dano crítico — são etapas futuras.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createTestRandomSource } from "../src/lib/random.ts";
import { execute } from "../src/lib/combat/engine.ts";
import { rollWeaponDamage, type WeaponDamageRollResult } from "../src/lib/combat/weaponDamage.ts";
import type {
  AttackResult,
  CombatAction,
  CombatError,
  CombatParticipant,
  CombatState,
  CombatWeapon,
} from "../src/lib/combat/contract.ts";
import type { DiceResult } from "../src/lib/dice.ts";

/* -------------------------------------------------------------------------- *
 * Fixtures — recortes reais do contrato, montados à mão.
 * -------------------------------------------------------------------------- */

const PC_ID = "f18d2-pc";
const INIMIGO_ID = "f18d2-inimigo";
const ARMA_ID = "f18d2-pistol";

function arma(damage: string, overrides: Partial<CombatWeapon> = {}): CombatWeapon {
  return {
    id: ARMA_ID,
    name: "Heavy Pistol",
    damage,
    skill: "handgun",
    attackType: "handgun",
    ammo: 8,
    ...overrides,
  };
}

function personagem(weapons: CombatWeapon[]): CombatParticipant {
  return {
    id: PC_ID,
    type: "character",
    name: "V",
    source: { characterId: PC_ID, sourceKey: null, enemyId: null },
    stats: { REF: 7, DEX: 6 },
    skills: { handgun: { stat: "REF", level: 6 } },
    combat: {
      hp: { current: 40, max: 40 },
      armor: { head: 0, body: 0 },
      cyberwareSP: { head: 0, body: 0 },
      criticalInjuries: [],
      conditions: [],
      initiative: null,
      isDead: false,
    },
    weapons,
  };
}

/** Alvo do fluxo: 40 HP, SP 4 no corpo (para ver o dano bruto virar dano final). */
function inimigo(): CombatParticipant {
  return {
    id: INIMIGO_ID,
    type: "enemy",
    name: "Scrappy",
    source: { characterId: null, sourceKey: INIMIGO_ID, enemyId: "scrapper" },
    stats: { REF: 6 },
    combat: {
      hp: { current: 40, max: 40 },
      armor: { head: 0, body: 4 },
      cyberwareSP: { head: 0, body: 0 },
      criticalInjuries: [],
      conditions: [],
      initiative: null,
      isDead: false,
    },
  };
}

function estado(participants: CombatParticipant[]): CombatState {
  return {
    id: "f18d2-combat",
    status: "active",
    round: 1,
    initiativeStarted: true,
    activeParticipantId: participants[0]?.id ?? null,
    participants,
  };
}

/** `AttackResult` de ataque certo com a arma padrão — o que o motor devolve. */
function ataque(overrides: Partial<AttackResult> = {}): AttackResult {
  return {
    attackId: "f18d2-attack-1",
    attackType: "handgun",
    label: "Handgun",
    roll: { expression: "1d10", rolls: [5], total: 5 },
    baseStat: { id: "REF", value: 7 },
    skill: { id: "handgun", value: 6 },
    total: 18,
    critical: false,
    fumble: false,
    hit: true,
    defenseType: "dv",
    defenseValue: 10,
    ammoConsumed: 1,
    weaponId: ARMA_ID,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- *
 * Narrowing sem cast: o resultado é um união discriminada por `ok`.
 * -------------------------------------------------------------------------- */

function okRoll(result: WeaponDamageRollResult): DiceResult {
  assert.equal(result.ok, true, `esperava rolagem, veio ${JSON.stringify(result)}`);
  if (result.ok) return result.roll;
  throw new Error("inacessível");
}

function erroRoll(result: WeaponDamageRollResult): CombatError {
  assert.equal(result.ok, false, `esperava recusa, veio ${JSON.stringify(result)}`);
  if (!result.ok) return result.error;
  throw new Error("inacessível");
}

/* ========================================================================== *
 * 1 e 2 — Formatos canônicos: 1d6 e 2d6
 * ========================================================================== */

test("1d6: um dado, um resultado, total igual a esse dado", () => {
  const rng = createTestRandomSource([4, 9]);
  const roll = okRoll(rollWeaponDamage(personagem([arma("1d6")]), ataque(), rng));

  assert.equal(roll.expression, "1d6", "a expressão sai normalizada pelo parser canônico");
  assert.deepEqual(roll.rolls, [4]);
  assert.equal(roll.total, 4);
  assert.equal(rng.d10(), 9, "só o primeiro valor da sequência foi consumido");
});

test("2d6: dois resultados individuais e a soma correta", () => {
  const rng = createTestRandomSource([4, 5, 9]);
  const roll = okRoll(rollWeaponDamage(personagem([arma("2d6")]), ataque(), rng));

  assert.equal(roll.expression, "2d6");
  assert.deepEqual(roll.rolls, [4, 5], "cada dado é preservado (útil para UI/event log)");
  assert.equal(roll.total, 9, "4 + 5");
  assert.equal(rng.d10(), 9, "um 2d6 consome exatamente DOIS valores");
});

/* ========================================================================== *
 * 3 e 4 — Extremos: todos no mínimo, todos no máximo
 * ========================================================================== */

test("resultado mínimo: todos os dados no menor valor", () => {
  const roll = okRoll(
    rollWeaponDamage(personagem([arma("3d6")]), ataque(), createTestRandomSource([1, 1, 1])),
  );

  assert.deepEqual(roll.rolls, [1, 1, 1]);
  assert.equal(roll.total, 3, "3d6 mínimos = 3");
});

test("resultado máximo: todos os dados no maior valor", () => {
  const roll = okRoll(
    rollWeaponDamage(personagem([arma("3d6")]), ataque(), createTestRandomSource([6, 6, 6])),
  );

  assert.deepEqual(roll.rolls, [6, 6, 6]);
  assert.equal(roll.total, 18, "3d6 máximos = 18");
});

/* ========================================================================== *
 * 5 — Determinismo (fontes INDEPENDENTES, lição do F1.8C)
 * ========================================================================== */

test("determinismo: mesma arma + mesma sequência em fontes independentes → mesmo resultado", () => {
  const actor = personagem([arma("2d6")]);
  const action = ataque();

  // `createTestRandomSource` é stateful (cursor interno): cada chamada
  // precisa da SUA instância, com a mesma sequência declarada.
  const r1 = okRoll(rollWeaponDamage(actor, action, createTestRandomSource([4, 5])));
  const r2 = okRoll(rollWeaponDamage(actor, action, createTestRandomSource([4, 5])));

  assert.deepEqual(r1, r2, "mesma sequência → mesmo DiceResult, byte a byte");
  assert.deepEqual(r1.rolls, [4, 5], "os dois dados, na ordem da sequência");
  assert.equal(r1.total, 9);
  assert.equal(r1.expression, "2d6");

  // Contraste: sequência com os valores trocados muda a ORDEM dos dados —
  // prova que a fonte é injetada mesmo e não resultado fixo.
  const trocado = okRoll(rollWeaponDamage(actor, action, createTestRandomSource([5, 4])));
  assert.deepEqual(trocado.rolls, [5, 4], "ordem da sequência → ordem dos dados");
  assert.equal(trocado.total, 9, "a soma é a mesma; a ordem dos dados não muda o total");
  assert.notDeepEqual(trocado.rolls, r1.rolls);
});

/* ========================================================================== *
 * 6 — Consumo de RNG
 * ========================================================================== */

test("consumo: um 2d6 consome exatamente dois valores do RandomSource", () => {
  const rng = createTestRandomSource([4, 5, 9, 1]);

  okRoll(rollWeaponDamage(personagem([arma("2d6")]), ataque(), rng));

  assert.equal(rng.d10(), 9, "o 3º valor ainda estava lá: só dois foram gastos");
  assert.equal(rng.d10(), 1, "e o 4º também, na ordem");
  // Esgotamento continua sendo erro da fonte (F1.4 §8), nunca silêncio.
  assert.throws(() => rng.d10(), /esgotado/);
});

/* ========================================================================== *
 * 7 — Arma inexistente / sem identificação
 * ========================================================================== */

test("weaponId que não existe no participante → CombatError, sem consumir RNG", () => {
  const rng = createTestRandomSource([1]);
  const error = erroRoll(
    rollWeaponDamage(personagem([arma("2d6")]), ataque({ weaponId: "arma-fantasma" }), rng),
  );

  assert.equal(error.code, "rule_violation", "o mesmo código do Attack Engine para arma");
  assert.match(error.message, /arma-fantasma/);
  assert.equal(rng.d10(), 1, "nenhuma face foi sorteada");
});

test("ataque sem weaponId (caminho skillId) → recusa declarando a limitação", () => {
  const semArma = ataque();
  delete semArma.weaponId;
  const rng = createTestRandomSource([1]);

  const error = erroRoll(rollWeaponDamage(personagem([arma("2d6")]), semArma, rng));

  assert.equal(error.code, "rule_violation");
  assert.match(error.message, /weaponId/);
  assert.equal(rng.d10(), 1, "sem arma identificada não há rolagem nenhuma");
});

/* ========================================================================== *
 * 8 — Definição de dano inválida
 * ========================================================================== */

test("arma sem definição de dano → CombatError, sem consumir RNG", () => {
  for (const damage of ["", "   "]) {
    const rng = createTestRandomSource([1]);
    const error = erroRoll(rollWeaponDamage(personagem([arma(damage)]), ataque(), rng));

    assert.equal(error.code, "rule_violation", `damage="${damage}"`);
    assert.match(error.message, /não possui definição de dano/, `damage="${damage}"`);
    assert.equal(rng.d10(), 1, `damage="${damage}": nada foi sorteado`);
  }
});

test("expressão de dano inválida → CombatError, sem consumir RNG", () => {
  // NdM puro é o contrato do parser canônico: quantidade inteira ≥ 1,
  // faces ≥ 2, no máximo 100 dados, nada de termos soltos.
  for (const damage of ["abc", "0d6", "1d1", "2.5d6", "1d6+3", "-2d6", "4d6d6"]) {
    const rng = createTestRandomSource([1]);
    const error = erroRoll(rollWeaponDamage(personagem([arma(damage)]), ataque(), rng));

    assert.equal(error.code, "rule_violation", `damage="${damage}"`);
    assert.match(error.message, /Expressão de dano inválida/, `damage="${damage}"`);
    assert.equal(rng.d10(), 1, `damage="${damage}": a validação é a seco, a fonte não gasta`);
  }
});

/* ========================================================================== *
 * 9 e 10 — MISS não rola / HIT permite montar a DamageAction
 * ========================================================================== */

test("MISS: ataque que erra não rola dano nem consome RandomSource", () => {
  const rng = createTestRandomSource([1]);
  const error = erroRoll(
    rollWeaponDamage(personagem([arma("3d6")]), ataque({ hit: false, defenseValue: 30 }), rng),
  );

  assert.equal(error.code, "rule_violation");
  assert.match(error.message, /não acertou/);
  assert.equal(rng.d10(), 1, "o miss não gasta dado de dano (F1.8C: hit=false)");
});

test("HIT: o total do rolado vira DamageAction.amount sem passar por mais nada", () => {
  const roll = okRoll(
    rollWeaponDamage(personagem([arma("2d6")]), ataque({ hit: true }), createTestRandomSource([4, 5])),
  );

  const damageAction: CombatAction = {
    type: "damage",
    actorId: PC_ID,
    targetId: INIMIGO_ID,
    amount: roll.total,
  };

  assert.equal(roll.total, 9);
  assert.equal(damageAction.type, "damage");
  assert.equal(damageAction.amount, roll.total, "o DamageAction recebe exatamente o total rolado");
  assert.equal(damageAction.amount, 9, "2d6 → 4 + 5 = 9");
});

/* ========================================================================== *
 * 11 — Integração: Attack Engine → Resolver → Damage Engine
 * ========================================================================== */

test("fluxo completo: hit → rolagem da arma → DamageResult.rawDamage = total rolado", () => {
  const state = estado([personagem([arma("2d6")]), inimigo()]);
  const rng = createTestRandomSource([5, 4, 5, 9]);

  // 1) ATAQUE — 7 (REF) + 6 (perícia) + 5 (d10) = 18 > DV 10 → hit.
  const atk = execute(
    state,
    {
      type: "attack",
      actorId: PC_ID,
      targetId: INIMIGO_ID,
      weaponId: ARMA_ID,
      attackType: "handgun",
      attackMode: "normal",
      defense: { type: "dv", value: 10, source: "range_table" },
    },
    rng,
  );
  assert.equal(atk.ok, true, JSON.stringify(atk.errors));
  const attackResult = atk.attackResult;
  assert.ok(attackResult, "ataque produce AttackResult");
  assert.equal(attackResult.hit, true, "18 > 10");
  assert.equal(attackResult.weaponId, ARMA_ID, "F1.8C intacto: a arma vem do ataque");
  assert.equal(attackResult.total, 18);
  assert.equal(atk.state.participants[0].weapons?.[0].ammo, 7, "F1.8C intacto: 1 munição consumida");

  // 2) ROLAGEM DE DANO — só porque `hit === true`; mesmos valores do mesmo rng.
  const damage = rollWeaponDamage(atk.state.participants[0], attackResult, rng);
  const roll = okRoll(damage);
  assert.deepEqual(roll.rolls, [4, 5], "os dois dados do 2d6");
  assert.equal(roll.total, 9);

  // 3) DAMAGE ENGINE — o total entra INTACTO como `amount`.
  const damageResult = execute(atk.state, {
    type: "damage",
    actorId: PC_ID,
    targetId: INIMIGO_ID,
    amount: roll.total,
  });
  assert.equal(damageResult.ok, true, JSON.stringify(damageResult.errors));

  const dmg = damageResult.damageResult;
  assert.ok(dmg, "dano resolvido produce DamageResult");
  assert.equal(dmg.rawDamage, 9, "rawDamage = total rolado, ANTES da armadura");
  assert.equal(dmg.armorValue, 4, "SP 4 do corpo (F1.8D.1 continua dono da armadura)");
  assert.equal(dmg.damageAfterArmor, 5, "9 − 4");
  assert.equal(dmg.hpBefore, 40);
  assert.equal(dmg.hpAfter, 35, "40 − 5");

  // Consumo exato do começo ao fim: 1 do ataque + 2 do 2d6 = 3 valores.
  assert.equal(rng.d10(), 9, "foram consumidos exatamente 3 valores, nessa ordem");
});

test("fluxo com MISS: o ataque erra e o resolver não rola dano nenhum", () => {
  const state = estado([personagem([arma("2d6")]), inimigo()]);
  const rng = createTestRandomSource([5, 7]);

  const atk = execute(
    state,
    {
      type: "attack",
      actorId: PC_ID,
      targetId: INIMIGO_ID,
      weaponId: ARMA_ID,
      attackType: "handgun",
      attackMode: "normal",
      defense: { type: "dv", value: 30, source: "range_table" },
    },
    rng,
  );
  const attackResult = atk.attackResult;
  assert.ok(attackResult, "ataque produce AttackResult mesmo no miss");
  assert.equal(attackResult.hit, false, "18 <= 30 → errou");

  const error = erroRoll(rollWeaponDamage(atk.state.participants[0], attackResult, rng));
  assert.equal(error.code, "rule_violation");
  assert.match(error.message, /não acertou/);

  assert.equal(rng.d10(), 7, "só o dado do ataque foi consumido: o miss não gasta dado de dano");
});
