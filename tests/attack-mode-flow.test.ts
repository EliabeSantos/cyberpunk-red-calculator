/**
 * F0.2 — fluxo de Attack Mode: UI → seleção → handler → cálculo → resultado.
 *
 * O bug coberto aqui: `AttackActions` decidia "este ataque é à distância?"
 * comparando `availableAttack.context.type` (que para arma é SEMPRE "weapon")
 * com uma lista de ids de perícias. Nunca casava, então o seletor de modos não
 * era renderizado e o modo escolhido jamais chegava a `rollAttack` — que caía
 * sempre em `context.attackMode ?? "normal"`.
 *
 * A correção faz a UI usar o MESMO critério do cálculo
 * (`isRangedAttackType`, em `src/lib/attacks.ts`), decidido pelo tipo
 * RESOLVIDO da arma (`weapon.attackType`).
 *
 * Os testes importam o componente `.tsx` (o loader de testes transpila JSX) e
 * percorrem a árvore de elementos React para acionar os handlers de verdade —
 * sem DOM e sem dependência nova.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { getAvailableAttacks, isRangedAttackType, rollAttack } from "../src/lib/attacks.ts";
import { createEmptyCharacter } from "../src/types/character.ts";
import type { AttackMode, AttackRollResult } from "../src/types/attack.ts";
import type { Character } from "../src/types/character.ts";

const { default: AttackActions } = await import("../src/components/combat/AttackActions.tsx");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PISTOL_ID = "w-pistol";
const PISTOL_NAME = "Medium Pistol";
const KNIFE_NAME = "Knife";
const INITIAL_AMMO = 12;

function shooter(): Character {
  const base = createEmptyCharacter("attack-mode-flow");
  return {
    ...base,
    skills: { ...base.skills, handgun: { ...base.skills.handgun, level: 4 } },
    weapons: [
      {
        id: PISTOL_ID,
        name: PISTOL_NAME,
        damage: "2d6",
        rateOfFire: 2,
        magazine: INITIAL_AMMO,
        ammo: INITIAL_AMMO,
        skill: "handgun",
        attackType: "handgun",
      },
      { id: "w-knife", name: KNIFE_NAME, damage: "1d6", rateOfFire: 2, skill: "melee_weapon", attackType: "melee" },
    ],
  };
}

function pistolContext(character: Character) {
  const attack = getAvailableAttacks(character).find((item) => item.context.weaponId === PISTOL_ID);
  assert.ok(attack, "o ataque da pistola precisa estar disponível");
  return attack.context;
}

function ammoOf(character: Character): number | undefined {
  return character.weapons.find((weapon) => weapon.id === PISTOL_ID)?.ammo;
}

// ---------------------------------------------------------------------------
// Varredura da árvore de elementos React (o componente não usa hooks)
// ---------------------------------------------------------------------------

interface ReactElementLike {
  type: unknown;
  props: { children?: unknown; onClick?: () => void };
}

type Button = { text: string; onClick: () => void };

function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map((child) => textOf(child)).join("");
  if (typeof node === "object" && "props" in node) return textOf((node as ReactElementLike).props.children);
  return "";
}

function collectButtons(node: unknown, out: Button[] = []): Button[] {
  if (node === null || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) collectButtons(child, out);
    return out;
  }
  const element = node as Partial<ReactElementLike>;
  if (!("type" in element) || !("props" in element) || !element.props) return out;
  if (element.type === "button" && typeof element.props.onClick === "function") {
    out.push({ text: textOf(element.props.children), onClick: element.props.onClick as () => void });
  }
  collectButtons(element.props.children, out);
  return out;
}

type RenderProps = Parameters<typeof AttackActions>[0];

function render(overrides: Partial<RenderProps> = {}) {
  return AttackActions({
    character: shooter(),
    onUpdate: () => {},
    onResult: () => {},
    ...overrides,
  });
}

/** Botões de um cartão de ataque específico (o cartão contém o nome do rótulo). */
function cardButtons(tree: unknown, cardLabel: string): Button[] {
  const children = (tree as ReactElementLike).props.children;
  const cards = Array.isArray(children) ? children : [children];
  const card = cards.find((candidate) => textOf(candidate).includes(cardLabel));
  assert.ok(card, `cartão "${cardLabel}" não encontrado na árvore renderizada`);
  return collectButtons(card);
}

function modeButtons(buttons: Button[]): Button[] {
  return buttons.filter((button) => /^(Normal|Aimed|Autofire|Suppressive)/.test(button.text));
}

function rollButton(buttons: Button[]): Button {
  const button = buttons.find((candidate) => candidate.text.includes("Rolar ataque"));
  assert.ok(button, "o botão de rolar ataque precisa existir");
  return button;
}

/** Clica em ROLAR dentro da UI e devolve o que os handlers entregaram. */
function rollViaUi(modeState?: Record<string, AttackMode>): { updated: Character; result: AttackRollResult } {
  const updates: Character[] = [];
  const results: AttackRollResult[] = [];
  const tree = render({
    onUpdate: (character) => updates.push(character),
    onResult: (result) => results.push(result),
    ...(modeState ? { weaponAttackModes: modeState } : {}),
  });
  rollButton(cardButtons(tree, PISTOL_NAME)).onClick();
  assert.equal(updates.length, 1, "o ataque precisa chamar onUpdate uma vez");
  assert.equal(results.length, 1, "o ataque precisa chamar onResult uma vez");
  return { updated: updates[0], result: results[0] };
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

test("Teste 1 — modo padrão: sem seleção explícita, o comportamento atual continua igual", () => {
  const character = shooter();

  // Cálculo: contexto sem attackMode → custo padrão de 1 munição.
  const resolution = rollAttack(character, pistolContext(character));
  assert.ok(!("error" in resolution));
  assert.equal(pistolContext(character).attackMode, undefined, "o contexto vindo da UI não traz modo por padrão");
  assert.equal(ammoOf(resolution.character), INITIAL_AMMO - 1, "1 munição consumida, como hoje");

  // UI: sem estado de modos salvo, o mesmo resultado.
  const { updated } = rollViaUi();
  assert.equal(ammoOf(updated), INITIAL_AMMO - 1, "a UI padrão também consome 1 munição");
});

test("Teste 2 — modo alternativo chega ao cálculo existente", () => {
  const character = shooter();
  const context = pistolContext(character);

  const esperado: Array<[AttackMode, number]> = [
    ["normal", INITIAL_AMMO - 1],
    ["aimed", INITIAL_AMMO - 1],
    ["autofire", INITIAL_AMMO - 10],
    ["suppressive", INITIAL_AMMO - 10],
  ];

  for (const [mode, ammoEsperado] of esperado) {
    const resolution = rollAttack(character, { ...context, attackMode: mode });
    assert.ok(!("error" in resolution), `modo ${mode} não pode virar erro`);
    assert.equal(ammoOf(resolution.character), ammoEsperado, `modo ${mode} → ${ammoEsperado} munições`);
  }
});

test("Teste 3 — o modo selecionado não é descartado antes da resolução", () => {
  const character = shooter();

  // 1. usuário clica em AUTO FIRE no seletor → a seleção chega ao handler de estado.
  const selected: Array<{ weaponId: string; mode: AttackMode }> = [];
  const tree = render({
    character,
    weaponAttackModes: {},
    onAttackModeChange: (weaponId, mode) => selected.push({ weaponId, mode }),
  });
  const autofire = modeButtons(cardButtons(tree, PISTOL_NAME)).find((button) => button.text.startsWith("Autofire"));
  assert.ok(autofire, "o botão Autofire precisa existir no seletor");
  autofire.onClick();
  assert.deepEqual(selected, [{ weaponId: PISTOL_ID, mode: "autofire" }], "a seleção sai da UI com a arma certa");

  // 2. estado persistido → novo render → o handler usa o modo salvo, não "normal".
  const { updated, result } = rollViaUi({ [PISTOL_ID]: selected[0].mode });
  assert.equal(ammoOf(updated), INITIAL_AMMO - 10, "10 munições: o modo escolhido sobreviveu até o cálculo");
  assert.equal(result.weaponId, PISTOL_ID, "o resultado é do ataque da arma selecionada");
});

test("Teste 4 — arma incompatível não oferece modos (validação existente)", () => {
  const character = shooter();
  const tree = render({ character });

  // Ataque à distância → os quatro modos existentes aparecem.
  assert.equal(modeButtons(cardButtons(tree, PISTOL_NAME)).length, 4);

  // Corpo a corpo e ataque por perícia (sem arma) → seletor não existe.
  assert.equal(modeButtons(cardButtons(tree, KNIFE_NAME)).length, 0, "arma melee não mostra modos");
  assert.equal(modeButtons(cardButtons(tree, "Brawling")).length, 0, "ataque por perícia não mostra modos");

  // O critério é exatamente o do cálculo (uma lista só, UI e resolução juntas).
  assert.equal(isRangedAttackType("handgun", "handgun"), true);
  assert.equal(isRangedAttackType("melee", "melee_weapon"), false);
  assert.equal(isRangedAttackType("weapon", "shoulder_arms"), true, "fallback legado por perícia");
  assert.equal(isRangedAttackType("weapon", "melee_weapon"), false);

  // LIMITAÇÃO (não alterada aqui): não existe validação de compatibilidade entre
  // MODO e arma além do gate de distância — aimed/autofire/suppressive ficam
  // disponíveis para qualquer arma à distância, e só o custo de munição muda.
});

test("Teste 5 — histórico registra o ataque; o modo em si não é gravado (limitação)", () => {
  const { updated, result } = rollViaUi({ [PISTOL_ID]: "autofire" });

  // Efeito observável do modo: 10 munições, coerente com o que foi usado.
  assert.equal(ammoOf(updated), INITIAL_AMMO - 10);

  const entry = updated.rollHistory[0];
  assert.ok(entry, "o ataque precisa entrar no histórico");
  assert.equal(entry.type, "attack");
  assert.equal(entry.weaponId, PISTOL_ID);
  assert.equal(entry.attackId, result.attackId, "histórico e resultado apontam para o mesmo ataque");
  assert.equal(updated.lastAttack?.attackId, result.attackId);

  // LIMITAÇÃO: `RollHistoryEntry` e `AttackRollResult` não têm campo `attackMode`;
  // hoje o modo só se manifesta no custo de munição. O campo não foi adicionado
  // nesta tarefa (fora de escopo) — registrado como pendência no relatório.
});
