/**
 * F1.14.2 — **Player Initiative Gateway**: camada da FICHA (sem React, sem rede).
 *
 * Os cenários pedidos pela task que dá para provar sem renderizar a ficha:
 *
 *  8.  modo `mesa-combat` → rolagem local + POST da intenção + refresh e
 *                          NENHUMA `update()` em `character`;
 *  9.  falha do servidor → erro claro, sem `update()` e sem `refresh()`
 *                          (estado local anterior preservado);
 *  10. fora de `mesa-combat` → fluxo local EXATO de sempre (`update()` chamado,
 *                          sem rede, com o resultado local exibido);
 *  11. combatante ausente → recusa clara, sem POST;
 *      + anti-spam: clique durante um POST em voo é ignorado (um POST só);
 *      + a trava de ocupação é liberada e o indicador limpo no `finally`;
 *      + o valor enviado é o TOTAL rolado e o `actorCombatantId` é o do
 *        participante (nunca o de outro combatente);
 *      + `syncMesaCharacterState` leva `combatant.initiative` à ficha.
 *
 * O gateway em si (validações, idempotência, CAS, eventos) está em
 * `tests/mesa-player-initiative-gateway.test.ts`, contra Postgres real.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { MesaApiError } from "../src/lib/mesa/client.ts";
import { syncMesaCharacterState } from "../src/lib/mesa/characterSync.ts";
import { rollInitiative, type InitiativeRollResult } from "../src/lib/initiative.ts";
import {
  initiativeErrorMessage,
  performInitiativeRoll,
  type InitiativeFlowDeps,
  type InitiativeNotice,
  type MesaInitiativeContext,
} from "../src/lib/mesa/sheetAuthority.ts";
import type { MesaCombatant, MesaState, PlayerInitiativeOutcome } from "../src/lib/mesa/types.ts";
import { createEmptyCharacter, type Character } from "../src/types/character.ts";

const COMBATANT_ID = "combatant-do-jogador";

type InitiativeResult = PlayerInitiativeOutcome & { committed: boolean };

interface Calls {
  local: number;
  localResults: InitiativeRollResult[];
  updates: Character[];
  rolls: Array<number | null>;
  results: InitiativeRollResult[];
  notices: InitiativeNotice[];
  registers: Array<{ actorCombatantId: string; initiative: number }>;
  refreshes: number;
  busy: boolean[];
}

/**
 * Harness com contexto de Mesa (registra tudo que a ficha faria) — `mesa` fica
 * `undefined` quando o teste pede o fluxo local.
 */
function harness(options: { mesa?: boolean; overrides?: Partial<MesaInitiativeContext> } = {}): {
  deps: InitiativeFlowDeps;
  calls: Calls;
} {
  const calls: Calls = {
    local: 0,
    localResults: [],
    updates: [],
    rolls: [],
    results: [],
    notices: [],
    registers: [],
    refreshes: 0,
    busy: [],
  };
  const base = createEmptyCharacter("char-init");
  base.stats.REF = 5;

  let busy = false;
  const context: MesaInitiativeContext = {
    isBusy: () => busy,
    setBusy: (value) => {
      busy = value;
      calls.busy.push(value);
    },
    combatantId: COMBATANT_ID,
    register: async (input): Promise<InitiativeResult> => {
      calls.registers.push(input);
      return {
        kind: "initiative",
        resolutionId: "resolution-1",
        combatantId: input.actorCombatantId,
        initiative: input.initiative,
        initiativeDetail: { total: input.initiative, refBonus: base.stats.REF },
        registered: true,
        committed: true,
      };
    },
    refresh: async () => {
      calls.refreshes += 1;
    },
    ...options.overrides,
  };

  const deps: InitiativeFlowDeps = {
    mesa: options.mesa === false ? undefined : context,
    local: () => {
      calls.local += 1;
      const outcome = rollInitiative(base);
      calls.localResults.push(outcome.result);
      return { result: outcome.result, character: outcome.character };
    },
    update: (character) => void calls.updates.push(character),
    showRoll: (value) => void calls.rolls.push(value),
    showResult: (result) => void calls.results.push(result),
    notify: (notice) => void calls.notices.push(notice),
  };
  return { deps, calls };
}

/* ------------------------- 10. fluxo local de sempre ---------------------- */

test("fora de mesa-combat: rolagem local exata, sem rede", async () => {
  const { deps, calls } = harness({ mesa: false });
  const notice = await performInitiativeRoll(deps);

  assert.equal(notice, null, "fluxo local não gera aviso");
  assert.equal(calls.local, 1);
  assert.equal(calls.updates.length, 1, "onUpdate continua sendo chamado no modo local");
  assert.equal(calls.rolls.length, 1);
  assert.equal(typeof calls.rolls[0], "number");
  assert.ok((calls.rolls[0] as number) >= 1 && (calls.rolls[0] as number) <= 10, "indica o d10 rolado");
  assert.equal(calls.results.length, 1, "o resultado local é exibido (lastInitiative)");
  assert.equal(calls.results[0], calls.localResults[0], "mostra a MESMA rolagem");
  assert.equal(calls.notices.length, 0, "nada de aviso de Mesa no modo local");
  assert.equal(calls.registers.length, 0, "nenhuma chamada de rede");
  assert.equal(calls.busy.length, 0, "sem trava de Mesa");
});

/* ---------------------------- 8. modo Mesa ------------------------------- */

test("mesa-combat: POST da intenção + refresh, e NENHUMA update()", async () => {
  const { deps, calls } = harness();
  const notice = await performInitiativeRoll(deps);

  assert.equal(calls.updates.length, 0, "a ficha NÃO escreve em character durante mesa-combat");
  assert.equal(calls.registers.length, 1, "um único POST");
  assert.equal(calls.registers[0].actorCombatantId, COMBATANT_ID, "registra o PRÓPRIO combatante");
  assert.equal(
    calls.registers[0].initiative,
    calls.localResults[0].total,
    "envia o TOTAL rolado (1d10 + REF + mods)",
  );
  assert.equal(calls.refreshes, 1, "espera o servidor e depois puxa o estado da Mesa");
  assert.equal(notice?.isError, false, "sucesso limpa o erro anterior");
  assert.equal(calls.results.length, 0, "o valor exibido vem do estado da Mesa, não da rolagem local");
  assert.equal(calls.rolls[0], calls.localResults[0].diceRoll, "indica a rolagem durante o envio");
  assert.equal(calls.rolls[calls.rolls.length - 1], null, "indicador limpo ao terminar");
  assert.deepEqual(calls.busy, [true, false], "trava abriu e fechou no finally");
});

/* ---------------------------- 9. falha do servidor ------------------------ */

test("mesa-combat: falha no POST → erro claro, sem update e sem refresh", async () => {
  const { deps, calls } = harness({
    overrides: {
      register: async () => {
        throw new MesaApiError("Sua iniciativa já foi registrada nesta luta.", 409, "initiative_already_registered");
      },
    },
  });

  const notice = await performInitiativeRoll(deps);

  assert.equal(notice?.isError, true);
  assert.equal(notice?.text, "Sua iniciativa já foi registrada nesta luta.");
  assert.equal(calls.updates.length, 0, "estado local anterior permanece intacto");
  assert.equal(calls.refreshes, 0, "não puxa estado depois de uma falha");
  assert.equal(calls.results.length, 0, "nada de resultado local no modo Mesa");
  assert.deepEqual(calls.busy, [true, false], "a trava não fica presa depois do erro");
  assert.equal(calls.rolls[calls.rolls.length - 1], null, "o botão não fica em 'Enviando...' para sempre");
});

test("erro de rede/genérico não vaza mensagem em inglês", () => {
  const generic = initiativeErrorMessage(new TypeError("fetch failed"));
  assert.match(generic, /iniciativa/i);
  assert.ok(!/failed/i.test(generic), `não pode vazar erro de rede: ${generic}`);

  const known = initiativeErrorMessage(new MesaApiError("Nenhum combate ativo.", 409, "combat_not_active"));
  assert.equal(known, "Nenhum combate ativo.");
});

/* ------------------------------- 11. sem combatente ----------------------- */

test("mesa-combat sem combatente vinculado → recusa clara e nenhum POST", async () => {
  const { deps, calls } = harness({ overrides: { combatantId: null } });

  const notice = await performInitiativeRoll(deps);

  assert.equal(notice?.isError, true);
  assert.match(notice?.text ?? "", /não vinculado/i);
  assert.equal(calls.local, 0, "nem gasta rolagem");
  assert.equal(calls.registers.length, 0);
  assert.equal(calls.updates.length, 0);
  assert.equal(calls.busy.length, 0, "não abre uma trava que não usou");
});

/* ------------------------------- anti-spam ------------------------------- */

test("clique durante um POST em voo é ignorado (um POST só)", async () => {
  let release: () => void = () => undefined;
  const { deps, calls } = harness({
    overrides: {
      register: async (input) => {
        calls.registers.push(input);
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return {
          kind: "initiative",
          resolutionId: "resolution-1",
          combatantId: input.actorCombatantId,
          initiative: input.initiative,
          initiativeDetail: { total: input.initiative },
          registered: true,
          committed: true,
        };
      },
    },
  });

  const first = performInitiativeRoll(deps);
  // Segundo clique no MESMO instante: a trava já está fechada.
  const second = await performInitiativeRoll(deps);
  assert.equal(second, null, "segundo clique devolvido como ignorado");
  assert.equal(calls.registers.length, 1, "só um POST em voo");
  assert.equal(calls.local, 1, "o segundo clique nem rola dado");

  release();
  const notice = await first;
  assert.equal(calls.registers.length, 1, "o retry não virou um segundo POST");
  assert.equal(notice?.isError, false);
  assert.equal(calls.updates.length, 0);
  assert.deepEqual(calls.busy, [true, false], "a trava abre uma vez e fecha no finally");
});

/* --------------------------- projeção na ficha --------------------------- */

test("syncMesaCharacterState leva a iniciativa da Mesa para a ficha", () => {
  const character = createEmptyCharacter("char-sync");
  assert.equal(character.combat.initiative, undefined, "ficha local não tem iniciativa própria");

  const combatant: MesaCombatant = {
    id: COMBATANT_ID,
    combatId: "combat-1",
    sessionId: "session-1",
    kind: "character",
    characterId: character.id,
    participantId: "participant-1",
    name: "V",
    sourceKey: null,
    supplies: null,
    armor: null,
    criticalInjuries: [],
    ammoByWeapon: null,
    initiative: 17,
    initiativeDetail: { total: 17, refBonus: 5 },
    actionsMax: 2,
    actionsRemaining: 2,
    movementMax: 10,
    movementRemaining: 10,
    hpCurrent: character.combat.hp.current,
    hpMax: character.combat.hp.max,
    isDead: false,
    conditions: [],
    sortOrder: 0,
  };

  const state = {
    session: { id: "session-1", status: "active" },
    viewer: { role: "player", participantId: "participant-1" },
    combat: { id: "combat-1", status: "active" },
    combatants: [combatant],
  } as unknown as MesaState;

  const synced = syncMesaCharacterState(character, state);
  assert.equal(synced.combat.initiative, 17, "Mesa 17 → ficha 17");
  assert.notEqual(synced, character, "houve mudança, então um objeto novo");

  const again = syncMesaCharacterState(synced, state);
  assert.equal(again, synced, "mesmo valor → identidade preservada (não re-renderiza à toa)");
});
