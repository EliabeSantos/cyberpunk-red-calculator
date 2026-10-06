import assert from "node:assert/strict";
import test from "node:test";

import { evaluateMesaAction } from "../src/lib/mesa/actionGate.ts";
import {
  attackTargets,
  deriveTurnStatus,
  hpCondition,
  myCombatant,
  rosterInInitiativeOrder,
} from "../src/lib/mesa/playerScreen.ts";
import type { MesaCombat, MesaCombatant, MesaState } from "../src/lib/mesa/types.ts";

// ---------------------------------------------------------------------------
// Fixtures — só o que a tela do Player lê. Nada aqui simula servidor.
// ---------------------------------------------------------------------------

function combatant(patch: Partial<MesaCombatant> & { id: string }): MesaCombatant {
  return {
    combatId: "combat-1",
    sessionId: "session-1",
    kind: "character",
    characterId: null,
    participantId: "participant-1",
    name: "Solo",
    sourceKey: null,
    supplies: null,
    armor: null,
    criticalInjuries: [],
    ammoByWeapon: null,
    initiative: 10,
    initiativeDetail: null,
    actionsMax: 2,
    actionsRemaining: 2,
    movementMax: 10,
    movementRemaining: 10,
    hpCurrent: 30,
    hpMax: 40,
    isDead: false,
    conditions: [],
    sortOrder: 0,
    ...patch,
  };
}

function activeCombat(activeCombatantId: string | null, round = 1): MesaCombat {
  return {
    id: "combat-1",
    sessionId: "session-1",
    status: "active",
    round,
    activeCombatantId,
    turnStartedAt: "2026-10-05T00:00:00.000Z",
    initiativeStarted: true,
    eventLog: [],
    createdAt: "2026-10-05T00:00:00.000Z",
  };
}

function state(patch: Partial<MesaState>): MesaState {
  return {
    session: {
      id: "session-1",
      name: "Noite Neon",
      gmId: "gm-1",
      status: "active",
      joinCode: "8F4K2",
      createdAt: "2026-10-05T00:00:00.000Z",
    },
    viewer: { participantId: "participant-1", role: "player", displayName: "Piloto" },
    participants: [
      {
        id: "participant-1",
        sessionId: "session-1",
        displayName: "Piloto",
        characterId: null,
        role: "player",
        connectedAt: "2026-10-05T00:00:00.000Z",
      },
    ],
    combatants: [],
    combat: null,
    ...patch,
  } as MesaState;
}

const me = combatant({ id: "c-me", name: "V", initiative: 14 });
const ally = combatant({ id: "c-ally", participantId: "participant-2", name: "Médico", initiative: 7 });
const enemy = combatant({
  id: "c-enemy",
  kind: "enemy",
  participantId: null,
  name: "Trauma Goon",
  initiative: 21,
});

// ---------------------------------------------------------------------------
// 1. Ordem de iniciativa reutiliza a MESMA regra do Combat Engine.
// ---------------------------------------------------------------------------

test("elenco é ordenado pela iniciativa do Combat Engine (maior primeiro)", () => {
  const ordered = rosterInInitiativeOrder(state({ combatants: [me, enemy, ally] }));
  assert.deepEqual(
    ordered.map((combatant) => combatant.id),
    ["c-enemy", "c-me", "c-ally"],
  );
});

test("combatente sem iniciativa cai para o fim sem reordenar quem já tem valor", () => {
  const noInitiative = combatant({ id: "c-late", initiative: null });
  const ordered = rosterInInitiativeOrder(state({ combatants: [me, noInitiative, enemy] }));
  assert.deepEqual(
    ordered.map((combatant) => combatant.id),
    ["c-enemy", "c-me", "c-late"],
  );
});

// ---------------------------------------------------------------------------
// 2. Derivação de "é meu turno?" — puro, sem regra nova.
// ---------------------------------------------------------------------------

test("combate parado mostra aguardando, nunca 'seu turno'", () => {
  const status = deriveTurnStatus(state({ combatants: [me], combat: null }), me);
  assert.equal(status.kind, "combat_idle");
  assert.equal(status.myTurn, false);
});

test("sessão encerrada tem precedência sobre qualquer turno", () => {
  const finished = state({
    combatants: [me],
    combat: activeCombat("c-me", 3),
    session: { ...state({}).session, status: "finished" },
  });
  const status = deriveTurnStatus(finished, me);
  assert.equal(status.kind, "session_finished");
  assert.equal(status.myTurn, false);
});

test("minha vez: ações esgotadas viram 'SEM ACTIONS RESTANTES' sem perder o turno", () => {
  const empty = combatant({ ...me, id: "c-me", actionsRemaining: 0 });
  const status = deriveTurnStatus(
    state({
      combatants: [empty],
      combat: activeCombat("c-me", 2),
    }),
    empty,
  );
  assert.equal(status.kind, "your_turn_no_actions");
  assert.equal(status.myTurn, true);
});

test("turno de outro combatente diz quem está agindo", () => {
  const status = deriveTurnStatus(
    state({
      combatants: [me, enemy],
      combat: activeCombat("c-enemy", 1),
    }),
    me,
  );
  assert.equal(status.kind, "waiting");
  assert.equal(status.myTurn, false);
  assert.match(status.detail, /Trauma Goon/);
});

test("personagem derrotado é anunciado antes de qualquer turno", () => {
  const dead = combatant({ ...me, id: "c-me", isDead: true, hpCurrent: 0 });
  const status = deriveTurnStatus(
    state({
      combatants: [dead],
      combat: activeCombat("c-me", 4),
    }),
    dead,
  );
  assert.equal(status.kind, "defeated");
  assert.equal(status.myTurn, false);
});

test("sem ficha vinculada a tela pede vínculo em vez de fingir turno", () => {
  const status = deriveTurnStatus(
    state({
      combatants: [enemy],
      combat: activeCombat("c-enemy", 1),
    }),
    null,
  );
  assert.equal(status.kind, "waiting");
  assert.match(status.detail, /Vincule uma ficha/);
});

// ---------------------------------------------------------------------------
// 3. Identidade do jogador e alvos — só inimigos vivos são selecionáveis.
// ---------------------------------------------------------------------------

test("myCombatant só devolve characters do participant deste navegador", () => {
  const snapshot = state({ combatants: [combatant({ id: "c-other", participantId: "participant-9" }), enemy] });
  assert.equal(myCombatant(snapshot), null, "aliado de outro jogador não é meu");
  assert.equal(myCombatant(state({ combatants: [me, enemy] }))?.id, "c-me");
});

test("alvos de ataque excluem aliados e inimigos derrotados", () => {
  const deadEnemy = combatant({ id: "c-dead", kind: "enemy", participantId: null, isDead: true });
  const targets = attackTargets(state({ combatants: [me, ally, enemy, deadEnemy] }));
  assert.deepEqual(
    targets.map((target) => target.id),
    ["c-enemy"],
  );
});

// ---------------------------------------------------------------------------
// 4. evaluateMesaAction — mesma autorização do servidor, para DESABILITAR UI.
// ---------------------------------------------------------------------------

test("ação no turno certo é liberada; fora de turno devolve o texto de recusa", () => {
  const snapshot = state({
    combatants: [me, enemy],
    combat: activeCombat("c-enemy", 1),
  });
  const offTurn = evaluateMesaAction({ state: snapshot, combatant: me, actionType: "attack" });
  assert.equal(offTurn.ok, false);
  assert.equal(offTurn.reason, "not_your_turn");
  assert.ok(offTurn.message.length > 0, "a UI precisa de texto pronto para o hint");

  const onTurn = evaluateMesaAction({
    state: state({
      combatants: [me, enemy],
      combat: activeCombat("c-me", 1),
    }),
    combatant: me,
    actionType: "attack",
  });
  assert.equal(onTurn.ok, true);
  assert.equal(onTurn.message, "");
});

test("sem Actions restantes a recusa é de economia, não de turno", () => {
  const empty = combatant({ ...me, id: "c-me", actionsRemaining: 0 });
  const snapshot = state({
    combatants: [empty],
    combat: activeCombat("c-me", 1),
  });
  const gate = evaluateMesaAction({ state: snapshot, combatant: empty, actionType: "item" });
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, "insufficient_actions");
});

test("mover valida os metros contra o orçamento de movimento", () => {
  const snapshot = state({
    combatants: [me],
    combat: activeCombat("c-me", 1),
  });
  assert.equal(evaluateMesaAction({ state: snapshot, combatant: me, actionType: "move", meters: 4 }).ok, true);
  assert.equal(evaluateMesaAction({ state: snapshot, combatant: me, actionType: "move", meters: 99 }).ok, false);
  assert.equal(evaluateMesaAction({ state: snapshot, combatant: me, actionType: "move", meters: 0 }).ok, false);
});

test("sem combate ativo nenhuma ação é liberada (a rota do servidor recusa igual)", () => {
  const gate = evaluateMesaAction({ state: state({ combatants: [me] }), combatant: me, actionType: "attack" });
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, "combat_not_started");
});

// ---------------------------------------------------------------------------
// 5. Faixa de HP — apresentação pura, sem tocar em regra de morte/cura.
// ---------------------------------------------------------------------------

test("faixa de HP reage só à proporção e a isDead, sem decidir morte", () => {
  assert.equal(hpCondition(combatant({ id: "c1", hpCurrent: 40, hpMax: 40 })), "ok");
  assert.equal(hpCondition(combatant({ id: "c2", hpCurrent: 20, hpMax: 40 })), "wounded");
  assert.equal(hpCondition(combatant({ id: "c3", hpCurrent: 8, hpMax: 40 })), "critical");
  assert.equal(
    hpCondition(combatant({ id: "c4", hpCurrent: -5, hpMax: 40, isDead: false })),
    "critical",
    "HP ≤ 0 (Mortal Wound) é grave, mas NÃO é morte",
  );
  assert.equal(hpCondition(combatant({ id: "c5", hpCurrent: 40, hpMax: 40, isDead: true })), "dead");
  assert.equal(hpCondition(null), "ok");
});
