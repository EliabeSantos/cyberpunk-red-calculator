/**
 * F1.13.4/F1.13.5 — ficha Mesa-aware.
 *
 * Cobre os doze casos pedidos pela task, na camada que dá para testar sem
 * renderizar React: a detecção do modo (`sheetMesaMode`), a leitura da mochila
 * da Mesa (`trackedSupplyIds`) e o roteamento do clique no item de cura
 * (`performHealingItemClick`). A seção final (F1.13.5) fixa que o bloqueio de
 * ataque da ficha (`playerAttackUnavailable`) é derivado de `sheetMesaMode()` e
 * não uma detecção paralela. O que a ficha faz com o resultado é exibir o
 * aviso — toda escrita de personagem continua sendo `onUpdate` (local) ou
 * `syncMesaCharacterState` (servidor).
 */
import assert from "node:assert/strict";
import test from "node:test";

import { catalogItems } from "../src/data/items.ts";
import { stableItemId } from "../src/data/supplyItems.ts";
import { applyHealingItem } from "../src/lib/healing.ts";
import { equipInventoryItem } from "../src/lib/inventory.ts";
import { getItemForFree, getSellPrice, purchaseItem, sellInventoryItem } from "../src/lib/store.ts";
import { syncMesaCharacterState } from "../src/lib/mesa/characterSync.ts";
import { MesaApiError, type MesaItemHealResult } from "../src/lib/mesa/client.ts";
import {
  healingButtonState,
  healingErrorMessage,
  linkedCombatant,
  localCombatMutationRefusal,
  localHpRefusal,
  performHealingItemClick,
  playerAttackUnavailable,
  sheetMesaMode,
  trackedSupplyIds,
  type HealingLocalOutcome,
  type HealingNotice,
  type MesaHealingContext,
  type PlayerHealingSetup,
} from "../src/lib/mesa/sheetAuthority.ts";
import type { MesaCombat, MesaCombatant, MesaState } from "../src/lib/mesa/types.ts";
import { createEmptyCharacter, type Character, type InventoryItem } from "../src/types/character.ts";

// ---------------------------------------------------------------------------
// Fixtures — só o que a ficha lê.
// ---------------------------------------------------------------------------

const CHARACTER_ID = "char-1";
const PARTICIPANT_ID = "participant-1";

function inventoryItem(patch: Partial<InventoryItem> & { id: string; name: string }): InventoryItem {
  return { quantity: 1, category: undefined, catalogItemId: undefined, notes: undefined, ...patch } as InventoryItem;
}

function sheetCharacter(): Character {
  const character = createEmptyCharacter(CHARACTER_ID);
  character.combat.hp = { current: 5, max: 40 };
  character.inventory = [
    inventoryItem({ id: "inv-stim", name: "Stim", quantity: 2, category: "healing", catalogItemId: "stim" }),
    inventoryItem({ id: "inv-agent", name: "Agent", quantity: 1, category: "electronics" }),
  ];
  return character;
}

function combatant(patch: Partial<MesaCombatant> & { id: string }): MesaCombatant {
  return {
    combatId: "combat-1",
    sessionId: "session-1",
    kind: "character",
    characterId: CHARACTER_ID,
    participantId: PARTICIPANT_ID,
    name: "V",
    sourceKey: null,
    supplies: null,
    armor: null,
    criticalInjuries: [],
    ammoByWeapon: null,
    initiative: 14,
    initiativeDetail: null,
    actionsMax: 2,
    actionsRemaining: 2,
    movementMax: 10,
    movementRemaining: 10,
    hpCurrent: 5,
    hpMax: 40,
    isDead: false,
    conditions: [],
    sortOrder: 0,
    ...patch,
  };
}

function activeCombat(patch: Partial<MesaCombat> = {}): MesaCombat {
  return {
    id: "combat-1",
    sessionId: "session-1",
    status: "active",
    round: 1,
    activeCombatantId: "c-me",
    turnStartedAt: "2026-10-05T00:00:00.000Z",
    initiativeStarted: true,
    eventLog: [],
    createdAt: "2026-10-05T00:00:00.000Z",
    ...patch,
  };
}

function state(patch: Partial<MesaState> = {}): MesaState {
  return {
    session: {
      id: "session-1",
      name: "Noite Neon",
      gmId: "gm-1",
      status: "active",
      joinCode: "8F4K2",
      createdAt: "2026-10-05T00:00:00.000Z",
    },
    viewer: { participantId: PARTICIPANT_ID, role: "player", displayName: "Piloto" },
    participants: [
      {
        id: PARTICIPANT_ID,
        sessionId: "session-1",
        displayName: "Piloto",
        characterId: CHARACTER_ID,
        role: "player",
        connectedAt: "2026-10-05T00:00:00.000Z",
      },
    ],
    combatants: [],
    combat: null,
    ...patch,
  } as MesaState;
}

/** Mesa em que ESTE personagem está dentro de um combate ativo. */
function combatState(patch: Partial<MesaState> = {}): MesaState {
  return state({ combat: activeCombat(), combatants: [combatant({ id: "c-me" })], ...patch });
}

function healResult(patch: Partial<MesaItemHealResult> = {}): MesaItemHealResult {
  return {
    combatantId: "c-me",
    itemId: "stim",
    itemName: "Stim",
    quantityBefore: 2,
    quantityAfter: 1,
    hpBefore: 5,
    hpAfter: 10,
    hpMax: 40,
    restored: 5,
    actionsBefore: 2,
    actionsAfter: 1,
    committed: true,
    ...patch,
  };
}

/**
 * Espelho do que a `CharacterSheet` faz: mesma ordem de sempre (aviso →
 * `update`) e o MESMO registro do que foi chamado, para o teste enxergar se
 * alguma mutação local aconteceu.
 */
function clickFlow(mesa?: MesaHealingContext) {
  const character = sheetCharacter();
  const calls = {
    local: 0,
    server: [] as string[],
    updates: [] as Character[],
    notices: [] as HealingNotice[],
    busy: [] as boolean[],
  };
  const flow = performHealingItemClick({
    itemId: stableItemId("Stim"),
    mesa,
    local: (): HealingLocalOutcome => {
      calls.local += 1;
      const result = applyHealingItem(character, "inv-stim");
      if ("error" in result) return { error: result.error };
      return { text: `${result.itemName} usado.`, character: result.character };
    },
    update: (next) => void calls.updates.push(next),
    notify: (notice) => void calls.notices.push(notice),
  });
  return { flow, calls, character };
}

/** Contexto de Mesa com um `useItem` fake, exposto para o teste controlar. */
function mesaContext(useItem: (itemId: string) => Promise<MesaItemHealResult>): MesaHealingContext & { busy: boolean } {
  const ctx = {
    busy: false,
    isBusy: () => ctx.busy,
    setBusy: (value: boolean) => {
      ctx.busy = value;
    },
    useItem,
  };
  return ctx;
}

// ---------------------------------------------------------------------------
// 1 e 2. Detecção do modo da ficha.
// ---------------------------------------------------------------------------

test("1. ficha sem Mesa → modo local permanece e o fluxo local continua funcionando", async () => {
  assert.equal(sheetMesaMode({ state: null, characterId: CHARACTER_ID }), "local");

  const { flow, calls, character } = clickFlow();
  const notice = await flow;
  assert.equal(calls.local, 1, "o fluxo local da ficha é executado");
  assert.equal(calls.updates.length, 1, "a ficha continua sendo atualizada por onUpdate");
  assert.deepEqual(notice, { text: "Stim usado.", isError: false });
  assert.equal(calls.server.length, 0);
  assert.equal(calls.updates[0].inventory.find((item) => item.id === "inv-stim")?.quantity, 1, "o consumo local continua acontecendo");
  assert.equal(character.inventory.find((item) => item.id === "inv-stim")?.quantity, 2, "applyHealingItem segue puro: devolve outra ficha");
});

test("2. Mesa sem combate ativo → modo local permanece", () => {
  // Sem combate nenhum.
  assert.equal(sheetMesaMode({ state: state(), characterId: CHARACTER_ID }), "local");
  // Combate existe mas não está ativo (já encerrado).
  assert.equal(
    sheetMesaMode({ state: combatState({ combat: activeCombat({ status: "finished" }) }), characterId: CHARACTER_ID }),
    "local",
  );
  // Combate ativo, mas este personagem não é combatente.
  assert.equal(
    sheetMesaMode({ state: combatState({ combatants: [] }), characterId: CHARACTER_ID }),
    "local",
  );
  // Combate ativo e combatente, mas olhando por outro participante.
  assert.equal(
    sheetMesaMode({
      state: combatState({ viewer: { participantId: "participant-2", role: "player", displayName: "Outro" } }),
      characterId: CHARACTER_ID,
    }),
    "local",
  );
  // Sem personagem carregado não há autoridade a inventar.
  assert.equal(sheetMesaMode({ state: combatState(), characterId: null }), "local");
});

// ---------------------------------------------------------------------------
// 3, 4, 5. Combate ativo → item-heal é do servidor, nunca da ficha.
// ---------------------------------------------------------------------------

test("3. Mesa com combate → o uso do item vai para item-heal e o fluxo local não roda", async () => {
  assert.equal(sheetMesaMode({ state: combatState(), characterId: CHARACTER_ID }), "mesa-combat");
  assert.equal(linkedCombatant(combatState(), CHARACTER_ID)?.id, "c-me");

  const serverCalls: string[] = [];
  const { flow, calls } = clickFlow(
    mesaContext(async (itemId) => {
      serverCalls.push(itemId);
      return healResult({ itemId });
    }),
  );
  await flow;

  assert.deepEqual(serverCalls, ["stim"], "só a intenção (id estável) viaja para o servidor");
  assert.equal(calls.local, 0, "o fluxo local nem é chamado");
  assert.equal(calls.updates.length, 0, "nenhuma escrita na ficha");
  assert.equal(calls.notices.length, 1);
  assert.equal(calls.notices[0].isError, false);
});

test("4. uso em Mesa não altera item nem HP localmente (nem depois do sucesso)", async () => {
  const { flow, calls, character } = clickFlow(mesaContext(async () => healResult()));
  await flow;

  assert.equal(calls.updates.length, 0);
  assert.equal(character.inventory.find((item) => item.id === "inv-stim")?.quantity, 2, "quantidade intacta");
  assert.equal(character.combat.hp.current, 5, "HP intacto");
});

test("5. HP e item não mudam antes da resposta do servidor", async () => {
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const mesa = mesaContext(async () => {
    await pending;
    return healResult();
  });
  const { flow, calls, character } = clickFlow(mesa);

  // Em voo: nada foi escrito, nenhum aviso, trava ligada.
  assert.equal(calls.updates.length, 0);
  assert.equal(calls.notices.length, 0);
  assert.equal(mesa.busy, true, "anti-spam ligado enquanto o POST não volta");
  assert.equal(character.combat.hp.current, 5);

  release?.();
  await flow;

  assert.equal(calls.updates.length, 0, "mesmo após a resposta, nada é escrito localmente");
  assert.equal(character.combat.hp.current, 5, "HP é do servidor");
  assert.equal(character.inventory.find((item) => item.id === "inv-stim")?.quantity, 2);
  assert.equal(mesa.busy, false, "trava liberada ao final");
});

test("5b. clique com um uso em andamento é ignorado (sem segundo POST)", async () => {
  const mesa = mesaContext(async () => healResult());
  mesa.setBusy(true);
  const { flow, calls } = clickFlow(mesa);
  assert.equal(await flow, null);
  assert.equal(calls.server.length, 0);
  assert.equal(calls.local, 0);
  assert.equal(calls.notices.length, 0);
});

// ---------------------------------------------------------------------------
// 6. Falha do servidor preserva o estado local.
// ---------------------------------------------------------------------------

test("6. erro do servidor preserva o estado local e mostra o motivo", async () => {
  const { flow, calls, character } = clickFlow(
    mesaContext(async () => {
      throw new MesaApiError("Ações insuficientes para usar o item.", 409, "insufficient_actions");
    }),
  );
  const notice = await flow;

  assert.equal(calls.updates.length, 0, "nada foi consumido nem curado localmente");
  assert.equal(character.inventory.find((item) => item.id === "inv-stim")?.quantity, 2);
  assert.equal(character.combat.hp.current, 5);
  assert.deepEqual(notice, { text: "Ações insuficientes para usar o item.", isError: true });
  assert.deepEqual(calls.notices[0], notice);
});

test("6b. falha de rede não vaza erro genérico em inglês", () => {
  assert.equal(
    healingErrorMessage(new TypeError("fetch failed")),
    "Não foi possível usar o item. Nada foi consumido e seu HP não mudou.",
  );
  assert.equal(healingErrorMessage(undefined), "Não foi possível usar o item. Nada foi consumido e seu HP não mudou.");
});

test("4b. item que a Mesa não acompanha não abre bypass local (botão travado)", () => {
  const mesa = { isTracked: (itemId: string) => itemId === "stim" };

  // Rastreado → habilitado, com o mesmo aviso de sempre.
  const trackedState = healingButtonState({
    healAmount: 5,
    isDead: false,
    atFullHp: false,
    busy: false,
    mesa,
    itemId: "stim",
  });
  assert.equal(trackedState.disabled, false);
  assert.equal(trackedState.title, "Restaura 5 HP");

  // Só a regra da ficha reconhece (notes), a Mesa não tem o item → travado.
  const untrackedState = healingButtonState({
    healAmount: 3,
    isDead: false,
    atFullHp: false,
    busy: false,
    mesa,
    itemId: "bandagem",
  });
  assert.equal(untrackedState.disabled, true);
  assert.equal(untrackedState.title, "Este item não está na mochila da Mesa.");

  // FORA da Mesa nada é travado por autoridade — comportamento de sempre.
  const localState = healingButtonState({
    healAmount: 3,
    isDead: false,
    atFullHp: false,
    busy: false,
    itemId: "bandagem",
  });
  assert.equal(localState.disabled, false);
  assert.equal(localState.title, "Restaura 3 HP");
  assert.equal(localState.label, "✚ Usar (+3 HP)");

  // Regras da ficha que nunca mudaram.
  assert.equal(
    healingButtonState({ healAmount: 5, isDead: true, atFullHp: false, busy: false, itemId: "stim" }).disabled,
    true,
  );
  assert.equal(
    healingButtonState({ healAmount: 5, isDead: false, atFullHp: true, busy: false, itemId: "stim" }).disabled,
    true,
  );

  // Anti-spam durante o POST.
  const busyState = healingButtonState({ healAmount: 5, isDead: false, atFullHp: false, busy: true, mesa, itemId: "stim" });
  assert.equal(busyState.disabled, true);
  assert.equal(busyState.label, "Usando…");
});

// ---------------------------------------------------------------------------
// 7 e 8. O estado da Mesa chega à ficha pela sincronização existente.
// ---------------------------------------------------------------------------

test("7. estado atualizado pelo servidor aparece na ficha", () => {
  const character = sheetCharacter();
  // F1.14.2: a ficha já recebeu a iniciativa da Mesa numa sincronização
  // anterior (`combatant().initiative = 14`). Sem isto a projeção da
  // iniciativa seria justamente uma mudança — e a asserção abaixo é sobre
  // "nada mudou, então não recria o personagem".
  character.combat.initiative = 14;
  const before = syncMesaCharacterState(character, combatState());
  assert.equal(before, character, "sem mudança de suprimentos a sincronização não recria a ficha");

  // O servidor registrou o commit do item-heal: HP 5 → 10 e 1 Stim consumido.
  const afterHeal = combatState({
    combatants: [
      combatant({
        id: "c-me",
        hpCurrent: 10,
        supplies: { inventory: [{ item: "Stim", itemId: "stim", quantity: 1 }] },
      }),
    ],
  });
  const synchronized = syncMesaCharacterState(character, afterHeal);
  assert.equal(synchronized.combat.hp.current, 10);
  assert.equal(synchronized.inventory.find((item) => item.id === "inv-stim")?.quantity, 1);
  assert.equal(synchronized.inventory.find((item) => item.id === "inv-agent")?.quantity, 1, "item não rastreado fica local");
});

test("8. inventário da ficha reflete supplies da Mesa (id estável, não o rótulo)", () => {
  const character = sheetCharacter();
  const combat = combatant({
    id: "c-me",
    // Rótulo normalizado pela Mesa: a identidade é o id, não o nome.
    supplies: { inventory: [{ item: "STIM", quantity: 3 }] },
  });

  assert.deepEqual([...trackedSupplyIds(combat)], ["stim"]);
  assert.deepEqual([...trackedSupplyIds(null)], [], "sem mochila não há o que a Mesa acompanhar");

  const synchronized = syncMesaCharacterState(character, state({ combat: activeCombat(), combatants: [combat] }));
  assert.equal(synchronized.inventory.find((item) => item.id === "inv-stim")?.quantity, 3);
  assert.equal(stableItemId("Stim"), "stim", "a ficha usa o mesmo id que a Mesa");
});

// ---------------------------------------------------------------------------
// 9 e 10. Quando a autoridade NÃO vale.
// ---------------------------------------------------------------------------

test("9. Mesa stale/encerrada não ativa o modo autoritativo", () => {
  const finishedSession = combatState({ session: { ...state().session, status: "finished" } });
  assert.equal(sheetMesaMode({ state: finishedSession, characterId: CHARACTER_ID }), "local");
  assert.equal(sheetMesaMode({ state: null, characterId: CHARACTER_ID }), "local", "assinatura removida/stale");
  // Combate encerrado com sessão viva também é local.
  assert.equal(
    sheetMesaMode({ state: combatState({ combat: activeCombat({ status: "finished" }) }), characterId: CHARACTER_ID }),
    "local",
  );
});

test("10. Mestre nunca entra no modo autoritativo", () => {
  const gmViewing = combatState({
    viewer: { participantId: PARTICIPANT_ID, role: "gm", displayName: "Mestre" },
  });
  assert.equal(sheetMesaMode({ state: gmViewing, characterId: CHARACTER_ID }), "local");
  assert.equal(linkedCombatant(gmViewing, CHARACTER_ID)?.id, "c-me", "a leitura de combatente segue disponível");
});

// ---------------------------------------------------------------------------
// 11 e 12. Fluxos que F1.13.4 NÃO tocou.
// ---------------------------------------------------------------------------

test("11. equip/unequip continua local e igual, mesmo com a Mesa em combate", () => {
  assert.equal(sheetMesaMode({ state: combatState(), characterId: CHARACTER_ID }), "mesa-combat");

  const armor = catalogItems.find((item) => item.category === "armor")!;
  const equipped = getItemForFree(sheetCharacter(), armor.id);
  assert.ok("character" in equipped);
  const armorEntry = equipped.character.inventory.find((item) => item.catalogItemId === armor.id);
  assert.ok(armorEntry, "compra local continua funcionando");
  const result = equipInventoryItem(equipped.character, armorEntry.id);
  assert.ok(result && "character" in result, "equip continua sendo resolvido na ficha");
  assert.equal(result.character.combat.armor.body, typeof armor.sp === "number" ? armor.sp : 0);
});

test("12. compra e venda continuam locais e iguais", () => {
  assert.equal(sheetMesaMode({ state: combatState(), characterId: CHARACTER_ID }), "mesa-combat");

  const item = catalogItems.find((candidate) => candidate.price > 0)!;
  const buyer = createEmptyCharacter("buyer");
  buyer.wallet.eurodollars = item.price;
  const purchase = purchaseItem(buyer, item.id);
  assert.ok("character" in purchase);
  assert.equal(purchase.character.wallet.eurodollars, 0);

  const seller = purchase.character;
  const sold = sellInventoryItem(seller, seller.inventory[0].id);
  assert.ok("character" in sold);
  assert.equal(sold.character.wallet.eurodollars, getSellPrice(item.price));
  assert.equal(sold.character.inventory.length, 0);
});

// ---------------------------------------------------------------------------
// 13. First Aid / Death Save locais não escrevem contra o HP da Mesa.
// ---------------------------------------------------------------------------

test("13. fluxos locais de HP (First Aid / Death Save) são recusados só durante o combate", () => {
  const mesa: PlayerHealingSetup = {
    isTracked: () => true,
    useItem: async () => healResult(),
  };

  const refusal = localHpRefusal(mesa);
  assert.ok(refusal, "a ficha não roda roll local contra o HP da Mesa");
  assert.match(refusal, /servidor/i);
  assert.match(refusal, /fora do combate/);

  assert.equal(localHpRefusal(undefined), null, "fora de uma Mesa em combate o fluxo local continua liberado");
});

test("13b. toda mutação autoritativa local é recusada no modo central", () => {
  const mutations = [
    "hp",
    "inventory",
    "ammo",
    "armor",
    "critical-injuries",
    "death-state",
    "action-economy",
    "attack-result",
    "damage-result",
    "conditions",
    "movement",
  ] as const;

  for (const mutation of mutations) {
    const refusal = localCombatMutationRefusal("mesa-combat", mutation);
    assert.ok(refusal, `${mutation} deve ser recusada em mesa-combat`);
    assert.match(refusal, /servidor/);
  }

  // O mesmo helper não cria uma segunda regra: stale/finished, sem combate e
  // GM chegam como "local" através de sheetMesaMode e continuam liberados.
  for (const mode of ["local"] as const) {
    for (const mutation of mutations) {
      assert.equal(localCombatMutationRefusal(mode, mutation), null);
    }
  }
});

// ---------------------------------------------------------------------------
// F1.13.5 — `playerAttackUnavailable` é um desdobramento de `sheetMesaMode()`.
// ---------------------------------------------------------------------------

test("14. bloqueio do ataque: só em modo mesa-combat, e aí nunca cai no rolo local", () => {
  // Modo autoritativo SEM contexto de ataque da Mesa → o ataque é recusado em
  // voz alta ("Combate da Mesa indisponível") em vez de rodar localmente.
  assert.equal(
    playerAttackUnavailable({ state: combatState(), characterId: CHARACTER_ID, hasAttackSetup: false }),
    true,
    "Mesa como autoridade sem contexto de ataque → recusa",
  );
  // Com o contexto montado o ataque segue pela Mesa e o aviso não aparece.
  assert.equal(
    playerAttackUnavailable({ state: combatState(), characterId: CHARACTER_ID, hasAttackSetup: true }),
    false,
    "contexto presente → o ataque é da Mesa",
  );
  // O modo que autoriza o bloqueio é exatamente o de `sheetMesaMode()`.
  assert.equal(sheetMesaMode({ state: combatState(), characterId: CHARACTER_ID }), "mesa-combat");
});

test("15. fora do modo Mesa o ataque não é bloqueado (falha se a checagem paralela voltar)", () => {
  // A checagem antiga em `CharacterToolkit` era
  //   `character && viewer.role === "player" && combat.status === "active" && !playerAttack`
  // — uma detecção paralela de autoridade. Os três cenários abaixo são "local"
  // pelo modo central, mas a checagem antiga os BLOQUEAVA; se o helper voltar a
  // recontar `viewer.role`/`combat.status`/vinculação, estes asserts falham.

  // (a) combate ativo + jogador, mas ESTE personagem não é combatente.
  const unlinked = combatState({ combatants: [] });
  assert.equal(sheetMesaMode({ state: unlinked, characterId: CHARACTER_ID }), "local");
  assert.equal(
    playerAttackUnavailable({ state: unlinked, characterId: CHARACTER_ID, hasAttackSetup: false }),
    false,
    "personagem não vinculado → comportamento local (ataque segue local)",
  );

  // (b) sessão encerrada/stale com o combate ainda `active`.
  const finishedSession = combatState({ session: { ...state().session, status: "finished" } });
  assert.equal(sheetMesaMode({ state: finishedSession, characterId: CHARACTER_ID }), "local");
  assert.equal(
    playerAttackUnavailable({ state: finishedSession, characterId: CHARACTER_ID, hasAttackSetup: false }),
    false,
    "Mesa stale/finished → comportamento local",
  );

  // (c) Mestre olhando a ficha.
  const gmViewing = combatState({ viewer: { participantId: PARTICIPANT_ID, role: "gm", displayName: "Mestre" } });
  assert.equal(sheetMesaMode({ state: gmViewing, characterId: CHARACTER_ID }), "local");
  assert.equal(
    playerAttackUnavailable({ state: gmViewing, characterId: CHARACTER_ID, hasAttackSetup: false }),
    false,
    "GM → comportamento atual",
  );
});

test("16. sem Mesa, sem combate ou sem personagem o ataque continua local", () => {
  assert.equal(playerAttackUnavailable({ state: null, characterId: CHARACTER_ID, hasAttackSetup: false }), false, "fora da Mesa");
  assert.equal(playerAttackUnavailable({ state: state(), characterId: CHARACTER_ID, hasAttackSetup: false }), false, "Mesa sem combate");
  assert.equal(
    playerAttackUnavailable({
      state: combatState({ combat: activeCombat({ status: "finished" }) }),
      characterId: CHARACTER_ID,
      hasAttackSetup: false,
    }),
    false,
    "combate encerrado",
  );
  assert.equal(playerAttackUnavailable({ state: combatState(), characterId: null, hasAttackSetup: false }), false, "sem personagem carregado");
});
