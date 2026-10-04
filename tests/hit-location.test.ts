/**
 * F1.8D.3 — HIT LOCATION RESOLVER
 *
 *     AttackAction → Attack Engine → AttackResult (hit + aimedTarget)
 *                                        ↓
 *                          resolveHitLocation(attack)
 *                                        ↓  HitLocation (ou CombatError)
 *                          DamageAction.hitLocation (já existia, F1.1)
 *                                        ↓
 *                          Damage Engine → DamageResult.hitLocation
 *
 * O que esta suíte cobre (§18 do plano F1.8D.3):
 *
 *   1. aimed → head          → location = head;
 *   2. aimed → leg           → RULE GAP registrado (HitLocation não tem "leg");
 *   3. aimed não rola RNG    → a localização consome ZERO valores;
 *   4. miss                  → sem localização (nunca inventa);
 *   5. ataque normal         → RULE GAP (não existe regra canônica de
 *                              localização aleatória no projeto);
 *   6. determinismo          → duas FONTES INDEPENDENTES → mesma localização;
 *   7. RNG consumption       → 0 valores da etapa de localização;
 *   8. aimed sem aimedTarget → rejeitado pelo F1.8C, erro não mascarado;
 *   9. não alterar dano      → `amount` atravessa intacto;
 *  10. integração            → ataque → localização → rolagem de arma →
 *                              DamageAction → DamageResult (rawDamage,
 *                              hitLocation e HP corretos).
 *
 * Nenhuma regra nova: o tipo é o `HitLocation` canônico de `src/types/combat.ts`
 * e a entrada é o `aimedTarget` do F1.8C. Aqui não existe Critical Injury,
 * headshot, multiplicador, autofire, parry, DV nem range — etapas futuras.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createTestRandomSource } from "../src/lib/random.ts";
import { execute } from "../src/lib/combat/engine.ts";
import { resolveHitLocation, type HitLocationResult } from "../src/lib/combat/hitLocation.ts";
import { rollWeaponDamage, type WeaponDamageRollResult } from "../src/lib/combat/weaponDamage.ts";
import type {
  AttackResult,
  CombatError,
  CombatParticipant,
  CombatState,
  CombatWeapon,
  DamageAction,
  RandomSource,
} from "../src/lib/combat/contract.ts";
import type { HitLocation } from "../src/types/combat.ts";

/* -------------------------------------------------------------------------- *
 * Fixtures — recortes reais do contrato, montados à mão.
 * -------------------------------------------------------------------------- */

const PC_ID = "f18d3-pc";
const INIMIGO_ID = "f18d3-inimigo";
const ARMA_ID = "f18d3-pistol";

function arma(damage: string): CombatWeapon {
  return {
    id: ARMA_ID,
    name: "Heavy Pistol",
    damage,
    skill: "handgun",
    attackType: "handgun",
    ammo: 8,
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

/** Alvo: 40 HP, SP 0 na cabeça e SP 4 no corpo — para ver a localização escolher o slot. */
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
    id: "f18d3-combat",
    status: "active",
    round: 1,
    initiativeStarted: true,
    activeParticipantId: participants[0]?.id ?? null,
    participants,
  };
}

/** `AttackResult` de Aimed Shot certo, como o motor devolve (F1.8C). */
function ataque(overrides: Partial<AttackResult> = {}): AttackResult {
  return {
    attackId: "f18d3-attack-1",
    attackType: "handgun",
    label: "Handgun",
    roll: { expression: "1d10", rolls: [9], total: 9 },
    baseStat: { id: "REF", value: 7 },
    skill: { id: "handgun", value: 6 },
    total: 14,
    critical: false,
    fumble: false,
    hit: true,
    defenseType: "dv",
    defenseValue: 10,
    ammoConsumed: 1,
    weaponId: ARMA_ID,
    aimedTarget: "head",
    ...overrides,
  };
}

/**
 * Aimed Shot real pelo motor: 7 (REF) + 6 (perícia) + 9 (d10) − 8 (aimed) = 14
 * > DV 10 → hit, com `aimedTarget` copiado pelo F1.8C (engine.ts:707).
 */
function ataqueViaMotor(aimedTarget: "head" | "leg" | "held_item", rng: RandomSource): AttackResult {
  const state = estado([personagem([arma("2d6")]), inimigo()]);
  const result = execute(
    state,
    {
      type: "attack",
      actorId: PC_ID,
      targetId: INIMIGO_ID,
      weaponId: ARMA_ID,
      attackType: "handgun",
      attackMode: "aimed",
      aimedTarget,
      defense: { type: "dv", value: 10, source: "range_table" },
    },
    rng,
  );
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const attackResult = result.attackResult;
  assert.ok(attackResult, "aimed acertado produce AttackResult");
  return attackResult;
}

/* -------------------------------------------------------------------------- *
 * Narrowing sem cast: as duas uniões discriminadas por `ok`.
 * -------------------------------------------------------------------------- */

function local(result: HitLocationResult): HitLocation {
  assert.equal(result.ok, true, `esperava localização, veio ${JSON.stringify(result)}`);
  if (result.ok) return result.location;
  throw new Error("inacessível");
}

function erroLocal(result: HitLocationResult): CombatError {
  assert.equal(result.ok, false, `esperava recusa, veio ${JSON.stringify(result)}`);
  if (!result.ok) return result.error;
  throw new Error("inacessível");
}

function totalDano(result: WeaponDamageRollResult): number {
  assert.equal(result.ok, true, `esperava rolagem, veio ${JSON.stringify(result)}`);
  if (result.ok) return result.roll.total;
  throw new Error("inacessível");
}

/* ========================================================================== *
 * 1 — Aimed → head (localização explícita, sem rolagem)
 * ========================================================================== */

test("aimed + aimedTarget=head → location = head", () => {
  const result = resolveHitLocation(ataque({ aimedTarget: "head" }));

  assert.equal(local(result), "head");
});

test("ataque normal → location = body", () => {
  assert.equal(local(resolveHitLocation(ataque({ aimedTarget: undefined }))), "body");
});

for (const attackType of ["melee", "brawling", "martial_arts", "unarmed"] as const) {
  test(`ataque normal ${attackType} → location = body`, () => {
    assert.equal(local(resolveHitLocation(ataque({ attackType, aimedTarget: undefined }))), "body");
  });
}

/* ========================================================================== *
 * 2 — Aimed → leg
 * ========================================================================== */

test("aimed + aimedTarget=leg → location = leg", () => {
  assert.equal(local(resolveHitLocation(ataque({ aimedTarget: "leg" }))), "leg");
});

test("aimed + aimedTarget=held_item → location = held_item", () => {
  assert.equal(local(resolveHitLocation(ataque({ aimedTarget: "held_item" }))), "held_item");
});

test("alvo fora do contrato F1.8C → recusa (dado de runtime não vira localização)", () => {
  const fora = { ...ataque(), aimedTarget: "banana" } as unknown as AttackResult;
  const error = erroLocal(resolveHitLocation(fora));

  assert.equal(error.code, "rule_violation");
  assert.match(error.message, /não é um alvo do contrato/);
});

for (const aimedTarget of ["body", "right_arm", "left_arm", "right_leg", "left_leg"] as const) {
  test(`aimedTarget=${aimedTarget} → recusa`, () => {
    const error = erroLocal(resolveHitLocation({ ...ataque(), aimedTarget } as unknown as AttackResult));
    assert.equal(error.code, "rule_violation");
  });
}

/* ========================================================================== *
 * 4 — MISS: sem localização de impacto
 * ========================================================================== */

test("miss → recusa: um ataque que errou não tem localização de impacto", () => {
  const error = erroLocal(resolveHitLocation(ataque({ hit: false })));

  assert.equal(error.code, "rule_violation");
  assert.match(error.message, /não acertou/);
});

/* ========================================================================== *
 * 5 — Ataque normal: body determinístico
 * ========================================================================== */

test("ataque normal → body sem RNG", () => {
  const normal = ataque();
  delete normal.aimedTarget;

  assert.equal(local(resolveHitLocation(normal)), "body");
});

/* ========================================================================== *
 * 3 e 7 — Aimed não rola RNG: ZERO valores consumidos
 * ========================================================================== */

test("RNG consumption: a localização consome EXATAMENTE zero valores", () => {
  const rng = createTestRandomSource([9, 7]);

  // 1) ATAQUE pelo motor: consome 1 (d10 → 9, total 14 > DV 10).
  const attackResult = ataqueViaMotor("head", rng);
  assert.equal(attackResult.hit, true);

  // 2) LOCALIZAÇÃO: nenhum valor — não existe rolagem nesta etapa.
  assert.equal(local(resolveHitLocation(attackResult)), "head");

  // 3) O próximo da fila é o 2º valor da sequência: 1 do ataque + 0 daqui.
  assert.equal(rng.d10(), 7, "nenhum dado de localização foi gasto");
  assert.throws(() => rng.d10(), /esgotado/);
});

/* ========================================================================== *
 * 6 — Determinismo (duas FONTES INDEPENDENTES, lição do F1.8C)
 * ========================================================================== */

test("determinismo: mesma sequência em fontes independentes → mesma localização", () => {
  // `createTestRandomSource` é stateful (cursor interno): cada ataque precisa
  // da SUA instância, com a MESMA sequência declarada.
  const a = ataqueViaMotor("head", createTestRandomSource([9]));
  const b = ataqueViaMotor("head", createTestRandomSource([9]));

  assert.equal(a.total, b.total, "mesma sequência → mesmo ataque");
  assert.deepEqual(
    resolveHitLocation(a),
    resolveHitLocation(b),
    "mesmo ataque → mesma localização, byte a byte",
  );
  assert.deepEqual(resolveHitLocation(a), { ok: true, location: "head" });

  // E a função é pura: repetir sobre o MESMO ataque muda nada.
  assert.deepEqual(resolveHitLocation(a), resolveHitLocation(a));
});

/* ========================================================================== *
 * 8 — Aimed sem aimedTarget: rejeitado pelo F1.8C, erro não mascarado
 * ========================================================================== */

test("aimed sem aimedTarget → o F1.8C rejeita antes; o resolver nunca vê o ataque", () => {
  const state = estado([personagem([arma("2d6")]), inimigo()]);
  const rng = createTestRandomSource([9]);

  const result = execute(
    state,
    {
      type: "attack",
      actorId: PC_ID,
      targetId: INIMIGO_ID,
      weaponId: ARMA_ID,
      attackType: "handgun",
      attackMode: "aimed",
      // aimedTarget OMITIDO — inválido segundo o contrato do F1.8C.
      defense: { type: "dv", value: 10, source: "range_table" },
    },
    rng,
  );

  assert.equal(result.ok, false, "a validação do F1.8C continua de pé");
  assert.match(result.errors?.[0]?.message ?? "", /aimedTarget/);
  assert.equal(result.attackResult, undefined, "sem AttackResult não há o que localizar");
  // O erro do F1.8C NÃO é mascarado: nenhum location é produzido a partir dele.
});

/* ========================================================================== *
 * 9 — A localização não altera o dano
 * ========================================================================== */

test("não alterar dano: amount 9 chega a rawDamage 9, com head apenas informando", () => {
  const state = estado([personagem([arma("2d6")]), inimigo()]);
  const location = local(resolveHitLocation(ataque({ aimedTarget: "head" })));

  const dano = execute(state, {
    type: "damage",
    actorId: PC_ID,
    targetId: INIMIGO_ID,
    amount: 9,
    hitLocation: location,
  });
  assert.equal(dano.ok, true, JSON.stringify(dano.errors));

  const dmg = dano.damageResult;
  assert.ok(dmg, "dano resolvido produce DamageResult");
  assert.equal(dmg.rawDamage, 9, "o valor rolado NÃO muda por causa da localização");
  assert.equal(dmg.hitLocation, "head", "a localização é transportada, não aplicada");
  // A cabeça usa Head Armor e duplica somente o dano que ultrapassou o SP.
  assert.equal(dmg.armorValue, 0, "SP da cabeça (comportamento do F1.5, inalterado)");
  assert.equal(dmg.damageAfterArmor, 18);
  assert.equal(dmg.hpAfter, 22, "40 − (9 × 2)");
});

/* ========================================================================== *
 * 10 — Integração: ataque → localização → arma → DamageAction → Damage Engine
 * ========================================================================== */

test("fluxo completo: aimed → location → rolagem da arma → DamageResult", () => {
  const state = estado([personagem([arma("2d6")]), inimigo()]);
  const rng = createTestRandomSource([9, 4, 5, 7]);

  // 1) ATAQUE — 7 + 6 + 9 − 8 (aimed) = 14 > DV 10 → hit.
  const atk = execute(
    state,
    {
      type: "attack",
      actorId: PC_ID,
      targetId: INIMIGO_ID,
      weaponId: ARMA_ID,
      attackType: "handgun",
      attackMode: "aimed",
      aimedTarget: "head",
      defense: { type: "dv", value: 10, source: "range_table" },
    },
    rng,
  );
  assert.equal(atk.ok, true, JSON.stringify(atk.errors));
  const attackResult = atk.attackResult;
  assert.ok(attackResult, "ataque produce AttackResult");
  assert.equal(attackResult.hit, true);
  assert.equal(attackResult.aimedTarget, "head", "F1.8C intacto: o alvo vem do ataque");

  // 2) LOCALIZAÇÃO — sai do ataque, sem RNG.
  const location = local(resolveHitLocation(attackResult));
  assert.equal(location, "head");

  // 3) DANO DA ARMA — 2d6 → 4 + 5 = 9 (F1.8D.2, sem interferir aqui).
  const roll = totalDano(rollWeaponDamage(atk.state.participants[0], attackResult, rng));
  assert.equal(roll, 9);

  // 4) DAMAGE ENGINE — o total e a localização chegam intactos.
  const dano = execute(atk.state, {
    type: "damage",
    actorId: PC_ID,
    targetId: INIMIGO_ID,
    amount: roll,
    hitLocation: location,
  });
  assert.equal(dano.ok, true, JSON.stringify(dano.errors));

  const dmg = dano.damageResult;
  assert.ok(dmg, "dano resolvido produce DamageResult");
  assert.equal(dmg.rawDamage, 9, "rawDamage = total rolado, antes da armadura");
  assert.equal(dmg.hitLocation, "head", "DamageResult transporta a localização");
  assert.equal(dmg.armorValue, 0, "SP 0 da cabeça");
  assert.equal(dmg.damageAfterArmor, 18, "(9 − 0) × 2");
  assert.equal(dmg.hpBefore, 40);
  assert.equal(dmg.hpAfter, 22, "40 − 18");
  assert.equal(dmg.woundPenalty, 0);

  // Contabilidade da cadeia toda: 1 do ataque + 0 da localização + 2 do 2d6.
  assert.equal(rng.d10(), 7, "foram consumidos exatamente 3 valores, nessa ordem");
  assert.throws(() => rng.d10(), /esgotado/);
});

/* ========================================================================== *
 * Complementar — DamageResult expõe a localização EFETIVA do motor
 * ========================================================================== */

test("DamageAction sem hitLocation → DamageResult expõe body (default do motor desde F1.5)", () => {
  const state = estado([personagem([arma("2d6")]), inimigo()]);

  const dano = execute(state, {
    type: "damage",
    actorId: null,
    targetId: INIMIGO_ID,
    amount: 5,
  });
  assert.equal(dano.ok, true, JSON.stringify(dano.errors));
  assert.equal(dano.damageResult?.hitLocation, "body", "o mesmo default que guiou armadura e lesão");
});

test("local inválido na DamageAction continua recusado (F1.8D.1 intacto)", () => {
  const state = estado([personagem([arma("2d6")]), inimigo()]);
  const acao = {
    type: "damage",
    actorId: null,
    targetId: INIMIGO_ID,
    amount: 5,
    hitLocation: "torso",
  } as unknown as DamageAction;

  const dano = execute(state, acao);
  assert.equal(dano.ok, false);
  assert.match(dano.errors?.[0]?.message ?? "", /Local de impacto inválido/);
  assert.equal(dano.damageResult, undefined);
});
