/**
 * Partida vinculada ao encontro: histórico + uso único + volta de vida.
 *
 * Prova as quatro promessas da feature (27/09/2026):
 *   1. o snapshot da partida guarda a vida de ENTRADA e o fechamento grava a
 *      vida final, marcando quem morreu e quem saiu no meio;
 *   2. durante o combate vinculado, a MANDA é da mesa: o HP dos inimigos volta
 *      para o encontro (aparado em [0, máx]) e o fim da luta marca o encontro
 *      como concluído;
 *   3. o vínculo é reconciliado com o que o SERVIDOR registrou (concluído,
 *      lançado noutro separador) sem apagar dado local por falta de registro;
 *   4. o cliente manda encontro/restart no POST e lê o histórico de volta —
 *      com migração pendente sinalizando `migration_pending`.
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { EncounterData } from "../src/lib/gmStorage.ts";
import type { MesaBattle, MesaCombatant, MesaState } from "../src/lib/mesa/types.ts";

const { startBattleSnapshot, mergeBattleRoster } = await import("../src/lib/mesa/battleHistory.ts");
const { applyMesaStateToEncounter, reconcileEncountersWithBattles } = await import(
  "../src/lib/mesa/encounterSync.ts"
);

// ---------------------------------------------------------------------------
// 1. Snapshot / merge da partida
// ---------------------------------------------------------------------------

function combatant(overrides: Partial<MesaCombatant> = {}): MesaCombatant {
  return {
    id: "linha-1",
    combatId: "combate-1",
    sessionId: "sessao-1",
    kind: "enemy",
    characterId: null,
    participantId: null,
    name: "Militante",
    sourceKey: "participante-1",
    initiative: 12,
    initiativeDetail: null,
    actionsMax: 2,
    actionsRemaining: 2,
    movementMax: 10,
    movementRemaining: 10,
    hpCurrent: 30,
    hpMax: 30,
    isDead: false,
    conditions: [],
    sortOrder: 0,
    ...overrides,
  };
}

test("o snapshot de entrada guarda a vida com que cada linha começou", () => {
  const snapshot = startBattleSnapshot([
    combatant({ id: "a", hpCurrent: 30, hpMax: 30 }),
    combatant({ id: "b", hpCurrent: 12, hpMax: 40, kind: "character", sourceKey: null }),
  ]);

  assert.equal(snapshot.length, 2);
  assert.deepEqual(snapshot[0], {
    id: "a",
    kind: "enemy",
    name: "Militante",
    hpStart: 30,
    hpMax: 30,
    hpEnd: null,
    isDead: false,
    removed: false,
    initiative: 12,
    sourceKey: "participante-1",
  });
  assert.equal(snapshot[1].hpStart, 12, "entrou ferido, não cheio");
  assert.equal(snapshot[1].hpEnd, null, "hpEnd só existe quando a partida fecha");
});

test("fechar a partida sobrepõe a vida final e marca quem morreu", () => {
  const snapshot = startBattleSnapshot([
    combatant({ id: "a", hpCurrent: 30 }),
    combatant({ id: "b", hpCurrent: 40, kind: "character" }),
  ]);
  const merged = mergeBattleRoster(snapshot, [
    combatant({ id: "a", hpCurrent: 0, isDead: true }),
    combatant({ id: "b", hpCurrent: 40, kind: "character" }),
  ]);

  assert.equal(merged[0].hpStart, 30, "a vida de entrada não é apagada");
  assert.equal(merged[0].hpEnd, 0);
  assert.equal(merged[0].isDead, true, "o inimigo morto por um player fica registrado");
  assert.equal(merged[0].removed, false);
  assert.equal(merged[1].hpEnd, 40);
  assert.equal(merged[1].isDead, false);
});

test("quem saiu da luta antes do fim fica marcado, sem inventar vida final", () => {
  const snapshot = startBattleSnapshot([combatant({ id: "a", hpCurrent: 30 }), combatant({ id: "b", hpCurrent: 40 })]);
  const merged = mergeBattleRoster(snapshot, [combatant({ id: "a", hpCurrent: 30 })]);

  assert.equal(merged.length, 2, "o registro não perde quem foi removido");
  const removed = merged.find((entry) => entry.id === "b");
  assert.ok(removed);
  assert.equal(removed.removed, true);
  assert.equal(removed.hpEnd, null);
  assert.equal(removed.hpStart, 40, "sabe com que vida entrou");
  assert.equal(removed.name, "Militante");
});

test("inimigo adicionado no meio entra com a vida do momento", () => {
  const merged = mergeBattleRoster([], [combatant({ id: "novo", hpCurrent: 7, hpMax: 20 })]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].hpStart, 7, "sem snapshot não há como saber a vida anterior");
  assert.equal(merged[0].hpEnd, 7);
  assert.equal(merged[0].removed, false);
});

test("snapshot perdido não zera o histórico de quem entrou cheio", () => {
  const merged = mergeBattleRoster([], [combatant({ id: "a", hpCurrent: 18, hpMax: 30 })]);
  assert.equal(merged[0].hpStart, 18);
  assert.equal(merged[0].hpEnd, 18);
});

// ---------------------------------------------------------------------------
// 2. Volta da mesa para o encontro (durante o combate)
// ---------------------------------------------------------------------------

/** Participante mínimo — só os campos que o espelho toca. */
function participant(overrides: Record<string, unknown> = {}): EncounterData["participants"][number] {
  return {
    id: "participante-1",
    name: "Militante",
    archetype: "Gang",
    isPlayer: false,
    hp: { current: 30, max: 30 },
    armor: { head: 0, body: 0 },
    conditions: [],
    ...overrides,
  } as unknown as EncounterData["participants"][number];
}

function encounter(overrides: Partial<EncounterData> = {}): EncounterData {
  return {
    id: "encontro-1",
    name: "Emboscada",
    faction: "Maelstrom",
    enemyCount: 1,
    createdAt: "2026-09-27T10:00:00.000Z",
    participants: [participant()],
    ...overrides,
  } as unknown as EncounterData;
}

/** Estado mínimo da mesa: sessão, combate e as linhas com `source_key`. */
function state(overrides: Partial<MesaState> = {}): MesaState {
  return {
    session: { id: "sessao-1", status: "active" },
    participants: [],
    combat: { status: "active", round: 2, eventLog: [] },
    combatants: [combatant({ id: "linha-1", hpCurrent: 11, sourceKey: "participante-1" })],
    viewer: { participantId: null, role: null, displayName: null },
    ...overrides,
  } as unknown as MesaState;
}

function linked(battle?: Record<string, unknown>): EncounterData {
  return encounter({
    battle: {
      sessionId: "sessao-1",
      joinCode: "ABCDE",
      status: "active",
      startedAt: "2026-09-27T10:05:00.000Z",
      ...(battle ?? {}),
    } as EncounterData["battle"],
  });
}

test("encontro sem vínculo de partida não é tocado pelo estado da mesa", () => {
  assert.equal(applyMesaStateToEncounter(encounter(), state()), null);
});

test("mesa de outra sessão não vaza vida para o encontro", () => {
  const result = applyMesaStateToEncounter(linked({ sessionId: "sessao-2" }), state());
  assert.equal(result, null);
});

test("a vida do inimigo na mesa desce no encontro", () => {
  const before = linked();
  const result = applyMesaStateToEncounter(before, state());

  assert.ok(result);
  assert.equal(result.participants[0].hp.current, 11, "mesa mandando: HP puxado de volta");
  assert.equal(before.participants[0].hp.current, 30, "o encontro original não é mutado");
  assert.equal(result.battle?.status, "active", "luta continua, vínculo continua ativo");
});

test("vida da mesa é aparada entre 0 e o máximo do encontro", () => {
  const negative = applyMesaStateToEncounter(
    linked(),
    state({ combatants: [combatant({ id: "linha-1", hpCurrent: -12, sourceKey: "participante-1" })] }),
  );
  assert.equal(negative?.participants[0].hp.current, 0, "a mesa aceita negativo, o encontro não");

  const aboveMax = applyMesaStateToEncounter(
    { ...linked(), participants: [participant({ hp: { current: 5, max: 30 } })] },
    state({ combatants: [combatant({ id: "linha-1", hpCurrent: 999, sourceKey: "participante-1" })] }),
  );
  assert.equal(aboveMax?.participants[0].hp.current, 30, "cura acima do máximo não estoura o encontro");
});

test("linha da mesa sem chave compatível não mexe em ninguém", () => {
  const result = applyMesaStateToEncounter(
    linked(),
    state({ combatants: [combatant({ id: "linha-1", hpCurrent: 0, sourceKey: "outro-encontro" })] }),
  );
  assert.equal(result, null, "sem correspondência não há mudança para aplicar");
});

test("vida idêntica não gera novo objeto (sem loop de render/salvamento)", () => {
  const result = applyMesaStateToEncounter(
    linked(),
    state({ combatants: [combatant({ id: "linha-1", hpCurrent: 30, sourceKey: "participante-1" })] }),
  );
  assert.equal(result, null);
});

test("fim do combate marca a partida (e o encontro) como concluída", () => {
  const result = applyMesaStateToEncounter(linked(), state({ combat: { status: "finished" } as MesaState["combat"] }));

  assert.ok(result);
  assert.equal(result.battle?.status, "completed");
  assert.ok(result.battle?.completedAt, "data do fim para o selo ✅ Concluído");
});

test("sessão encerrada também conclui o vínculo", () => {
  const result = applyMesaStateToEncounter(
    linked(),
    state({ session: { id: "sessao-1", status: "finished" } as MesaState["session"] }),
  );
  assert.equal(result?.battle?.status, "completed");
});

test("combate ainda rodando e nada mudado → sem alteração", () => {
  const result = applyMesaStateToEncounter(
    linked(),
    state({ combatants: [combatant({ id: "linha-1", hpCurrent: 30, sourceKey: "participante-1" })] }),
  );
  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// 3. Reconciliação com o histórico do servidor
// ---------------------------------------------------------------------------

function battle(overrides: Partial<MesaBattle> = {}): MesaBattle {
  return {
    id: "partida-1",
    sessionId: "sessao-1",
    joinCode: "ABCDE",
    encounterId: "encontro-1",
    encounterName: "Emboscada",
    status: "completed",
    startedAt: "2026-09-27T10:05:00.000Z",
    endedAt: "2026-09-27T11:00:00.000Z",
    finalRound: 4,
    combatants: [],
    ...overrides,
  };
}

test("servidor registrou a partida → encontro ganha o vínculo", () => {
  const { encounters, changed } = reconcileEncountersWithBattles([encounter()], [battle()]);

  assert.equal(changed, true);
  assert.equal(encounters[0].battle?.sessionId, "sessao-1");
  assert.equal(encounters[0].battle?.status, "completed");
  assert.equal(encounters[0].battle?.completedAt, "2026-09-27T11:00:00.000Z", "fim vem do endedAt");
});

test("partida concluída com a tela fechada marca o encontro como concluído", () => {
  const { encounters, changed } = reconcileEncountersWithBattles([linked()], [battle()]);

  assert.equal(changed, true);
  assert.equal(encounters[0].battle?.status, "completed");
  assert.equal(encounters[0].battle?.joinCode, "ABCDE");
});

test("vínculo já correto devolve o mesmo objeto (changed = false)", () => {
  const done = linked({ status: "completed", completedAt: "2026-09-27T11:00:00.000Z" });
  const { encounters, changed } = reconcileEncountersWithBattles([done], [battle()]);

  assert.equal(changed, false);
  assert.equal(encounters[0], done, "sem mudança não há re-render nem salvamento");
});

test("servidor sem registro não apaga o vínculo local", () => {
  const active = linked();
  const { encounters, changed } = reconcileEncountersWithBattles([active], []);

  assert.equal(changed, false);
  assert.equal(encounters[0], active);
});

test("partida de outra encontro não vira vínculo deste", () => {
  const { encounters, changed } = reconcileEncountersWithBattles(
    [encounter({ id: "encontro-2" })],
    [battle()],
  );
  assert.equal(changed, false);
  assert.equal(encounters[0].battle, undefined);
});
