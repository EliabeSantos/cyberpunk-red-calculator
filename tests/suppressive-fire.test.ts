/**
 * F1.8D.7 — SUPPRESSIVE FIRE
 *
 * O que a auditoria encontrou e o que esta suíte fixa:
 *
 *   • A ÚNICA regra de Suppressive no projeto é o custo de munição: **10
 *     balas** — com 4 fontes EXPLÍCITAS para "suppressive": `lib/attacks.ts:297`
 *     (`mode === "autofire" || mode === "suppressive" ? 10 : 1`), rótulo da UI
 *     ("10 ammo"), contrato F1.0 §13 nº 7 e o teste fechado `attack-mode-flow`
 *     (`["suppressive", INITIAL_AMMO - 10]`).
 *   • NÃO existe no projeto: exigência de ROF, quantidade de tiros, área,
 *     múltiplos alvos (`targets[]`), defesa própria, dano próprio, duração/
 *     estado `suppressed` nem interação com iniciativa — **tudo RULE GAP**,
 *     nada disso é implementado ou simulado aqui.
 *   • Por isso Suppressive entra pelo MESMO Attack Engine: `attackMode` só
 *     decide `ammoCost`. Sem laço de alvos, sem rolagem extra: **1 rolagem de
 *     ataque** (como qualquer ataque deste motor), defesa pelo `DefenseContext`
 *     de sempre e dano/lesão decididos só pelos módulos D.2 → D.1 → D.4.
 *   • Não se exige ROF nem quality: `qualities` do catálogo tem só `autofire`
 *     e `charge`, e ninguém lê esse campo (estado registrado na etapa).
 *
 * Fora do escopo, não testado aqui como se existisse: Parry, random hit
 * location, headshot, área, condições/efeitos persistentes, Action Economy.
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

const ATACANTE_ID = "f18d7-atacante";
const ALVO_ID = "f18d7-alvo";
const ARMA_ID = "f18d7-arma";

function arma(
  { damage = "2d6", ammo = 30, rateOfFire }: { damage?: string; ammo?: number; rateOfFire?: number } = {},
): CombatWeapon {
  return {
    id: ARMA_ID,
    name: "Rifle",
    damage,
    skill: "shoulder_arms",
    attackType: "rifle",
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
    skills: { shoulder_arms: { stat: "REF", level: 6 } },
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
    id: "f18d7-combat",
    status: "active",
    round: 1,
    initiativeStarted: true,
    activeParticipantId: participants[0]?.id ?? null,
    participants,
  };
}

/** Ação padrão da suíte: SUPPRESSIVE FIRE (os testes comparam com o normal). */
function ataque(overrides: Partial<AttackAction> = {}): AttackAction {
  return {
    type: "attack",
    actorId: ATACANTE_ID,
    targetId: ALVO_ID,
    weaponId: ARMA_ID,
    attackType: "rifle",
    attackMode: "suppressive",
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

function erro(result: CombatResult): CombatError {
  assert.equal(result.ok, false, "esperava recusa");
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
 * 1 — Modo válido: mesma resolução do normal, só a munição muda
 * ========================================================================== */

test("modo válido: suppressive = mesma resolução do normal; SEM laço de alvos, SEM rolagem extra", () => {
  const roda = (mode: AttackAction["attackMode"]) => {
    const rng = createTestRandomSource([5, 9]);
    const result = execute(estado([atacante([arma()]), alvo()]), ataque({ attackMode: mode }), rng);
    return { result, rng };
  };

  const n = roda("normal");
  const s = roda("suppressive");
  const an = resultado(n.result);
  const as = resultado(s.result);

  // Nada além da munição muda: mesma rolagem, mesmo total, mesmo hit/defesa.
  assert.deepEqual(as.roll, an.roll, "mesmo 1d10");
  assert.equal(as.total, 18, "7 + 6 + 5 — o modo não entra na fórmula");
  assert.equal(an.total, as.total);
  assert.equal(as.hit, true);
  assert.equal(as.critical, false);
  assert.equal(as.fumble, false);
  assert.equal(as.defenseType, "dv");
  assert.equal(as.defenseValue, an.defenseValue);

  // UM ataque, UM alvo, UMA rolagem: não existe `targets[]` nem for-each.
  assert.equal(s.result.rolls.length, 1, "UMA rolagem de ataque");
  assert.equal(n.result.rolls.length, 1);

  // A ÚNICA diferença: o custo do modo.
  assert.equal(an.ammoConsumed, 1, "normal segue 1 (F1.8C inalterado)");
  assert.equal(as.ammoConsumed, 10, "suppressive custa 10 (a única regra do projeto)");
  assert.equal(armaDoAtacante(s.result.state).ammo, 20, "30 − 10");
  assert.equal(armaDoAtacante(n.result.state).ammo, 29, "30 − 1");
  assert.deepEqual(ammoChanges(s.result), [
    { type: "ammo_changed", participantId: ATACANTE_ID, weaponId: ARMA_ID, before: 30, after: 20 },
  ]);

  // Suppressive não sorteou NADA a mais: sentinela intacta nos dois caminhos.
  assert.equal(s.rng.d10(), 9, "1 valor consumido (só o d10 do ataque)");
  assert.equal(n.rng.d10(), 9, "o normal consome exatamente o mesmo");
});

/* ========================================================================== *
 * 2 — Munição: falha e fumble pagam as 10
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

test("suppressive com menos de 10 balas → CombatError antes de rolar", () => {
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
 * 4 — Fonte da arma: weaponId → arma; ROF não participa
 * ========================================================================== */

test("fonte da arma: ROF não é exigido nem muda o custo de Suppressive", () => {
  // (a) arma SEM ROF declarado — nenhuma exigência de ROF existe (RULE GAP).
  const semRof = execute(
    estado([atacante([arma()]), alvo()]),
    ataque(),
    createTestRandomSource([5, 9]),
  );
  const a = resultado(semRof);
  assert.equal(a.weaponId, ARMA_ID, "a arma é resolvida por weaponId");
  assert.equal(a.rateOfFire, undefined, "sem ROF declarado — e segue permitido");
  assert.equal(a.ammoConsumed, 10);

  // (b) arma COM ROF: o valor continua vindo da arma (fonte do F1.8D.5) e,
  //     como não há regra que ligue ROF a Suppressive, o custo NÃO muda.
  const comRof = execute(
    estado([atacante([arma({ rateOfFire: 1 })]), alvo()]),
    ataque(),
    createTestRandomSource([5, 9]),
  );
  const b = resultado(comRof);
  assert.equal(b.rateOfFire, 1, "ROF transportado, intacto");
  assert.equal(b.ammoConsumed, 10, "o custo vem do MODO, não do ROF");
  assert.equal(armaDoAtacante(comRof.state).ammo, 20);
});

/* ========================================================================== *
 * 5 — Defesa: Evasion reutilizada (sem defesa própria de supressão)
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
 * 6 — Pipeline sem duplicação: suppressive → Arma → Dano → Critical Injury
 * ========================================================================== */

test("pipeline: ataque suppressive → Weapon Damage → Damage Engine → Critical Injury", () => {
  const state = estado([atacante([arma({ damage: "2d6" })]), alvo({ deathSave: true })]);
  const rng = createTestRandomSource([9, 5, 5, 3, 4, 9]);

  // 1) ATAQUE (suppressive) — 7 + 6 + 9 = 22 > DV 10 → hit; 9 ≠ 10 → sem crítico.
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
  assert.equal(weaponRoll.ok, true, "o dano da arma não sabe o que é suppressive");
  assert.ok(weaponRoll.ok);
  assert.equal(weaponRoll.roll.total, 10);

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
      } satisfies CombatAction,
      rng,
    ),
  );
  const dmg = damageOk(d);
  assert.equal(dmg.rawDamage, 10, "sem modificador — nenhuma regra de dano de supressão existe");
  assert.equal(dmg.hitLocation, "body");
  assert.equal(dmg.hpAfter, 20);

  // 5) CRITICAL INJURY — 2 valores, decidida pelo Damage Engine (F1.8D.4).
  assert.ok(dmg.criticalInjury, "limiar cruzado → lesão exposta pelo Damage Engine");
  const added = d.changes.filter((c) => c.type === "critical_injury_added");
  assert.equal(added.length, 1, "UMA lesão, sem gatilho próprio de suppressive");

  assert.equal(
    rng.d10(),
    9,
    "5 valores no total: ataque 1 + arma 2 + lesão 2 — Suppressive acrescenta 0 rolagens",
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

test("falhas: modo desconhecido e arma inexistente, ambas sem RNG", () => {
  // (a) valor fora do AttackMode → recusa de validação, antes de tudo.
  const desconhecido = execute(
    estado([atacante([arma()]), alvo()]),
    ataque({ attackMode: "suppression" as "suppressive" }),
    createTestRandomSource([5, 9]),
  );
  const e1 = erro(desconhecido);
  assert.equal(e1.code, "rule_violation");
  assert.match(e1.message, /"suppression"/);
  assert.match(e1.message, /não é suportado/);

  // (b) arma inexistente → o MESMO `WEAPON_NOT_FOUND` do F1.8C.
  const semArma = execute(
    estado([atacante([arma()]), alvo()]),
    ataque({ weaponId: "arma-fantasma" }),
    createTestRandomSource([5, 9]),
  );
  const e2 = erro(semArma);
  assert.equal(e2.code, "rule_violation");
  assert.match(e2.message, /WEAPON_NOT_FOUND/);
});

/* ========================================================================== *
 * 9 — Contrato: sem campos especulativos de supressão (ETAPA 4)
 * ========================================================================== */

test("contrato: AttackAction ganhou só o modo — sem targets, área ou duração", () => {
  const source = readFileSync(new URL("../src/lib/combat/contract.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("contract.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  let iface: ts.InterfaceDeclaration | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === "AttackAction") iface = node;
    node.forEachChild(visit);
  };
  ast.forEachChild(visit);

  assert.ok(iface, "AttackAction existe");
  const membros = iface.members
    .filter(ts.isPropertySignature)
    .map((member) => (member.name && ts.isIdentifier(member.name) ? member.name.text : ""));

  // Campos que a etapa proibiu criar sem regra determinada.
  const proibidos = [
    "targets",
    "suppressionRadius",
    "suppressionDuration",
    "suppressionDV",
    "area",
    "radius",
    "duration",
  ];
  assert.deepEqual(
    membros.filter((nome) => proibidos.includes(nome)),
    [],
    "nenhum campo especulativo de supressão pode existir",
  );

  // O único campo da etapa: o modo, com os quatro valores do AttackMode.
  const modo = iface.members.find(
    (member): member is ts.PropertySignature =>
      ts.isPropertySignature(member) &&
      !!member.name &&
      ts.isIdentifier(member.name) &&
      member.name.text === "attackMode",
  );
  assert.ok(modo?.type, "attackMode existe e tem tipo");
  const texto = modo.type.getText(ast);
  for (const valor of ["normal", "aimed", "autofire", "suppressive"]) {
    assert.ok(texto.includes(`"${valor}"`), `a união inclui "${valor}"`);
  }
});

/* ========================================================================== *
 * 10 — Pureza (AST: comentário não conta)
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

test("pureza: a resolução de Suppressive não toca DOM, rede, persistência nem Math.random", () => {
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
