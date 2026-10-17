/**
 * Catálogo central de estados visuais de combate.
 *
 * Critérios:
 * - o catálogo tipado é a ÚNICA fonte de estados (nenhum componente espalha
 *   strings arbitrárias);
 * - IDLE é o único estado obrigatório; os demais são opcionais;
 * - rótulos em pt-BR para a interface;
 * - DEFEATED e DEATH são estados distintos; DEATH é marcado como dependente
 *   das regras (existe quando a mesa definir morte como estado próprio);
 * - o catálogo é extensível sem quebrar consumidores.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  COMBAT_VISUAL_STATE_BY_ID,
  COMBAT_VISUAL_STATE_CATALOG,
  COMBAT_VISUAL_STATES,
  DEFAULT_COMBAT_VISUAL_STATE,
  REQUIRED_VISUAL_STATES,
  catalogOrderOf,
  isCombatVisualState,
  isRequiredVisualState,
} from "../src/lib/characterVisual/visualStates.ts";

test("catálogo contém os dez estados iniciais com rótulos em pt-BR", () => {
  assert.deepEqual([...COMBAT_VISUAL_STATES], [
    "IDLE", "ATTACK", "DODGE", "HIT", "DEFEATED", "DEATH", "AIM", "SHOOT", "MELEE_ATTACK", "RELOAD",
  ]);
  assert.equal(COMBAT_VISUAL_STATE_CATALOG.length, COMBAT_VISUAL_STATES.length);
  for (const definition of COMBAT_VISUAL_STATE_CATALOG) {
    assert.ok(definition.id.length > 0, `${definition.id} sem identificador`);
    assert.ok(definition.label.length > 0, `${definition.id} sem rótulo`);
    assert.ok(definition.hint.length > 0, `${definition.id} sem descrição`);
  }
});

test("IDLE é o único estado obrigatório e é o default do renderizador", () => {
  assert.deepEqual([...REQUIRED_VISUAL_STATES], ["IDLE"]);
  assert.equal(isRequiredVisualState("IDLE"), true);
  assert.equal(isRequiredVisualState("ATTACK"), false);
  assert.equal(isRequiredVisualState("DEATH"), false);
  assert.equal(DEFAULT_COMBAT_VISUAL_STATE, "IDLE");
});

test("DEFEATED e DEATH são estados distintos; DEATH depende das regras", () => {
  assert.notEqual(COMBAT_VISUAL_STATE_BY_ID.DEFEATED.id, COMBAT_VISUAL_STATE_BY_ID.DEATH.id);
  assert.equal(COMBAT_VISUAL_STATE_BY_ID.DEATH.ruleGated, true);
  assert.equal(COMBAT_VISUAL_STATE_BY_ID.DEFEATED.ruleGated, undefined);
});

test("isCombatVisualState não aceita strings arbitrárias", () => {
  assert.equal(isCombatVisualState("IDLE"), true);
  assert.equal(isCombatVisualState("MELEE_ATTACK"), true);
  assert.equal(isCombatVisualState("idle"), false);
  assert.equal(isCombatVisualState("IDLE; drop table"), false);
  assert.equal(isCombatVisualState(""), false);
  assert.equal(isCombatVisualState(undefined), false);
  assert.equal(isCombatVisualState(42), false);
});

test("ordem do catálogo é estável e estados conhecidos são indexados", () => {
  assert.equal(catalogOrderOf("IDLE"), 0);
  assert.equal(catalogOrderOf("RELOAD"), COMBAT_VISUAL_STATES.length - 1);
  for (const state of COMBAT_VISUAL_STATES) {
    assert.equal(COMBAT_VISUAL_STATE_BY_ID[state].id, state);
  }
});
