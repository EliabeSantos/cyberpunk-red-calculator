/**
 * F0.5 — identidade do participante na seleção/reordenação de iniciativa.
 *
 * O bug: a tela de encontros guardava a seleção como **índice**
 * (`useState<number | null>` + `selectedParticipant === index`) e o cartão usava
 * `key={index}`. Existe UMA reordenação real de `encounter.participants` —
 * `handleRollInitiative` reescreve a lista ordenada por total — então depois da
 * rolagem o índice parado na seleção apontava para outro inimigo:
 *
 *   antes : A | B | C     GM seleciona B (índice 1) → destaque em B
 *   depois: C | A | B     índice 1 = A → destaque e painel de dano/condições
 *                         migraram para o A (reproduzido antes da correção)
 *
 * A correção guarda o **id** (`selectedParticipantId`) e deriva o participante
 * com `findParticipantById` (`src/lib/participantSelection.ts`); o cartão passa
 * a usar `key={p.id}`. A ordem de iniciativa, as rolagens e o armazenamento não
 * mudaram nada — os testes só protegem a identidade.
 *
 * Participantes vêm do `createEncounterFromRoster` (F0.4): mesmas instâncias
 * reais que a tela usa, com `id` único gerado no nascimento de cada uma.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { type ThreatLevel } from "../src/data/enemies.ts";
import type { EncounterParticipant } from "../src/lib/gmStorage.ts";
import { createEmptyEnemy, type Enemy } from "../src/types/enemy.ts";

/** window/localStorage mínimo — mesmo padrão dos outros testes de GM. */
const storage = new Map<string, string>();
(globalThis as { window?: unknown }).window = {
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  },
};

const { createEncounterFromRoster } = await import("../src/lib/encounterRoster.ts");
const { findParticipantById, toggleParticipantSelection } = await import("../src/lib/participantSelection.ts");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FACTION = "Teste";

function template(id: string, name: string, threatLevel: ThreatLevel): Enemy {
  const enemy = createEmptyEnemy(id);
  return {
    ...enemy,
    identity: { name, archetype: "Gang", threatLevel, faction: FACTION },
    weapons: [
      {
        id: `${id}-arma`,
        name: "Medium Pistol",
        damage: "2d6",
        attackType: "ranged",
        skill: "handgun",
        attackBase: 12,
        rateOfFire: 2,
        magazine: 12,
        ammo: 12,
      },
    ],
  };
}

/** Três espécies diferentes (A, B, C) — ordem inicial do cenário da tarefa. */
const CATALOG_ABC = [template("a", "Inimigo A", "low"), template("b", "Inimigo B", "medium"), template("c", "Inimigo C", "high")];

function roster(catalog: Enemy[], count: number): EncounterParticipant[] {
  const encounter = createEncounterFromRoster("F0.5", {
    faction: FACTION,
    minLevel: 1,
    maxLevel: 4,
    count,
    seed: 0,
  }, catalog);
  assert.equal(encounter.participants.length, count, "fixture: o encontro tem o roster pedido");
  return encounter.participants;
}

/** Seleciona um participante e devolve o id guardado (o que a UI guarda hoje). */
function select(participant: EncounterParticipant): string | null {
  return toggleParticipantSelection(null, participant.id ?? null);
}

/**
 * Reordenação como `handleRollInitiative` faz: a lista NOVA mantém os mesmos
 * objetos (`{ ...r.participant, initiative }`), só a ORDEM muda.
 */
function reorderByInitiative(
  participants: readonly EncounterParticipant[],
  totals: Record<string, number>,
): EncounterParticipant[] {
  return [...participants].sort((a, b) => (totals[b.id ?? ""] ?? 0) - (totals[a.id ?? ""] ?? 0));
}

// ---------------------------------------------------------------------------
// Teste 1 — seleção sobrevive à reordenação
// ---------------------------------------------------------------------------

test("Teste 1 — seleciona B, reordena para C A B, e a seleção continua em B", () => {
  const [a, b, c] = roster(CATALOG_ABC, 3);
  const selectedId = select(b);

  assert.equal(findParticipantById([a, b, c], selectedId), b, "antes da reordenação: B");

  const reordered = [c, a, b]; // C A B
  assert.equal(findParticipantById(reordered, selectedId), b, "depois: continua sendo B");
  assert.notEqual(findParticipantById(reordered, selectedId), a, "e NÃO A (a posição antiga de B)");
  assert.equal(reordered[1], a, "a posição 1 agora é o A — é exatamente onde o índice antigo apontava");
});

// ---------------------------------------------------------------------------
// Teste 2 — primeiro participante muda
// ---------------------------------------------------------------------------

test("Teste 2 — seleciona A, reordena para C B A, e a seleção continua em A", () => {
  const [a, b, c] = roster(CATALOG_ABC, 3);
  const selectedId = select(a);

  const reordered = [c, b, a]; // C B A
  assert.equal(reordered[0], c, "a primeira posição passou a ser o C");
  assert.equal(findParticipantById(reordered, selectedId), a, "seleção continua em A");
  assert.notEqual(findParticipantById(reordered, selectedId), c, "não migra para quem ocupou a posição");
});

// ---------------------------------------------------------------------------
// Teste 3 — último participante muda
// ---------------------------------------------------------------------------

test("Teste 3 — seleciona C, reordena, e a seleção continua em C", () => {
  const [a, b, c] = roster(CATALOG_ABC, 3);
  const selectedId = select(c);

  // Ordem do enunciado: C continua no fim (caso em que o índice antigo
  // "funcionaria" por acidente).
  const staysLast = [b, a, c];
  assert.equal(findParticipantById(staysLast, selectedId), c, "B A C → seleção em C");

  // C também deixa de ser o último: aí o índice antigo apontaria para o A.
  const movesAway = [c, b, a];
  assert.equal(findParticipantById(movesAway, selectedId), c, "A última posição agora é o A, mas a seleção é C");
  assert.equal(movesAway[2], a);
});

// ---------------------------------------------------------------------------
// Teste 4 — participantes com nomes iguais
// ---------------------------------------------------------------------------

test("Teste 4 — três participantes chamados 'Ganger': a seleção é o id, não o nome", () => {
  const catalog = [
    template("ganger-1", "Ganger", "low"),
    template("ganger-2", "Ganger", "medium"),
    template("ganger-3", "Ganger", "high"),
  ];
  const participants = roster(catalog, 3);
  const [, segundo] = participants;

  assert.ok(
    participants.every((participant) => participant.name === "Ganger"),
    "os três têm o MESMO nome — nome não identifica ninguém",
  );
  assert.equal(new Set(participants.map((participant) => participant.id)).size, 3, "ids distintos");

  const selectedId = select(segundo);
  const reordered = [...participants].reverse();

  const selected = findParticipantById(reordered, selectedId);
  assert.equal(selected?.id, segundo.id, "a seleção continua exatamente no id=2");
  assert.equal(selected, segundo, "é o MESMO objeto/participante, não outro Ganger");
  assert.notEqual(selected, participants[2], "nem o Ganger que ocupou a posição dele");
});

// ---------------------------------------------------------------------------
// Teste 5 — participantes repetidos do mesmo template
// ---------------------------------------------------------------------------

test("Teste 5 — 3 instâncias do mesmo template: seleciona a 2ª e ela continua selecionada", () => {
  const templateScrapper = template("scrapper", "Scrapper", "low");
  const participants = roster([templateScrapper], 3);

  assert.ok(
    participants.every((participant) => participant.enemyId === "scrapper"),
    "as três apontam para o MESMO template (F0.4: template ≠ instância)",
  );
  assert.equal(new Set(participants.map((participant) => participant.id)).size, 3, "3 instâncias com id próprio");

  const instance2 = participants[1];
  const selectedId = select(instance2);
  const reordered = [participants[2], participants[0], participants[1]];

  const selected = findParticipantById(reordered, selectedId);
  assert.equal(selected?.id, instance2.id, "a seleção ficou na instance-2");
  assert.equal(selected, instance2, "e não em instance-1 ou instance-3");
  assert.equal(selected?.enemyId, "scrapper", "todas continuam do mesmo template — só o id da instância distingue");
});

// ---------------------------------------------------------------------------
// Teste 6 — remoção de participante
// ---------------------------------------------------------------------------

test("Teste 6 — remoção: sobrevive se o selecionado ficou; some se ele saiu", () => {
  // A tela NÃO tem ação de remover participante hoje (só `removeParticipantCondition`,
  // que remove condição) — o teste protege o invariante caso apareça.
  const [a, b, c] = roster(CATALOG_ABC, 3);
  const selectedId = select(b);

  // Remove A (o selecionado não é o removido).
  const withoutA = [b, c];
  assert.equal(findParticipantById(withoutA, selectedId), b, "seleção continua em B");

  // Remove B (o selecionado saiu) → seleção explicitamente inválida (null),
  // nunca caindo no participante que ocupou a posição.
  const withoutB = [a, c];
  assert.equal(findParticipantById(withoutB, selectedId), null, "sem seleção quando o id sumiu");
  assert.equal(findParticipantById(withoutB, selectedId), null);
  assert.notEqual(findParticipantById(withoutB, selectedId), a);
  assert.notEqual(findParticipantById(withoutB, selectedId), c);

  // Sem seleção nenhuma → null (nada é "selecionado por padrão").
  assert.equal(findParticipantById([a, b, c], null), null);
  // Participante antigo sem id não pode virar seleção por posição.
  assert.equal(findParticipantById([a, b, c], ""), null);
});

// ---------------------------------------------------------------------------
// Teste extra — a reordenação REAL (rolagem de iniciativa)
// ---------------------------------------------------------------------------

test("Teste 7 — rolagem de iniciativa (a reordenação que existe no código)", () => {
  const [a, b, c] = roster(CATALOG_ABC, 3);
  const selectedId = select(b);

  // Espelha `handleRollInitiative`: ordena por total DESC e regrava a lista.
  const afterRoll = reorderByInitiative([a, b, c], { [a.id!]: 12, [b.id!]: 8, [c.id!]: 15 });

  assert.deepEqual(afterRoll.map((participant) => participant.id), [c.id, a.id, b.id], "C (15) > A (12) > B (8)");
  assert.equal(findParticipantById(afterRoll, selectedId), b, "seleção continua no B, que rolou baixo");

  // O que a lógica antiga destacaria (índice parado em 1):
  assert.equal(afterRoll[1], a, "com índice, o painel de dano/condições teria ido para o A");
});

// ---------------------------------------------------------------------------
// Guarda — a tela identifica participante por ID, não por posição
// ---------------------------------------------------------------------------

test("guarda — a tela usa id estável na seleção e nas keys dos cartões", () => {
  const source = readFileSync(new URL("../src/app/gm/encounters/EncountersPageClient.tsx", import.meta.url), "utf8");

  assert.match(source, /selectedParticipantId/, "estado guarda o id");
  assert.match(source, /findParticipantById\(/, "participante derivado do id");
  assert.match(source, /toggleParticipantSelection\(/, "clique compara id com id");
  assert.match(source, /key=\{p\.id\}/, "cartão do participante usa a identidade estável");
  assert.doesNotMatch(source, /const \[selectedParticipant, setSelectedParticipant\]/, "sem estado por índice");
  assert.doesNotMatch(source, /selectedParticipant === index/, "sem comparação por posição");
  assert.doesNotMatch(source, /handleSelectParticipant\(index\)/, "clique não passa posição");
  assert.doesNotMatch(source, /key=\{index\}/, "lista de participantes sem key de índice");

  // A ordem de iniciativa NÃO foi tocada (F0.5 não muda regra).
  assert.match(source, /rolled\.sort\(\(a, b\) => b\.total - a\.total\)/, "ordenação de iniciativa intacta");
  assert.match(source, /rollDice\("1d10"\)/, "fórmula de iniciativa intacta");
});
