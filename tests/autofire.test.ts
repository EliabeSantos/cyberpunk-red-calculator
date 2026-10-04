/**
 * F1.8D.6 — AUTOFIRE
 *
 * O que a auditoria encontrou e o que esta suíte fixa:
 *
 *   • A ÚNICA regra de Autofire do projeto é o custo de munição: **10 balas**
 *     (4 fontes convergentes: `lib/attacks.ts:297`, rótulo da UI "10 ammo",
 *     contrato F1.0 §13 nº 7 e o teste fechado `attack-mode-flow`).
 *   • NÃO existe no projeto: DV/multiplicador de dano, contagem de balas,
 *     rolagens extras, ligação com ROF, defesa própria, restrição de arma nem
 *     combinação com Aimed — tudo isso é RULE GAP, não implementado aqui.
 *   • Por isso o Autofire entra pelo MESMO Attack Engine: `attackMode` só
 *     decide `ammoCost`. Rolagem, defesa, critical/fumble, −8 do aimed e o
 *     pipeline de dano são os de sempre — **zero sorteios extras**.
 *   • A munição continua sendo paga incondicionalmente (miss e fumble pagam),
 *     como já era no legado e no motor; a recusa (`ammo < custo`) acontece
 *     ANTES de qualquer sorteio.
 *   • ROF não é exigido nem consultado: a fonte canônica continua sendo a arma
 *     (`weaponId → actor.weapons → rateOfFire`) e o modo não a altera.
 *
 * Fora do escopo, não testado aqui como se existisse: Supressive Fire, Parry,
 * random hit location, headshot, multiplicador de dano, Action Economy.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import ts from "typescript";

import { createTestRandomSource } from "../src/lib/random.ts";
import { execute } from "../src/lib/combat/engine.ts";
import { rollWeaponDamage } from "../src/lib/combat/weaponDamage.ts";
import type {
  AttackAction,
  AttackResult,
  CombatAction,
  CombatError,
  CombatParticipant,
  CombatResult,
  CombatState,
  CombatStateChange,
  CombatWeapon,
  DamageResult,
} from "../src/lib/combat/contract.ts";

/* -------------------------------------------------------------------------- *
 * Fixtures — recortes reais do contrato, montados à mão.
 * -------------------------------------------------------------------------- */

const ATACANTE_ID = "f18d6-atacante";
const ALVO_ID = "f18d6-alvo";
const ARMA_ID = "f18d6-arma";

function arma(
  { damage = "2d6", ammo = 30, rateOfFire }: { damage?: string; ammo?: number; rateOfFire?: number } = {},
): CombatWeapon {
  return {
    id: ARMA_ID,
    name: "SMG",
    damage,
    skill: "handgun",
    attackType: "handgun",
    ammo,
    ...(rateOfFire !== undefined ? { rateOfFire } : {}),
  };
}

const saudePadrao = {
  armor: { head: 0, body: 0 },
  cyberwareSP: { head: 0, body: 0 },
  criticalInjuries: [],
  conditions: [],
  initiative: null,
  isDead: false,
};

/** Atacante com arma — SEM `deathSave`: quem ataca não rastreia lesões. */
function atacante(weapons: CombatWeapon[]): CombatParticipant {
  return {
    id: ATACANTE_ID,
    type: "character",
    name: "V",
    source: { characterId: ATACANTE_ID, sourceKey: null, enemyId: null },
    stats: { REF: 7, DEX: 6 },
    skills: { handgun: { stat: "REF", level: 6 } },
    combat: { hp: { current: 40, max: 40 }, ...saudePadrao },
    weapons,
  };
}

/** Alvo opcionalmente com Evasão (defesa rolada) e/ou `deathSave` (lesões). */
function alvo({ evasion = false, deathSave = false } = {}): CombatParticipant {
  return {
    id: ALVO_ID,
    type: "character",
    name: "Alvo",
    source: { characterId: ALVO_ID, sourceKey: null, enemyId: null },
    stats: { REF: 6, DEX: 5 },
    ...(evasion ? { skills: { evasion: { stat: "DEX" as const, level: 4 } } } : {}),
    combat: {
      hp: { current: 30, max: 40 },
      ...saudePadrao,
      ...(deathSave ? { deathSave: { dc: 0, failures: 0 } } : {}),
    },
  };
}

function estado(participants: CombatParticipant[]): CombatState {
  return {
    id: "f18d6-combat",
    status: "active",
    round: 1,
    initiativeStarted: true,
    activeParticipantId: participants[0]?.id ?? null,
    participants,
  };
}

/** Ação padrão da suíte: AUTO FIRE (os testes comparam com o normal). */
function ataque(overrides: Partial<AttackAction> = {}): AttackAction {
  return {
    type: "attack",
    actorId: ATACANTE_ID,
    targetId: ALVO_ID,
    weaponId: ARMA_ID,
    attackType: "handgun",
    attackMode: "autofire",
    defense: { type: "dv", value: 10, source: "range_table" },
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- *
 * Helpers de asserção
 * -------------------------------------------------------------------------- */

function ok(result: CombatResult): CombatResult {
  assert.equal(result.ok, true, `esperava sucesso, veio ${JSON.stringify(result.errors)}`);
  return result;
}

function resultado(result: CombatResult): AttackResult {
  const r = ok(result);
  assert.ok(r.attackResult, "sucesso de ataque vem com attackResult");
  return r.attackResult;
}

function falha(result: CombatResult): CombatResult {
  assert.equal(result.ok, false, "esperava recusa");
  return result;
}

function erro(result: CombatResult): CombatError {
  falha(result);
  const errors = result.errors;
  assert.ok(errors && errors.length > 0, "recusa vem com errors");
  assert.equal(result.attackResult, undefined, "recusa não tem attackResult");
  return errors[0];
}

function damageOk(result: CombatResult): DamageResult {
  const r = ok(result);
  assert.ok(r.damageResult, "sucesso de dano vem com damageResult");
  return r.damageResult;
}

function ammoChanges(result: CombatResult): Extract<CombatStateChange, { type: "ammo_changed" }>[] {
  return result.changes.filter(
    (change): change is Extract<CombatStateChange, { type: "ammo_changed" }> =>
      change.type === "ammo_changed",
  );
}

function armaDoAtacante(state: CombatState): CombatWeapon {
  const weapon = state.participants[0].weapons?.find((w) => w.id === ARMA_ID);
  assert.ok(weapon, "a arma do atacante existe no estado");
  return weapon;
}

/* ========================================================================== *
 * 1 — Autofire entra pelo MESMO Attack Engine (só a munição muda)
 * ========================================================================== */

test("Autofire vs normal: resultado idêntico, só o custo de munição difere", () => {
  const roda = (mode: AttackAction["attackMode"]) => {
    const rng = createTestRandomSource([5, 9]);
    const result = execute(estado([atacante([arma()]), alvo()]), ataque({ attackMode: mode }), rng);
    return { result, rng };
  };

  const n = roda("normal");
  const a = roda("autofire");
  const an = resultado(n.result);
  const aa = resultado(a.result);

  // Nada além da munição muda: mesma rolagem, mesmo total, mesmo hit/defesa.
  assert.deepEqual(aa.roll, an.roll, "mesmo 1d10");
  assert.equal(aa.total, 18, "7 + 6 + 5 — o modo não entra na fórmula");
  assert.equal(an.total, aa.total);
  assert.equal(aa.hit, true);
  assert.equal(aa.critical, false);
  assert.equal(aa.fumble, false);
  assert.equal(aa.defenseType, "dv");
  assert.equal(aa.defenseValue, an.defenseValue);

  // Um ataque, um tiro: nenhum laço de múltiplos tiros.
  assert.equal(a.result.rolls.length, 1, "UMA rolagem, mesmo com ROF/Autofire");
  assert.equal(n.result.rolls.length, 1);

  // A ÚNICA diferença: o custo do modo.
  assert.equal(an.ammoConsumed, 1, "normal segue 1 (F1.8C inalterado)");
  assert.equal(aa.ammoConsumed, 10, "autofire custa 10 (a única regra do projeto)");
  assert.equal(armaDoAtacante(a.result.state).ammo, 20, "30 − 10");
  assert.equal(armaDoAtacante(n.result.state).ammo, 29, "30 − 1");
  assert.deepEqual(ammoChanges(a.result), [
    { type: "ammo_changed", participantId: ATACANTE_ID, weaponId: ARMA_ID, before: 30, after: 20 },
  ]);

  // Autofire não sorteou NADA a mais: sentinela intacta nos dois caminhos.
  assert.equal(a.rng.d10(), 9, "1 valor consumido (só o d10 do ataque)");
  assert.equal(n.rng.d10(), 9, "o normal consome exatamente o mesmo");
});

/* ========================================================================== *
 * 2 — Munição: 10 pagas mesmo em miss e fumble
 * ========================================================================== */

test("munição: miss com fumble ainda paga as 10 balas", () => {
  const state = estado([atacante([arma()]), alvo()]);
  // d10 = 1 → FUMBLE (F1.8C: primeiro 1 subtrai um dado → 2 valores: 1 e 9);
  // total 7 + 6 + 1 − 9 = 5 < DV 50 → miss; sentinela na posição #2.
  const rng = createTestRandomSource([1, 9, 9]);

  const result = execute(
    state,
    ataque({ defense: { type: "dv", value: 50, source: "range_table" } }),
    rng,
  );
  const ar = resultado(result);

  assert.equal(ar.fumble, true, "dado natural 1");
  assert.equal(ar.hit, false, "5 < 50 — falhou");
  assert.equal(ar.ammoConsumed, 10, "falha não isenta o pagamento");
  assert.deepEqual(ammoChanges(result), [
    { type: "ammo_changed", participantId: ATACANTE_ID, weaponId: ARMA_ID, before: 30, after: 20 },
  ]);
  assert.equal(armaDoAtacante(result.state).ammo, 20);
  assert.equal(rng.d10(), 9, "2 valores (fumble subtrai um dado) + sentinela");
});

/* ========================================================================== *
 * 3 — Sem saldo para a rajada → recusa ANTES de qualquer sorteio
 * ========================================================================== */

test("autofire com menos de 10 balas → CombatError antes de rolar", () => {
  for (const ammo of [9, 0]) {
    const state = estado([atacante([arma({ ammo })]), alvo()]);
    const rng = createTestRandomSource([5, 9]);

    const result = execute(state, ataque(), rng);
    const error = erro(result);

    assert.equal(error.code, "rule_violation", `arma com ${ammo} balas é recusada`);
    assert.match(error.message, /Munição insuficiente/);
    assert.match(error.message, /precisa de 10/);
    assert.equal(rng.d10(), 5, `${ammo} balas: nenhum valor consumido`);
    assert.deepEqual(result.state, state, "estado volta intacto");
  }
});

/* ========================================================================== *
 * 4 — ROF: fonte canônica da arma, e Autofire não exige ROF
 * ========================================================================== */

test("Autofire não exige ROF: arma sem ROF e arma com ROF 1 funcionam", () => {
  // (a) arma SEM ROF declarado (monowire/granadas do catálogo não têm).
  const semRof = execute(
    estado([atacante([arma()]), alvo()]),
    ataque(),
    createTestRandomSource([5, 9]),
  );
  const a = resultado(semRof);
  assert.equal(a.rateOfFire, undefined, "sem ROF declarado — e segue permitido");
  assert.equal(a.ammoConsumed, 10);

  // (b) arma com ROF 1: nenhuma regra do projeto exige ROF mínimo p/ autofire
  //     (exigir seria inventar — RULE GAP registrada no relatório da etapa).
  const rof1 = execute(
    estado([atacante([arma({ rateOfFire: 1 })]), alvo()]),
    ataque(),
    createTestRandomSource([5, 9]),
  );
  const b = resultado(rof1);
  assert.equal(b.rateOfFire, 1, "o ROF continua vindo da ARMA, não do modo");
  assert.equal(b.ammoConsumed, 10);
  assert.equal(armaDoAtacante(rof1.state).ammo, 20, "o modo, não o ROF, decide a munição");
});

/* ========================================================================== *
 * 5 — Defesa: Evasion reutilizada, e miss ainda paga as 10
 * ========================================================================== */

test("defesa por Evasion passa pelo mesmo canal do ataque normal", () => {
  const state = estado([atacante([arma()]), alvo({ evasion: true })]);
  const rng = createTestRandomSource([5, 9, 9]); // ataque 5, defesa 9, sentinela 9

  const result = execute(state, ataque({ defense: { type: "evasion" } }), rng);
  const ar = resultado(result);

  assert.equal(ar.defenseType, "evasion", "o motor resolve a defesa, como sempre");
  assert.deepEqual(ar.defenseRoll, { expression: "1d10", rolls: [9], total: 9 });
  assert.equal(ar.defenseValue, 18, "DEX 5 + Evasão 4 + 9 — sem rolagem extra do modo");
  assert.equal(ar.total, 18, "7 + 6 + 5");
  assert.equal(ar.hit, false, "18 > 18 é falso: empate não acerta");

  assert.equal(ar.ammoConsumed, 10, "miss paga a rajada");
  assert.equal(armaDoAtacante(result.state).ammo, 20);
  assert.equal(rng.d10(), 9, "2 valores: ataque + defesa (nada de tiro extra)");
});

/* ========================================================================== *
 * 6 — Pipeline sem duplicação: Autofire → Arma → Dano → Critical Injury
 * ========================================================================== */

test("pipeline: ataque autofire → Weapon Damage → Damage Engine → Critical Injury", () => {
  const state = estado([atacante([arma({ damage: "2d6" })]), alvo({ deathSave: true })]);
  const rng = createTestRandomSource([9, 6, 6, 3, 4, 9]);

  // 1) ATAQUE (autofire) — 7 + 6 + 9 = 22 > DV 10 → hit; 9 ≠ 10 → sem crítico.
  const atk = ok(execute(state, ataque(), rng));
  const attackResult = atk.attackResult;
  assert.ok(attackResult, "ataque produz AttackResult");
  assert.equal(attackResult.hit, true);
  assert.equal(attackResult.ammoConsumed, 10);
  assert.equal(armaDoAtacante(atk.state).ammo, 20);

  // 2) LOCALIZAÇÃO — F1.8D.3: sem aimed não há localização automática (RULE
  //    GAP de hit location aleatório) e quem declara é quem manda o dano.
  const loc = "body";

  // 3) ARMA — o MESMO `rollWeaponDamage` do F1.8D.2: 2d6 → 5 + 5 = 10 (2 valores).
  const weaponRoll = rollWeaponDamage(atk.state.participants[0], attackResult, rng);
  assert.equal(weaponRoll.ok, true, "o dano da arma não sabe o que é autofire");
  assert.ok(weaponRoll.ok);
   assert.equal(weaponRoll.roll.total, 12);

  // 4) DANO — o MESMO Damage Engine do F1.8D.1: 30 → 20 cruza o limiar (20).
  const d = ok(
    execute(
      atk.state,
      {
        type: "damage",
        actorId: ATACANTE_ID,
        targetId: ALVO_ID,
        amount: weaponRoll.roll.total,
        hitLocation: loc,
        damageRolls: weaponRoll.roll.rolls,
      } satisfies CombatAction,
      rng,
    ),
  );
  const dmg = damageOk(d);
   assert.equal(dmg.rawDamage, 12, "sem multiplicador — nenhuma regra de dano existe");
  assert.equal(dmg.hitLocation, "body");
   assert.equal(dmg.hpAfter, 13, "12 de dano + 5 da Critical Injury");

  // 5) CRITICAL INJURY — 2 valores, decidida pelo Damage Engine (F1.8D.4).
   assert.ok(dmg.criticalInjury, "2+ seis → lesão exposta pelo Damage Engine");
  const added = d.changes.filter((c) => c.type === "critical_injury_added");
  assert.equal(added.length, 1, "UMA lesão, sem gatilho parcial de autofire");

  assert.equal(
    rng.d10(),
    9,
    "5 valores no total: ataque 1 + arma 2 + lesão 2 — Autofire acrescenta 0 rolagens",
  );
});

/* ========================================================================== *
 * 7 — Determinismo (RNGs INDEPENDENTES por chamada)
 * ========================================================================== */

test("determinismo: duas execuções independentes com a mesma sequência", () => {
  const roda = () => {
    const rng = createTestRandomSource([5, 9]);
    const result = execute(
      estado([atacante([arma({ rateOfFire: 2 })]), alvo()]),
      ataque(),
      rng,
    );
    return { result, rng };
  };

  const r1 = roda();
  const r2 = roda();
  const a1 = resultado(r1.result);
  const a2 = resultado(r2.result);

  assert.equal(a1.rateOfFire, 2, "ROF da arma em ambos");
  assert.equal(a1.ammoConsumed, 10);
  assert.deepEqual(a1.roll, a2.roll);
  assert.equal(a1.total, a2.total);
  assert.equal(a1.hit, a2.hit);
  assert.equal(a1.defenseValue, a2.defenseValue);
  assert.deepEqual(r1.result.changes, r2.result.changes);
  assert.deepEqual(r1.result.state, r2.result.state);

  assert.equal(r1.rng.d10(), 9, "1 valor em cada — modo não mexe no consumo");
  assert.equal(r2.rng.d10(), 9);
});

/* ========================================================================== *
 * 8 — Falhas
 * ========================================================================== */

test("falhas: weaponId inexistente, modo desconhecido e DV inválido seguem os mesmos erros", () => {
  // (a) arma inexistente → o MESMO `WEAPON_NOT_FOUND` do F1.8C, sem RNG.
  const semArma = execute(
    estado([atacante([arma()]), alvo()]),
    ataque({ weaponId: "arma-fantasma" }),
    createTestRandomSource([5, 9]),
  );
  const e1 = erro(semArma);
  assert.equal(e1.code, "rule_violation");
  assert.match(e1.message, /WEAPON_NOT_FOUND/);

  // (b) valor fora do AttackMode (F1.8D.7 passou a aceitar `suppressive`;
  //     a guarda sobrou para o que o tipo não declara).
  const desconhecido = execute(
    estado([atacante([arma()]), alvo()]),
    ataque({ attackMode: "burst" as "autofire" }),
    createTestRandomSource([5, 9]),
  );
  const e2 = erro(desconhecido);
  assert.equal(e2.code, "rule_violation");
  assert.match(e2.message, /não é suportado/i);

  // (c) defesa inválida → `INVALID_DV` do resolveDefense reutilizado.
  const dvRuim = execute(
    estado([atacante([arma()]), alvo()]),
    ataque({ defense: { type: "dv", value: -1, source: "range_table" } }),
    createTestRandomSource([5, 9]),
  );
  const e3 = erro(dvRuim);
  assert.equal(e3.code, "rule_violation");
  assert.match(e3.message, /INVALID_DV/);
});

/* ========================================================================== *
 * 9 — Pureza (AST: comentário não conta)
 * ========================================================================== */

const ARQUIVOS_PUREZA = ["src/lib/combat/engine.ts", "src/lib/combat/contract.ts"];

const AMBIENTE_PROIBIDO = new Set([
  "window",
  "document",
  "localStorage",
  "sessionStorage",
  "gmStorage",
  "supabase",
  "React",
  "fetch",
]);

test("pureza: a resolução de Autofire não toca DOM, rede, persistência nem Math.random", () => {
  for (const rel of ARQUIVOS_PUREZA) {
    const source = readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
    const ast = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    const identificadores: string[] = [];
    let mathRandom = 0;
    const importsValue: string[] = [];

    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && AMBIENTE_PROIBIDO.has(node.text)) identificadores.push(node.text);
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "Math" &&
        node.name.text === "random"
      ) {
        mathRandom++;
      }
      if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
        importsValue.push(node.moduleSpecifier.getText(ast).replace(/^[\"']|[\"']$/g, ""));
      }
      node.forEachChild(visit);
    };
    ast.forEachChild(visit);

    assert.deepEqual(identificadores, [], `${rel} não pode citar ambiente client/persistência`);
    assert.equal(mathRandom, 0, `${rel} não pode chamar Math.random`);
    assert.deepEqual(
      importsValue.filter((spec) => /^(react|next|client-only)|supabase|gmStorage/.test(spec)),
      [],
      `${rel} não pode importar UI/persistência/rede`,
    );
  }
});
