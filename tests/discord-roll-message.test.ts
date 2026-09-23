import assert from "node:assert/strict";
import test from "node:test";

import { formatRollMessage } from "../src/lib/discord/format.ts";
import type { DiscordRollPayload } from "../src/lib/discord/types.ts";
import { buildRollPayload, findNewRollEntry } from "../src/lib/discord/rollNotify.ts";
import { createEmptyCharacter, type RollHistoryEntry } from "../src/types/character.ts";

function payload(overrides: Partial<DiscordRollPayload>): DiscordRollPayload {
  return {
    kind: "attack",
    playerName: "Eliabe",
    rollType: "Ataque com Pistola",
    expression: "1d10",
    rolls: [7],
    modifier: 14,
    total: 21,
    ...overrides,
  };
}

test("mensagem de ataque segue o formato esperado", () => {
  const message = formatRollMessage(payload({}));
  assert.equal(
    message,
    [
      "🎲 **ELIABE**",
      "",
      "⚔️ **Ataque com Pistola**",
      "",
      "1d10: 7",
      "Modificador: +14",
      "",
      "**Resultado: 21**",
    ].join("\n"),
  );
});

test("rolagem sem modificador omite a linha do modificador", () => {
  const message = formatRollMessage(
    payload({ kind: "skill_check", rollType: "Percepção", rolls: [8], modifier: 0, total: 8 }),
  );
  assert.ok(!message.includes("Modificador"));
  assert.ok(message.includes("1d10: 8"));
  assert.ok(message.includes("**Resultado: 8**"));
});

test("múltiplos dados são mostrados somados", () => {
  const message = formatRollMessage(
    payload({ kind: "damage", rollType: "Dano", expression: "2d6", rolls: [4, 5], modifier: 0, total: 9 }),
  );
  assert.ok(message.includes("2d6: 4 + 5"));
  assert.ok(message.includes("**Resultado: 9**"));
});

test("modificador negativo mantém sinal", () => {
  const message = formatRollMessage(payload({ modifier: -3, total: 4 }));
  assert.ok(message.includes("Modificador: -3"));
});

test("buildRollPayload deriva o modificador do total do site", () => {
  const character = createEmptyCharacter("char-1");
  character.identity = { name: "Zuberi Akil", player: "Eliabe", role: "Solo", level: 1 };

  const entry: RollHistoryEntry = {
    id: "roll-1",
    type: "attack",
    label: "Ataque com Pistola",
    characterId: character.id,
    expression: "1d10",
    rolls: [7],
    total: 21,
    timestamp: new Date().toISOString(),
  };

  const built = buildRollPayload(entry, character);
  assert.ok(built);
  assert.equal(built.playerName, "Eliabe");
  assert.equal(built.total, 21);
  assert.equal(built.rolls[0], 7);
  assert.equal(built.modifier, 14);
  // A soma decomposta bate exatamente com o total produzido pelo site.
  assert.equal(built.rolls.reduce((sum, value) => sum + value, 0) + built.modifier, entry.total);
});

test("buildRollPayload ignora entradas que não são rolagens de dados", () => {
  const character = createEmptyCharacter("char-2");
  const base: RollHistoryEntry = {
    id: "roll-2",
    type: "received_damage",
    label: "Dano recebido",
    characterId: character.id,
    expression: "fixed",
    rolls: [],
    total: 5,
    timestamp: new Date().toISOString(),
  };
  assert.equal(buildRollPayload(base, character), null);
});

test("findNewRollEntry detecta apenas a entrada nova", () => {
  const character = createEmptyCharacter("char-3");
  const oldEntry: RollHistoryEntry = {
    id: "old",
    type: "skill_check",
    label: "Percepção",
    characterId: character.id,
    expression: "1d10",
    rolls: [4],
    total: 12,
    timestamp: new Date().toISOString(),
  };
  const withOld = { ...character, rollHistory: [oldEntry] };
  const newEntry: RollHistoryEntry = { ...oldEntry, id: "new", rolls: [9], total: 17 };
  const withNew = { ...character, rollHistory: [newEntry, oldEntry] };

  assert.equal(findNewRollEntry(withOld, withNew), newEntry);
  assert.equal(findNewRollEntry(withOld, withOld), null);
  assert.equal(findNewRollEntry(null, withOld), oldEntry);
});
