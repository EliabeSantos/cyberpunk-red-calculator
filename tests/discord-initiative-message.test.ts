import assert from "node:assert/strict";
import test from "node:test";

import { formatInitiativeMessage, formatMessage } from "../src/lib/discord/format.ts";
import {
  isDiscordMessagePayload,
  type DiscordInitiativePayload,
} from "../src/lib/discord/types.ts";
import {
  buildEnemyAttackPayload,
  buildEnemyDamagePayload,
  type EnemyRollSource,
} from "../src/lib/discord/rollNotify.ts";

function participant(overrides: Partial<EnemyRollSource> = {}): EnemyRollSource {
  return {
    name: "Solo Militech",
    archetype: "Solo",
    weaponName: "SMG",
    attackBase: 14,
    damageExpression: "2d6",
    lastAttackRoll: null,
    lastDamageRoll: null,
    ...overrides,
  };
}

function initiativePayload(overrides: Partial<DiscordInitiativePayload> = {}): DiscordInitiativePayload {
  return {
    sessionCode: "mesa-teste",
    kind: "initiative",
    encounterName: "Ataque à Corp Zone",
    rows: [
      { name: "Drone", roll: 9, ref: 3, total: 12 },
      { name: "Solo Militech", roll: 4, ref: 5, total: 9 },
    ],
    ...overrides,
  };
}

test("resumo de iniciativa segue o formato esperado, na ordem do site", () => {
  const message = formatInitiativeMessage(initiativePayload());
  assert.equal(
    message,
    [
      "🎲 **INICIATIVA — ATAQUE À CORP ZONE**",
      "",
      "**Drone**: d10(9) + 3 REF = **12**",
      "**Solo Militech**: d10(4) + 5 REF = **9**",
    ].join("\n"),
  );
});

test("iniciativa sem bônus de REF omite o trecho do modificador", () => {
  const message = formatInitiativeMessage(
    initiativePayload({ encounterName: "Emboscada", rows: [{ name: "Drone", roll: 7, ref: 0, total: 7 }] }),
  );
  assert.ok(message.includes("**Drone**: d10(7) = **7**"));
  assert.ok(!message.includes("REF"));
});

test("formatMessage despacha por tipo de mensagem", () => {
  const initiative = formatMessage(initiativePayload());
  assert.ok(initiative.startsWith("🎲 **INICIATIVA"));

  const roll = formatMessage({
    sessionCode: "mesa-teste",
    kind: "attack",
    playerName: "Solo Militech",
    rollType: "SMG",
    expression: "1d10",
    rolls: [7],
    modifier: 14,
    total: 21,
  });
  assert.ok(roll.includes("⚔️ **SMG**"), "rolagem única mantém o formato do jogador");
});

test("validador aceita payload de iniciativa íntegro", () => {
  assert.equal(isDiscordMessagePayload(initiativePayload()), true);
});

test("validador rejeita iniciativa sem linhas ou com linha inválida", () => {
  assert.equal(isDiscordMessagePayload(initiativePayload({ rows: [] })), false);
  assert.equal(
    isDiscordMessagePayload(initiativePayload({ rows: [{ name: "", roll: 4, ref: 5, total: 9 }] })),
    false,
    "nome vazio não publica",
  );
  assert.equal(
    isDiscordMessagePayload(
      initiativePayload({ rows: [{ name: "Drone", roll: 4.5, ref: 5, total: 9 }] }),
    ),
    false,
    "dado não inteiro não publica",
  );
});

test("validador continua aceitando rolagem única e rejeitando lixo", () => {
  assert.equal(
    isDiscordMessagePayload({
      sessionCode: "mesa-teste",
      kind: "attack",
      playerName: "Solo Militech",
      rollType: "SMG",
      expression: "1d10",
      rolls: [7],
      modifier: 14,
      total: 21,
    }),
    true,
  );
  assert.equal(isDiscordMessagePayload({ kind: "initiative" }), false);
  assert.equal(isDiscordMessagePayload(null), false);
});

test("payload do ataque do inimigo decompõe o modificador como o attackBase", () => {
  const built = buildEnemyAttackPayload(
    participant({
      lastAttackRoll: { diceRolls: [10, 4], diceTotal: 14, total: 28, critical: true, fumble: false },
    }),
  );
  assert.ok(built);
  assert.equal(built.sessionCode, "", "sem mesa definida o payload fica sem destino (não enviado)");
  assert.equal(built.kind, "attack");
  assert.equal(built.playerName, "Solo Militech");
  assert.equal(built.rollType, "SMG");
  assert.equal(built.expression, "1d10");
  assert.deepEqual(built.rolls, [10, 4]);
  assert.equal(built.modifier, 14, "modificador deriva do total, nunca é recalculado");
  assert.equal(built.total, 28);
  // Invariante do contrato: soma(dados) + modificador === total do site.
  assert.equal(built.rolls.reduce((sum, value) => sum + value, 0) + built.modifier, built.total);
});

test("payload do ataque considera a penalidade de fumble (dado negativo)", () => {
  const built = buildEnemyAttackPayload(
    participant({
      lastAttackRoll: { diceRolls: [1, -6], diceTotal: -5, total: 9, critical: false, fumble: true },
    }),
  );
  assert.ok(built);
  assert.deepEqual(built.rolls, [1, -6]);
  assert.equal(built.modifier, 14, "attackBase aparece como modificador mesmo com fumble");
  assert.equal(built.rolls.reduce((sum, value) => sum + value, 0) + built.modifier, built.total);
});

test("payload do dano usa a expressão da arma e modificador zero", () => {
  const built = buildEnemyDamagePayload(
    participant({ lastDamageRoll: { rolls: [4, 5], total: 9 } }),
  );
  assert.ok(built);
  assert.equal(built.kind, "damage");
  assert.equal(built.rollType, "Dano de SMG");
  assert.equal(built.expression, "2d6");
  assert.equal(built.modifier, 0);
  assert.equal(built.total, 9);
});

test("sem rolagem salva não há payload (nada é enviado)", () => {
  assert.equal(buildEnemyAttackPayload(participant()), null);
  assert.equal(buildEnemyDamagePayload(participant()), null);
});

test("nome vazio cai para o arquétipo, depois para 'Inimigo'", () => {
  const built = buildEnemyAttackPayload(
    participant({
      name: "  ",
      archetype: "Guarda",
      lastAttackRoll: { diceRolls: [6], diceTotal: 6, total: 20, critical: false, fumble: false },
    }),
  );
  assert.ok(built);
  assert.equal(built.playerName, "Guarda");

  const anonymous = buildEnemyAttackPayload(
    participant({
      name: "",
      archetype: "",
      lastAttackRoll: { diceRolls: [6], diceTotal: 6, total: 20, critical: false, fumble: false },
    }),
  );
  assert.ok(anonymous);
  assert.equal(anonymous.playerName, "Inimigo");
});
