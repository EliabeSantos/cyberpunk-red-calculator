/**
 * F1.8D.4 — CRITICAL INJURY ENGINE
 *
 * Consolida dentro do Combat Engine o comportamento que o projeto já tinha —
 * NADA de regra nova de Cyberpunk RED. O que esta suíte fixa:
 *
 *   1. limiar não atingido   — sem lesão, sem 2d6, `damageResult` sem o campo;
 *   2. limiar atingido       — lesão explícita + 2d6 exatos + estado;
 *   3. determinismo          — duas execuções, RNGs INDEPENDENTES;
 *   4. CRITICAL ATTACK ≠ CRITICAL INJURY — `attackResult.critical` não é gatilho;
 *   5. localização           — head usa a tabela head; corpo/braço/perna a body;
 *   6. persistência          — lesão prévia intacta, nova UMA vez, modificadores;
 *   7. pipeline completo     — ataque → arma → localização → dano → lesão;
 *   8. pureza                — motor/contrato/módulo sem DOM, rede ou Math.random;
 *   9. encontro              — quem não rastreia lesões continua sem lesão.
 *
 * O gatilho é o que a implementação ATUAL do Damage Engine já usava (F1.5):
 * `deathSave !== undefined` E `woundThresholdCrossed(...)`. Crítico de ataque
 * (dado natural 10) não entra nessa conta — e um teste dedicado impede que
 * alguém conecte os dois.
 *
 * As tabelas, o laço de 2d6 e o tipo do resultado são REUTILIZADOS de
 * `@/data/criticalInjuries` (fonte única, a mesma que a ficha usa): a suíte
 * compara por IDENTIDADE com `criticalInjuryTables`, o que quebraria se
 * existisse uma segunda cópia das regras.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import ts from "typescript";

import { createTestRandomSource } from "../src/lib/random.ts";
import { execute } from "../src/lib/combat/engine.ts";
import { resolveHitLocation, type HitLocationResult } from "../src/lib/combat/hitLocation.ts";
import { rollWeaponDamage, type WeaponDamageRollResult } from "../src/lib/combat/weaponDamage.ts";
import { criticalInjuryTables, type CriticalInjuryRoll } from "../src/data/criticalInjuries.ts";
import type {
  AttackAction,
  CombatAction,
  CombatParticipant,
  CombatResult,
  CombatState,
  CombatStateChange,
  CombatWeapon,
  DamageResult,
} from "../src/lib/combat/contract.ts";
import type { HitLocation } from "../src/types/combat.ts";

/* -------------------------------------------------------------------------- *
 * Fixtures — recortes reais do contrato, montados à mão (mesmo molde do F1.8D.3)
 * -------------------------------------------------------------------------- */

const ATACANTE_ID = "f18d4-atacante";
const ALVO_ID = "f18d4-alvo";
const ARMA_ID = "f18d4-pistol";

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

interface Combat {
  hp: [number, number];
  armor?: [number, number];
  deathSave?: { dc: number; failures: number };
  injuries?: CombatParticipant["combat"]["criticalInjuries"];
}

/** `CombatHealth` com o que os testes variam; o resto no padrão. */
function saude({
  hp,
  armor = [0, 0],
  deathSave,
  injuries,
}: Combat): CombatParticipant["combat"] {
  return {
    hp: { current: hp[0], max: hp[1] },
    armor: { head: armor[0], body: armor[1] },
    cyberwareSP: { head: 0, body: 0 },
    criticalInjuries: injuries ?? [],
    conditions: [],
    initiative: null,
    isDead: false,
    ...(deathSave ? { deathSave } : {}),
  };
}

/** Atacante com arma — SEM `deathSave`: quem ataca não precisa rastrear lesões. */
function atacante(): CombatParticipant {
  return {
    id: ATACANTE_ID,
    type: "character",
    name: "V",
    source: { characterId: ATACANTE_ID, sourceKey: null, enemyId: null },
    stats: { REF: 7, DEX: 6 },
    skills: { handgun: { stat: "REF", level: 6 } },
    combat: saude({ hp: [40, 40] }),
    weapons: [arma("2d6")],
  };
}

/** Alvo que RASTREIA lesões (`deathSave` presente) e também sabe atacar. */
function alvo(combat: CombatParticipant["combat"]): CombatParticipant {
  return {
    id: ALVO_ID,
    type: "character",
    name: "Alvo",
    source: { characterId: ALVO_ID, sourceKey: null, enemyId: null },
    stats: { REF: 7, DEX: 6 },
    skills: { handgun: { stat: "REF", level: 6 } },
    combat,
  };
}

/** Encontro: SEM `deathSave` → não rastreia lesões (adapters do F1.1). */
function inimigo(combat: CombatParticipant["combat"]): CombatParticipant {
  return {
    id: ALVO_ID,
    type: "enemy",
    name: "Scrappy",
    source: { characterId: null, sourceKey: "scrappy", enemyId: "scrapper" },
    stats: { REF: 6 },
    combat,
  };
}

function estado(participants: CombatParticipant[]): CombatState {
  return {
    id: "f18d4-combat",
    status: "active",
    round: 1,
    initiativeStarted: true,
    activeParticipantId: participants[0]?.id ?? null,
    participants,
  };
}

function ataque(overrides: Partial<AttackAction> = {}): AttackAction {
  return {
    type: "attack",
    actorId: ATACANTE_ID,
    targetId: ALVO_ID,
    skillId: "handgun",
    attackType: "handgun",
    attackMode: "normal",
    defense: { type: "dv", value: 10, source: "range_table" },
    ...overrides,
  };
}

function dano(
  targetId: string,
  amount: number,
  { actorId = null, hitLocation, damageRolls }: { actorId?: string | null; hitLocation?: HitLocation; damageRolls?: number[] } = {},
): CombatAction {
  return {
    type: "damage",
    actorId,
    targetId,
    amount,
    ...(hitLocation ? { hitLocation } : {}),
    ...(damageRolls ? { damageRolls } : {}),
  };
}

/** Alvo que atravessa o limiar com 20 de dano (30 → 10, limiar 20), se rastrear. */
function estadoComLimiar(rastreia: boolean): CombatState {
  const combat = saude({
    hp: [30, 40],
    ...(rastreia ? { deathSave: { dc: 0, failures: 0 } } : {}),
  });
  return estado([rastreia ? alvo(combat) : inimigo(combat)]);
}

/* -------------------------------------------------------------------------- *
 * Helpers de asserção
 * -------------------------------------------------------------------------- */

function ok(result: CombatResult): CombatResult {
  assert.equal(result.ok, true, `esperava sucesso, veio ${JSON.stringify(result.errors)}`);
  return result;
}

function danoOk(result: CombatResult): DamageResult {
  const r = ok(result);
  assert.ok(r.damageResult, "sucesso de dano vem com damageResult");
  return r.damageResult;
}

/** A lesão gerada — o campo novo da F1.8D.4, presente só quando houve. */
function lesao(dmg: DamageResult): CriticalInjuryRoll {
  assert.ok(dmg.criticalInjury, "esperava uma Critical Injury gerada");
  return dmg.criticalInjury;
}

function addedInjuries(result: CombatResult): Extract<CombatStateChange, { type: "critical_injury_added" }>[] {
  return result.changes.filter(
    (change): change is Extract<CombatStateChange, { type: "critical_injury_added" }> =>
      change.type === "critical_injury_added",
  );
}

function local(result: HitLocationResult): HitLocation {
  assert.equal(result.ok, true, `esperava localização, veio ${JSON.stringify(result)}`);
  if (result.ok) return result.location;
  throw new Error("inacessível");
}

function totalDano(result: WeaponDamageRollResult): number {
  assert.equal(result.ok, true, `esperava rolagem, veio ${JSON.stringify(result)}`);
  if (result.ok) return result.roll.total;
  throw new Error("inacessível");
}

/* ========================================================================== *
 * 1 — Threshold não atingido
 * ========================================================================== */

test("limiar não atingido → nenhuma lesão, nenhum 2d6 e damageResult sem criticalInjury", () => {
  const state = estadoComLimiar(true);
  const rng = createTestRandomSource([5, 6]);

  const result = execute(state, dano(ALVO_ID, 5), rng);
  const dmg = danoOk(result);

  // 30 → 25; limiar = floor(40 / 2) = 20 → 25 continua acima: nada foi cruzado.
  assert.equal(dmg.hpAfter, 25);
  assert.equal(dmg.criticalInjury, undefined, "sem lesão gerada");

  assert.deepEqual(result.rolls, [], "o 2d6 nem chegou a ser rolado");
  assert.equal(addedInjuries(result).length, 0, "nenhum change de lesão");
  assert.deepEqual(result.state.participants[0].combat.criticalInjuries, []);

  assert.equal(rng.d10(), 5, "o rng não foi tocado (o sentinela ainda está na frente)");
  assert.deepEqual(state.participants[0].combat.criticalInjuries, [], "estado original intacto");
});

/* ========================================================================== *
 * 2 — Threshold atingido
 * ========================================================================== */

test("2+ seis → uma lesão explícita no damageResult, 2d6 exatos e estado", () => {
  const state = estadoComLimiar(true);
  const rng = createTestRandomSource([3, 4, 9]);

  const result = execute(state, dano(ALVO_ID, 20, { damageRolls: [6, 6, 3] }), rng);
  const dmg = danoOk(result);

   assert.equal(dmg.hpAfter, 5, "30 − 20 de dano − 5 de Critical Injury");

  const inj = lesao(dmg);
  assert.equal(inj.roll.expression, "2d6");
  assert.deepEqual(inj.roll.rolls, [3, 4]);
  assert.equal(inj.roll.total, 7);
  assert.equal(inj.injury.name, "Foreign Object", "tabela body, roll 7");
  assert.equal(inj.injury.roll, 7);
  assert.equal(dmg.hitLocation, "body", "a localização exposta é a MESMA que escolheu a tabela");

  assert.deepEqual(result.rolls, [
    { kind: "critical_injury", actorId: null, targetId: ALVO_ID, expression: "2d6", rolls: [3, 4], total: 7 },
  ]);

  const added = addedInjuries(result);
  assert.equal(added.length, 1, "UMA lesão, um change");
  assert.equal(added[0].injury, inj.injury, "o MESMO objeto — não uma segunda lista");

  assert.deepEqual(result.state.participants[0].combat.criticalInjuries, [inj.injury]);
  assert.equal(rng.d10(), 9, "exatamente 2 valores consumidos pelo 2d6");
});

/* ========================================================================== *
 * 3 — Determinismo
 * ========================================================================== */

test("determinismo: duas execuções com RNGs INDEPENDENTES → resultados equivalentes", () => {
  const roda = (sequencia: number[]) =>
    execute(estadoComLimiar(true), dano(ALVO_ID, 20, { damageRolls: [6, 6, 3] }), createTestRandomSource(sequencia));

  const r1 = roda([3, 4]);
  const r2 = roda([3, 4]);
  const r3 = roda([2, 2]);

  // Fontes independentes: cada chamada cria o SEU RandomSource (nunca compartilhado).
  assert.deepEqual(lesao(danoOk(r1)), lesao(danoOk(r2)), "mesma sequência → mesma lesão");
  assert.deepEqual(r1.changes, r2.changes, "mesmas mudanças observáveis");
  assert.deepEqual(r1.state, r2.state, "mesmo estado resultante");

  const outra = lesao(danoOk(r3));
  assert.equal(outra.roll.total, 4, "2 + 2");
  assert.equal(outra.injury.name, "Collapsed Lung");
  assert.notDeepEqual(outra.injury, lesao(danoOk(r1)).injury, "outra sequência → outra lesão");
});

/* ========================================================================== *
 * 4 — Critical Attack ≠ Critical Injury
 * ========================================================================== */

test("CRITICAL ATTACK sem limiar cruzado → NENHUMA Critical Injury", () => {
  const state = estado([atacante(), alvo(saude({ hp: [40, 40], deathSave: { dc: 0, failures: 0 } }))]);
  const rng = createTestRandomSource([10, 3, 1, 1, 9]);

  // 1) ATAQUE — 10 estoura (F1.8C: um dado extra) → 10 + 3 = 13; 7 + 6 + 13 = 26 > DV 10.
  const atk = ok(execute(state, ataque({ weaponId: ARMA_ID }), rng));
  const attackResult = atk.attackResult;
  assert.ok(attackResult, "ataque produce AttackResult");
  assert.equal(attackResult.critical, true, "primeiro dado 10 = crítico de ATAQUE");
  assert.equal(attackResult.hit, true, "26 > 10");

  // 2) ARMA — 2d6 → 1 + 1 = 2 (F1.8D.2).
  const roll = totalDano(rollWeaponDamage(atk.state.participants[0], attackResult, rng));
  assert.equal(roll, 2);

  // 3) DANO — 40 → 38, bem acima do limiar 20: o crítico do ataque não muda nada.
  const d = ok(execute(atk.state, dano(ALVO_ID, roll, { actorId: ATACANTE_ID }), rng));
  const dmg = d.damageResult;
  assert.ok(dmg, "dano resolvido produce DamageResult");

  assert.equal(dmg.hpAfter, 38);
  assert.equal(dmg.criticalInjury, undefined, "crítico de ataque NÃO é gatilho de lesão");
  assert.deepEqual(d.rolls, [], "nenhum 2d6 de lesão");
  assert.equal(addedInjuries(d).length, 0);

  assert.equal(rng.d10(), 9, "4 consumidos (ataque 2 + arma 2); o dano não rolou nada");
});

/* ========================================================================== *
 * 5 — Localização
 * ========================================================================== */

test("localização: head usa a tabela head; corpo/braço/perna usam a tabela body", () => {
  assert.notEqual(
    criticalInjuryTables.head,
    criticalInjuryTables.body,
    "as duas tabelas são objetos distintos (a comparação abaixo não é vazia)",
  );

  const locais: HitLocation[] = ["head", "body", "leg", "held_item"];
  for (const loc of locais) {
    const state = estadoComLimiar(true);
    const rng = createTestRandomSource([3, 4, 9]);

    const result = execute(state, dano(ALVO_ID, 20, { hitLocation: loc, damageRolls: [6, 6, 3] }), rng);
    const dmg = danoOk(result);
    assert.equal(dmg.hitLocation, loc, "a localização declarada é a exposta no resultado");
    if (loc === "leg") {
      assert.equal(dmg.specialCriticalInjury?.name, "Broken Leg");
    } else {
      const inj = lesao(dmg);
      assert.equal(inj.roll.total, 7);
      assert.equal(
        inj.injury,
        criticalInjuryTables[loc].find((entry) => entry.roll === 7),
        `${loc} escolhe a tabela certa — por IDENTIDADE, não por cópia`,
      );
    }
    if (loc !== "leg") assert.equal(rng.d10(), 9, "cada lesão consome exatamente 2 valores");
  }
});

/* ========================================================================== *
 * 6 — Persistência
 * ========================================================================== */

test("persistência: lesão prévia intacta, nova entra UMA vez e modificadores seguem valendo", () => {
  const existente = criticalInjuryTables.body.find((entry) => entry.roll === 4);
  assert.ok(existente, "a tabela body tem roll 4 (Collapsed Lung)");
  assert.equal(existente.name, "Collapsed Lung");

  const state = estado([
    atacante(),
    alvo(
      saude({
        hp: [30, 40],
        deathSave: { dc: 0, failures: 0 },
        injuries: [existente],
      }),
    ),
  ]);
  const rng = createTestRandomSource([3, 4, 9]);

  // 1) DANO — 2+ seis e a nova lesão (roll 7) é DIFERENTE da prévia (roll 4).
  const d = ok(execute(state, dano(ALVO_ID, 20, { damageRolls: [6, 6, 3] }), rng));
  const nova = lesao(danoOk(d));
  assert.equal(nova.injury.name, "Foreign Object");

  const lista = d.state.participants[1].combat.criticalInjuries;
  assert.equal(lista.length, 2, "a prévia + a nova, uma lista só");
  assert.equal(lista[0], existente, "a lesão prévia é a MESMA referência, dados intactos");
  assert.equal(lista[1], nova.injury, "a nova entra UMA vez");
  assert.deepEqual(state.participants[1].combat.criticalInjuries, [existente], "estado recebido não mutado");

  const added = addedInjuries(d);
  assert.equal(added.length, 1, "um change por lesão nova");
  assert.equal(added[0].injury, nova.injury, "change e estado apontam o MESMO objeto");

  // 2) MODIFICADORES — o alvo agora ataca com as DUAS lesões ativas E já ferido:
  //   7 (REF) + 6 (handgun) + 5 (d10)                             = 18
  //   − 2 (Collapsed Lung, all_physical) − 2 (Foreign Object)     = 14
  //   − 2 (wound penalty: este mesmo dano deixou o HP em 10 ≤ 20) = 12
  const atk = ok(
    execute(
      d.state,
      ataque({ actorId: ALVO_ID, targetId: ATACANTE_ID }),
      createTestRandomSource([5]),
    ),
  );
  const attackResult = atk.attackResult;
  assert.ok(attackResult, "ataque produce AttackResult");
  assert.equal(
    attackResult.total,
    12,
    "os efeitos da lesão prévia continuam valendo, a nova soma junto e o ferimento também",
  );
});

/* ========================================================================== *
 * 7 — Pipeline completo
 * ========================================================================== */

test("pipeline: ataque → arma → localização → dano → Critical Injury", () => {
  const state = estado([atacante(), alvo(saude({ hp: [30, 40], deathSave: { dc: 0, failures: 0 } }))]);
  const rng = createTestRandomSource([9, 5, 5, 3, 4, 9]);

  // 1) ATAQUE (aimed head) — 7 + 6 + 9 − 8 = 14 > DV 10 → hit; 9 ≠ 10 → NÃO crítico.
  const atk = ok(execute(state, ataque({ weaponId: ARMA_ID, attackMode: "aimed", aimedTarget: "head" }), rng));
  const attackResult = atk.attackResult;
  assert.ok(attackResult, "ataque produce AttackResult");
  assert.equal(attackResult.hit, true, "14 > 10");
  assert.equal(attackResult.critical, false, "sem crítico de ataque — a lesão vem do limiar");

  // 2) LOCALIZAÇÃO — sai do ataque, 0 valores de rng.
  const loc = local(resolveHitLocation(attackResult));
  assert.equal(loc, "head");

  // 3) ARMA — 2d6 → 5 + 5 = 10 (F1.8D.2, 2 valores).
  const roll = totalDano(rollWeaponDamage(atk.state.participants[0], attackResult, rng));
  assert.equal(roll, 10);

  // 4) DANO — Head damage doubles after Armor e 2+ seis geram uma lesão.
  const d = ok(execute(atk.state, dano(ALVO_ID, roll, { actorId: ATACANTE_ID, hitLocation: loc, damageRolls: [6, 6, 3] }), rng));
  const dmg = danoOk(d);
  assert.equal(dmg.rawDamage, 10, "a rolagem da arma chega intacta");
  assert.equal(dmg.hitLocation, "head");
  assert.equal(dmg.hpAfter, 5, "30 − (10 × 2) − 5");

  // 5) CRITICAL INJURY — 2 valores, roll 7 → a lesão que o pipeline expôs.
  const inj = lesao(dmg);
  assert.equal(inj.injury.name, "Foreign Object");
  assert.deepEqual(d.state.participants[1].combat.criticalInjuries, [inj.injury]);
  assert.equal(addedInjuries(d).length, 1);

  assert.equal(
    rng.d10(),
    9,
    "5 valores no total: ataque 1 + arma 2 + lesão 2 (localização: 0)",
  );
});

/* ========================================================================== *
 * 8 — Pureza (AST: comentário não conta)
 * ========================================================================== */

const ARQUIVOS_PUREZA = ["src/lib/combat/engine.ts", "src/lib/combat/contract.ts", "src/data/criticalInjuries.ts"];

/** Identificadores de ambiente que regra nenhuma pode tocar. */
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

const IMPORTS_PROIBIDOS = [/^react/, /^next/, /^client-only$/, /supabase/, /gmStorage/];

test("pureza: motor, contrato e módulo de lesão sem DOM, rede, gmStorage ou Math.random", () => {
  for (const rel of ARQUIVOS_PUREZA) {
    const file = new URL(`../${rel}`, import.meta.url);
    const source = readFileSync(file, "utf8");
    const ast = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    const identificadores: string[] = [];
    let mathRandom = 0;
    const imports: string[] = [];

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
        imports.push(node.moduleSpecifier.getText(ast).replace(/^["']|["']$/g, ""));
      }
      node.forEachChild(visit);
    };
    ast.forEachChild(visit);

    assert.deepEqual(identificadores, [], `${rel} não pode citar ambiente client/persistência`);
    assert.equal(mathRandom, 0, `${rel} não pode chamar Math.random (o rng é o RandomSource)`);
    assert.deepEqual(
      imports.filter((spec) => IMPORTS_PROIBIDOS.some((padrao) => padrao.test(spec))),
      [],
      `${rel} não pode importar UI/persistência/rede`,
    );
  }
});

/* ========================================================================== *
 * 9 — Quem não rastreia lesões
 * ========================================================================== */

test("encontro: limiar atravessado sem rastreio → damageResult sem criticalInjury", () => {
  const state = estadoComLimiar(false);
  const rng = createTestRandomSource([3, 4, 9]);

  const result = execute(state, dano(ALVO_ID, 20), rng);
  const dmg = danoOk(result);

  // O limiar FOI atravessado (30 → 10) — mas este contexto não modela lesões.
  assert.equal(dmg.hpAfter, 10);
  assert.equal(dmg.criticalInjury, undefined, "ausente = nenhuma lesão GERADA, pelo motivo que for");
  assert.deepEqual(result.rolls, [], "sem rastreio não há 2d6");
  assert.equal(addedInjuries(result).length, 0);
  assert.equal(rng.d10(), 3, "nenhum valor consumido: nada foi rolado");
});
