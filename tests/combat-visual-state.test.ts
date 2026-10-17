/**
 * Etapa 2 — controlador de estado VISUAL de combate (módulo puro, sem React).
 *
 * O que estes testes protegem:
 * - estados vêm de RESULTADOS REAIS: ataque confirmado (resposta da rota após
 *   commit), esquiva confirmada (defesa `evasion` + falha), dano recebido
 *   (queda de HP no snapshot) e derrota registrada (`isDead`);
 * - fallbacks pelo manifesto da Etapa 1: SHOOT/MELEE_ATTACK caem em ATTACK e
 *   depois em IDLE; DODGE/HIT/RELOAD caem em IDLE; sem nada → boneco genérico;
 * - temporários retornam ao IDLE; terminais (DEFEATED) nunca são sobrescritos
 *   por temporários;
 * - deduplicação de transições repetidas, janela de prioridade e reset por
 *   combate novo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  COMBAT_VISUAL_DURATION_MS,
  CombatVisualStateController,
  attackVisualEffects,
  isTerminalVisualState,
  resolveCombatStateImage,
  type CombatVisualSnapshotCombatant,
} from "../src/lib/characterVisual/combatVisualState.ts";
import {
  emptyCharacterVisualProfile,
  resolveCharacterVisualIdentity,
  type CharacterVisualAssetRef,
  type CharacterVisualProfileData,
} from "../src/lib/characterVisual/visualIdentity.ts";
import type { CombatVisualState } from "../src/lib/characterVisual/visualStates.ts";

function assetRef(assetId: string, state: CombatVisualState): CharacterVisualAssetRef {
  return {
    assetId,
    kind: "combat_state",
    state,
    mimeType: "image/png",
    width: 512,
    height: 1024,
    byteSize: 2048,
    url: `/api/character-visual/asset/${assetId}?e=1&s=x`,
    updatedAt: "2026-11-01T00:00:00.000Z",
  };
}

function identityWith(states: Partial<Record<CombatVisualState, string>>) {
  const profile: CharacterVisualProfileData = {
    characterId: "char-visual",
    displayName: "V",
    updatedAt: "2026-11-01T00:00:00.000Z",
    portrait: null,
    stateImages: Object.fromEntries(
      Object.entries(states).map(([state, assetId]) => [state, assetRef(assetId, state as CombatVisualState)]),
    ),
  };
  return resolveCharacterVisualIdentity(profile, "V");
}

function combatant(id: string, overrides: Partial<CombatVisualSnapshotCombatant> = {}): CombatVisualSnapshotCombatant {
  return { id, isDead: false, hpCurrent: 20, ammoByWeapon: null, ...overrides };
}

/** Relógio falso: os timers aqui são só de apresentação, nunca mecânicos. */
function fakeClock(start = 1_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

// ---------------------------------------------------------------------------
// Renderização: IDLE, legado e cadeias de fallback (testes 1–5 do roteiro)
// ---------------------------------------------------------------------------

test("personagem com IDLE configurado resolve a imagem IDLE para o estado padrão", () => {
  const identity = identityWith({ IDLE: "a-idle" });
  const resolved = resolveCombatStateImage(identity, "IDLE");
  assert.equal(resolved?.url, "/api/character-visual/asset/a-idle?e=1&s=x");
  assert.equal(resolved?.state, "IDLE");
  assert.equal(resolved?.assetId, "a-idle");
});

test("personagem legado sem nenhuma imagem resolve null (boneco genérico)", () => {
  const identity = resolveCharacterVisualIdentity(emptyCharacterVisualProfile("char-legado"), "V");
  assert.equal(resolveCombatStateImage(identity, "IDLE"), null);
  // Sem manifesto nenhum (personagem inacessível) também cai no genérico.
  assert.equal(resolveCombatStateImage(null, "SHOOT"), null);
  assert.equal(resolveCombatStateImage(undefined, "DODGE"), null);
});

test("SHOOT, DODGE e HIT caem para a imagem IDLE quando não há assets próprios", () => {
  const identity = identityWith({ IDLE: "a-idle" });
  for (const state of ["SHOOT", "DODGE", "HIT"] as const) {
    const resolved = resolveCombatStateImage(identity, state);
    assert.equal(resolved?.url, "/api/character-visual/asset/a-idle?e=1&s=x", `${state} deve cair no IDLE`);
    assert.equal(resolved?.state, "IDLE");
  }
});

test("SHOOT e MELEE_ATTACK caem para ATTACK antes de IDLE", () => {
  const identity = identityWith({ IDLE: "a-idle", ATTACK: "a-attack" });
  const shoot = resolveCombatStateImage(identity, "SHOOT");
  assert.equal(shoot?.state, "ATTACK");
  assert.equal(shoot?.assetId, "a-attack");
  const melee = resolveCombatStateImage(identity, "MELEE_ATTACK");
  assert.equal(melee?.state, "ATTACK");
  // Com SHOOT própria configurada, a específica vence a cadeia.
  const ownShoot = resolveCombatStateImage(identityWith({ IDLE: "a-idle", ATTACK: "a-attack", SHOOT: "a-shoot" }), "SHOOT");
  assert.equal(ownShoot?.state, "SHOOT");
  assert.equal(ownShoot?.assetId, "a-shoot");
});

test("DEATH cai para DEFEATED e depois IDLE na cadeia", () => {
  const identity = identityWith({ IDLE: "a-idle", DEFEATED: "a-def" });
  const resolved = resolveCombatStateImage(identity, "DEATH");
  assert.equal(resolved?.state, "DEFEATED");
  assert.equal(resolved?.assetId, "a-def");
});

test("URL marcada como falha é pulada para o próximo fallback", () => {
  const identity = identityWith({ IDLE: "a-idle", SHOOT: "a-shoot" });
  const failed = new Set(["/api/character-visual/asset/a-shoot?e=1&s=x"]);
  const resolved = resolveCombatStateImage(identity, "SHOOT", (url) => failed.has(url));
  assert.equal(resolved?.state, "IDLE", "URL quebrada do SHOOT deve cair no IDLE");
  failed.add("/api/character-visual/asset/a-idle?e=1&s=x");
  assert.equal(resolveCombatStateImage(identity, "SHOOT", (url) => failed.has(url)), null);
});

// ---------------------------------------------------------------------------
// Efeitos de ataque confirmado (testes 4–7 do roteiro)
// ---------------------------------------------------------------------------

test("ataque à distância confirmado ativa SHOOT; corpo a corpo ativa MELEE_ATTACK", () => {
  const controller = new CombatVisualStateController();
  controller.recordSnapshot("combat-1", [combatant("c1", { hpCurrent: 15 }), combatant("c2")]);
  const changed = controller.report({ combatantId: "c1", effect: "attack_ranged" });
  assert.equal(changed, true);
  assert.equal(controller.activeStateFor("c1"), "SHOOT");
  controller.report({ combatantId: "c2", effect: "attack_melee" });
  assert.equal(controller.activeStateFor("c2"), "MELEE_ATTACK");
});

test("dano recebido ativa HIT (queda de HP no snapshot autenticado)", () => {
  const clock = fakeClock();
  const controller = new CombatVisualStateController(clock.now);
  controller.recordSnapshot("combat-1", [combatant("c1", { hpCurrent: 20 })]);
  assert.equal(controller.activeStateFor("c1"), null, "sem mudança não há estado");
  clock.advance(1000);
  // Mesmo estado repetido não gera novo efeito (chega por Realtime + polling).
  controller.recordSnapshot("combat-1", [combatant("c1", { hpCurrent: 20 })]);
  assert.equal(controller.activeStateFor("c1"), null);
  clock.advance(1000);
  controller.recordSnapshot("combat-1", [combatant("c1", { hpCurrent: 12 })]);
  assert.equal(controller.activeStateFor("c1"), "HIT");
});

test("recarga confirmada (munição recarregada no snapshot) ativa RELOAD", () => {
  const clock = fakeClock();
  const controller = new CombatVisualStateController(clock.now);
  controller.recordSnapshot("combat-1", [combatant("c1", { ammoByWeapon: { w1: 2 } })]);
  clock.advance(2000);
  controller.recordSnapshot("combat-1", [combatant("c1", { ammoByWeapon: { w1: 12 } })]);
  assert.equal(controller.activeStateFor("c1"), "RELOAD");
});

test("esquiva ativa DODGE apenas quando confirmada: evasion + falha", () => {
  // Acertou com defesa evasion → houve dano, não esquiva: HIT, não DODGE.
  assert.deepEqual(
    attackVisualEffects({ attackerId: "a", targetId: "t", kind: "ranged", hit: true, damage: 8, defenseType: "evasion" }),
    [
      { combatantId: "a", effect: "attack_ranged" },
      { combatantId: "t", effect: "hit" },
    ],
  );
  // Errou com defesa `dv` (cobertura/DV) → NÃO se deduz esquiva: sem efeito no alvo.
  assert.deepEqual(
    attackVisualEffects({ attackerId: "a", targetId: "t", kind: "ranged", hit: false, damage: null, defenseType: "dv" }),
    [{ combatantId: "a", effect: "attack_ranged" }],
  );
  // Errou com defesa `evasion` → esquiva efetivamente executada.
  assert.deepEqual(
    attackVisualEffects({ attackerId: "a", targetId: "t", kind: "ranged", hit: false, damage: null, defenseType: "evasion" }),
    [
      { combatantId: "a", effect: "attack_ranged" },
      { combatantId: "t", effect: "dodge" },
    ],
  );
  // Ataque sem alvo (cover) → só o atacante.
  assert.deepEqual(
    attackVisualEffects({ attackerId: "a", targetId: null, kind: "melee", hit: true, damage: 4 }),
    [{ combatantId: "a", effect: "attack_melee" }],
  );

  const clock = fakeClock();
  const controller = new CombatVisualStateController(clock.now);
  for (const { combatantId, effect } of attackVisualEffects(
    { attackerId: "a", targetId: "t", kind: "ranged", hit: false, damage: null, defenseType: "evasion" },
  )) {
    controller.report({ combatantId, effect });
  }
  assert.equal(controller.activeStateFor("t"), "DODGE");
});

// ---------------------------------------------------------------------------
// Retorno, terminais, dedupe e prioridade (testes 8–10 do roteiro)
// ---------------------------------------------------------------------------

test("estados temporários retornam ao IDLE quando expiram (timers são de apresentação)", () => {
  const clock = fakeClock();
  const controller = new CombatVisualStateController(clock.now);
  controller.recordSnapshot("combat-1", [combatant("c1")]);
  controller.report({ combatantId: "c1", effect: "attack_ranged" });
  assert.equal(controller.activeStateFor("c1"), "SHOOT");
  clock.advance(COMBAT_VISUAL_DURATION_MS.SHOOT - 1);
  assert.equal(controller.activeStateFor("c1"), "SHOOT", "ainda dentro da janela");
  clock.advance(2);
  assert.equal(controller.activeStateFor("c1"), null, "expirou → IDLE");
  // Vencido não agenda novo timeout (guarda contra laço de re-render).
  assert.equal(controller.nextExpiryAt(), null);
});

test("nextExpiryAt entrega o primeiro vencimento entre combatentes", () => {
  const clock = fakeClock();
  const controller = new CombatVisualStateController(clock.now);
  controller.recordSnapshot("combat-1", [combatant("c1"), combatant("c2")]);
  controller.report({ combatantId: "c1", effect: "reload" });   // 1700ms
  clock.advance(200);
  controller.report({ combatantId: "c2", effect: "hit" });      // 1400ms a partir de agora
  const expiry = controller.nextExpiryAt();
  assert.equal(expiry, clock.now() + COMBAT_VISUAL_DURATION_MS.HIT);
});

test("derrota registrada (isDead) é terminal e sobrevive a temporários e ao tempo", () => {
  const clock = fakeClock();
  const controller = new CombatVisualStateController(clock.now);
  controller.recordSnapshot("combat-1", [combatant("c1"), combatant("c2")]);
  clock.advance(1000);
  controller.recordSnapshot("combat-1", [combatant("c1", { isDead: true, hpCurrent: 0 }), combatant("c2")]);
  assert.equal(controller.activeStateFor("c1"), "DEFEATED");
  assert.equal(isTerminalVisualState("DEFEATED"), true);

  // Ações temporárias não sobrescrevem o terminal.
  clock.advance(500);
  assert.equal(controller.report({ combatantId: "c1", effect: "hit" }), false);
  assert.equal(controller.report({ combatantId: "c1", effect: "reload" }), false);
  assert.equal(controller.report({ combatantId: "c1", effect: "attack_ranged" }), false);
  clock.advance(60_000);
  // Snapshots seguintes com isDead continuam não alterando o terminal.
  controller.recordSnapshot("combat-1", [combatant("c1", { isDead: true, hpCurrent: 0 }), combatant("c2")]);
  assert.equal(controller.activeStateFor("c1"), "DEFEATED", "terminal nunca expira nem vira IDLE");
});

test("combate novo zera os estados visuais (nada vaza entre encontros)", () => {
  const clock = fakeClock();
  const controller = new CombatVisualStateController(clock.now);
  controller.recordSnapshot("combat-1", [combatant("c1", { isDead: true, hpCurrent: 0 })]);
  assert.equal(controller.activeStateFor("c1"), "DEFEATED");
  clock.advance(1000);
  controller.recordSnapshot("combat-2", [combatant("c1", { isDead: false, hpCurrent: 20 })]);
  assert.equal(controller.activeStateFor("c1"), null, "novo combate começa em IDLE");
  clock.advance(1000);
  controller.recordSnapshot("combat-2", [combatant("c1", { isDead: true, hpCurrent: 0 })]);
  assert.equal(controller.activeStateFor("c1"), "DEFEATED");
  clock.advance(1000);
  controller.recordSnapshot(null, []);
  assert.equal(controller.activeStateFor("c1"), null, "fim do combate limpa os estados");
});

test("transições duplicadas consecutivas são deduplicadas", () => {
  const clock = fakeClock();
  const controller = new CombatVisualStateController(clock.now);
  controller.recordSnapshot("combat-1", [combatant("c1")]);
  assert.equal(controller.report({ combatantId: "c1", effect: "hit" }), true);
  clock.advance(100);
  // Realtime + polling podem entregar o MESMO resultado duas vezes.
  assert.equal(controller.report({ combatantId: "c1", effect: "hit" }), false, "mesmo efeito na janela de dedupe");
  clock.advance(500);
  assert.equal(controller.report({ combatantId: "c1", effect: "hit" }), true, "golpe novo depois da janela");
});

test("prioridade: HIT/DODGE vencem RELOAD; temporário nunca rebaixa terminal", () => {
  const clock = fakeClock();
  const controller = new CombatVisualStateController(clock.now);
  controller.recordSnapshot("combat-1", [combatant("c1")]);
  controller.report({ combatantId: "c1", effect: "hit" });
  clock.advance(200);
  // Recarregou no meio da janela de HIT: o HIT reage ao dano e tem prioridade.
  assert.equal(controller.report({ combatantId: "c1", effect: "reload" }), false);
  assert.equal(controller.activeStateFor("c1"), "HIT");
  clock.advance(COMBAT_VISUAL_DURATION_MS.HIT + 1);
  assert.equal(controller.activeStateFor("c1"), null, "após expirar volta ao IDLE (o RELOAD não fica preso)");
  // Ataque com prioridade maior substitui temporário em janela.
  controller.report({ combatantId: "c1", effect: "reload" });
  clock.advance(100);
  assert.equal(controller.report({ combatantId: "c1", effect: "attack_ranged" }), true);
  assert.equal(controller.activeStateFor("c1"), "SHOOT");
});
