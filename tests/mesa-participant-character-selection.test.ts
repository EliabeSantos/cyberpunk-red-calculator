import assert from "node:assert/strict";
import test from "node:test";

import { resolveAction } from "../src/lib/combatEngine.ts";
import {
  authorizeCombatAttackActor,
  MesaError,
  selectParticipantCharacter,
  type Actor,
} from "../src/lib/mesa/store.ts";

/**
 * Regressão documentada em `docs/f1-66-3-persistence-contracts.md`: a seleção
 * do ator de um participante usava `rows.find(...)` sobre um SELECT sem ORDER
 * BY, então com DUAS linhas `character` para a mesma participação a escolha
 * dependia da ordem física do Postgres e podia devolver o combatente errado
 * (`403 not_your_turn` em reload legítimo).
 */

interface Row {
  id: string;
  kind: string;
  participant_id: string | null;
  character_id?: string | null;
  sort_order?: number;
}

function row(id: string, overrides: Partial<Row> = {}): Row {
  return {
    id,
    kind: "character",
    participant_id: "participant-a",
    character_id: null,
    sort_order: 0,
    ...overrides,
  };
}

const participant = { id: "participant-a", characterId: null as string | null };

test("com turno ativo, o combatente do próprio participante vence qualquer ordem de leitura", () => {
  const mine = [row("char-1", { sort_order: 0 }), row("char-2", { sort_order: 1 })];

  for (const order of [mine, [...mine].reverse()]) {
    assert.equal(selectParticipantCharacter(order, participant, "char-2")?.id, "char-2");
    assert.equal(selectParticipantCharacter(order, participant, "char-1")?.id, "char-1");
  }
});

test("sem turno, a ordem canônica da Mesa desempata de forma estável", () => {
  const mine = [row("char-b", { sort_order: 5 }), row("char-a", { sort_order: 3 })];

  for (const order of [mine, [...mine].reverse()]) {
    assert.equal(selectParticipantCharacter(order, participant, null)?.id, "char-a");
  }

  const empatadas = [row("zz", { sort_order: 1 }), row("aa", { sort_order: 1 })];
  for (const order of [empatadas, [...empatadas].reverse()]) {
    assert.equal(selectParticipantCharacter(order, participant, null)?.id, "aa");
  }
});

test("personagem vinculado à participação desempata quando não há turno ativo", () => {
  const vinculado = { id: "participant-a", characterId: "ficha-2" };
  const linhas = [
    row("char-1", { sort_order: 0, character_id: "ficha-1" }),
    row("char-2", { sort_order: 1, character_id: "ficha-2" }),
  ];

  for (const order of [linhas, [...linhas].reverse()]) {
    assert.equal(selectParticipantCharacter(order, vinculado, null)?.id, "char-2");
  }
});

test("turno ativo de OUTRO participante não captura o ator", () => {
  const linhas = [
    row("char-1", { sort_order: 0 }),
    row("char-2", { sort_order: 1 }),
    row("char-do-outro", { participant_id: "participant-b", sort_order: 0 }),
  ];

  // O turno é do outro jogador: o ator selecionado continua sendo o do
  // participante autenticado — a negação de turno é decidida depois, pela regra.
  assert.equal(
    selectParticipantCharacter(linhas, participant, "char-do-outro")?.id,
    "char-1",
  );
});

test("nunca devolve linha de outro kind, de outro participante ou sem vínculo", () => {
  const linhas: Row[] = [
    row("inimigo-1", { kind: "enemy" }),
    row("ice-1", { kind: "net_ice" }),
    row("outro-1", { participant_id: "participant-b" }),
    row("sem-vinculo", { participant_id: null }),
  ];

  assert.equal(selectParticipantCharacter(linhas, participant, null), null);
  assert.equal(selectParticipantCharacter([], participant, null), null);
});

test("seleção não contorna a autorização de ownership", () => {
  const actor: Actor = {
    session: {
      id: "session-a",
      name: "Mesa",
      gmId: "gm-1",
      status: "active",
      joinCode: "ABCDE",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    participant: {
      id: "participant-a",
      sessionId: "session-a",
      displayName: "Player A",
      characterId: null,
      role: "player",
      connectedAt: "2026-01-01T00:00:00.000Z",
    },
  };

  const linhas = [
    row("char-1", { sort_order: 0 }),
    row("char-2", { sort_order: 1, participant_id: "participant-b" }),
  ];
  const selecionado = selectParticipantCharacter(linhas, actor.participant, null);
  assert.equal(selecionado?.id, "char-1");
  assert.doesNotThrow(() => authorizeCombatAttackActor(actor, {
    session_id: "session-a",
    participant_id: "participant-a",
  }));

  assert.throws(
    () => authorizeCombatAttackActor(actor, {
      session_id: "session-a",
      participant_id: "participant-b",
    }),
    (error: unknown) =>
      error instanceof MesaError && error.status === 403 && error.code === "combatant_not_owned",
  );

  assert.throws(
    () => authorizeCombatAttackActor(actor, {
      session_id: "session-b",
      participant_id: "participant-a",
    }),
    (error: unknown) =>
      error instanceof MesaError && error.status === 404 && error.code === "combatant_not_found",
  );
});

test("rejeição de turno continua valendo para o ator selecionado", () => {
  const base = {
    combatStatus: "active" as const,
    initiativeStarted: true,
    actorRole: "player" as const,
    actorOwnsCombatant: true,
    actionType: "reload",
  };
  const view = {
    actionsMax: 2,
    actionsRemaining: 1,
    movementMax: 6,
    movementRemaining: 6,
    isDead: false,
  };

  const linhas = [row("char-1", { sort_order: 0 }), row("char-2", { sort_order: 1 })];
  const emTurno = selectParticipantCharacter(linhas, participant, "char-2");
  assert.ok(emTurno);
  assert.deepEqual(
    resolveAction({ ...base, activeCombatantId: "char-2", combatant: { id: emTurno.id, ...view } }),
    { ok: true, cost: 1 },
  );

  const foraDeTurno = selectParticipantCharacter(linhas, participant, "char-de-outro-participante");
  assert.equal(foraDeTurno?.id, "char-1");
  assert.deepEqual(
    resolveAction({ ...base, activeCombatantId: "char-de-outro-participante", combatant: { id: foraDeTurno.id, ...view } }),
    { ok: false, reason: "not_your_turn" },
  );
});
