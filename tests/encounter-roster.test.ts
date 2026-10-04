/**
 * F0.4 — o roster do preview é o MESMO roster que a criação materializa.
 *
 * O problema da auditoria era real e foi reproduzido antes da correção. A tela
 * tinha DUAS lógicas independentes de escolher inimigos:
 *
 *   • PREVIEW (`getPreviewEnemies`, dentro de `EncountersPageClient`): filtra
 *     por facção + intervalo de nível e embaralha com a semente do ↻;
 *   • CREATE (`handleStartEncounter`): montava OUTRO pool pelo nível (sem o
 *     predicado de arquétipo, e com fallback para o catálogo INTEIRO quando o
 *     pool vazio) e chamava `createEncounterFromFaction`, que varria o catálogo
 *     na ORDEM, sem semente nenhuma.
 *
 * Reprodução (facção Maelstrom, count 4, seed 0 — mesmo caso da auditoria):
 *
 *   PREVIEW: maelstrom_gunner | maelstrom_techie | maelstrom_cyborg | maelstrom_berserker
 *   CRIADO : maelstrom_scrapper | maelstrom_gunner | maelstrom_berserker | maelstrom_techie
 *
 * 3 das 4 instâncias diferentes e ordem diferente: o Mestre via um roster e
 * jogava outro. O comentário da tela até garantia "mesma semente" — mas a
 * criação nunca leu a semente.
 *
 * A correção centraliza a escolha em `src/lib/encounterRoster.ts`: UM
 * `EncounterRosterRequest` alimenta `buildEncounterRoster` (preview) e
 * `createEncounterFromRoster` (criação), e a criação apenas MATERIALIZA a
 * lista recebida — nada é re-escolhido no caminho. Nenhuma regra de combate
 * mudou: HP, arma, perícia, Evasão e nível do participante continuam vindo do
 * template exatamente como antes.
 *
 * Os 6 testes pedidos cobrem identidade, quantidade, instâncias, ordem,
 * propriedades ajustáveis pela tela e o round trip save → load. O sétimo é a
 * guarda da fonte única: o componente não pode ser executado sem DOM/hooks, então
 * ele assegura que a tela não ganhou um segundo caminho de roster de novo.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { type ThreatLevel } from "../src/data/enemies.ts";
import type { EncounterRosterRequest } from "../src/lib/encounterRoster.ts";
import { createEmptyEnemy, type Enemy } from "../src/types/enemy.ts";

/** window/localStorage mínimo — mesmo padrão de `tests/enemy-skill-ids.test.ts`. */
const storage = new Map<string, string>();
(globalThis as { window?: unknown }).window = {
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  },
};

// Depois do shim: `encounterRoster` puxa `gmStorage` (que lê `window` em runtime).
const { buildEncounterRoster, createEncounterFromRoster } = await import("../src/lib/encounterRoster.ts");
const { loadEncounters, saveEncounter } = await import("../src/lib/gmStorage.ts");
const { gmEnemyCatalog } = await import("../src/data/gm-enemies.ts");

// ---------------------------------------------------------------------------
// Fixtures — catálogos sintéticos para a comparação ser determinística
// ---------------------------------------------------------------------------

const FACTION = "Teste";

function template(id: string, name: string, threatLevel: ThreatLevel): Enemy {
  const enemy = createEmptyEnemy(id);
  return {
    ...enemy,
    identity: { name, archetype: "Gang", threatLevel, faction: FACTION },
    skills: { handgun: { name: "Handgun", stat: "REF", level: 3 } },
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

/** A (low), B (medium), C (high) — nenhum extreme, de propósito (ver teste 5). */
const CATALOG_ABC = [template("a", "Inimigo A", "low"), template("b", "Inimigo B", "medium"), template("c", "Inimigo C", "high")];
const CATALOG_AB = CATALOG_ABC.slice(0, 2);
const CATALOG_A = [CATALOG_ABC[0]];

const request = (overrides: Partial<EncounterRosterRequest> = {}): EncounterRosterRequest => ({
  faction: FACTION,
  minLevel: 1,
  maxLevel: 4,
  count: 3,
  seed: 0,
  ...overrides,
});

const idsOf = (roster: Enemy[]) => roster.map((enemy) => enemy.id);
const enemyIdsOf = (encounter: { participants: Array<{ enemyId: string }> }) =>
  encounter.participants.map((participant) => participant.enemyId);

function occurrences(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

// ---------------------------------------------------------------------------
// Teste 1 — roster simples
// ---------------------------------------------------------------------------

test("Teste 1 — preview e encontro criado são o mesmo roster (A×1, B×1, C×1)", () => {
  const req = request({ count: 3 });
  const preview = buildEncounterRoster(req, CATALOG_ABC);
  const encounter = createEncounterFromRoster("Encontro T1", req, CATALOG_ABC);

  assert.equal(preview.length, 3, "o preview lista 3 inimigos");
  assert.equal(encounter.participants.length, 3, "a criação materializa 3 participantes");
  assert.deepEqual(enemyIdsOf(encounter), idsOf(preview), "identidade E ordem idênticas ao preview");
  assert.deepEqual(
    encounter.participants.map((p) => p.name),
    preview.map((enemy) => enemy.identity.name),
    "cada participante vem do template que a tela mostrou",
  );
  for (const id of ["a", "b", "c"]) {
    assert.equal(occurrences(idsOf(preview)).get(id), 1, `${id} aparece 1× no preview`);
    assert.equal(occurrences(enemyIdsOf(encounter)).get(id), 1, `${id} aparece 1× no encontro`);
  }

  // Reprodução do caso reportado (catálogo REAL, facção Maelstrom, seed 0):
  // era aqui que preview e criação divergiam.
  const real = { faction: "Maelstrom", minLevel: 1, maxLevel: 4, count: 4, seed: 0 };
  const realPreview = buildEncounterRoster(real);
  const realEncounter = createEncounterFromRoster("Reprodução Maelstrom", real);
  assert.equal(realPreview.length, 4);
  assert.deepEqual(
    enemyIdsOf(realEncounter),
    idsOf(realPreview),
    "caso reproduzido da auditoria: o encontro criado agora é exatamente o preview",
  );
  assert.ok(
    gmEnemyCatalog.some((enemy) => enemy.id === realPreview[0]?.id),
    "o roster real vem do catálogo oficial",
  );
});

// ---------------------------------------------------------------------------
// Teste 2 — quantidades repetidas
// ---------------------------------------------------------------------------

test("Teste 2 — quantidades repetidas: A×3 e B×2 chegam inteiras ao encontro", () => {
  const req = request({ count: 5 });
  const preview = buildEncounterRoster(req, CATALOG_AB);
  const encounter = createEncounterFromRoster("Encontro T2", req, CATALOG_AB);

  assert.equal(preview.length, 5, "o preview repete templates até completar 5");
  assert.equal(encounter.participants.length, 5, "o encontro tem 5 participantes");
  assert.deepEqual(enemyIdsOf(encounter), idsOf(preview), "a contagem por inimigo é a mesma dos dois lados");

  const previewCounts = occurrences(idsOf(preview));
  const createdCounts = occurrences(enemyIdsOf(encounter));
  assert.deepEqual([...createdCounts.entries()].sort(), [...previewCounts.entries()].sort(), "multiconjunto idêntico");
  const values = [...createdCounts.values()].sort((x, y) => x - y);
  assert.deepEqual(values, [2, 3], "com 2 elegíveis e pedido 5, o wrap-around dá exatamente 3 e 2");
  assert.equal(createdCounts.get("a"), previewCounts.get("a"));
  assert.equal(createdCounts.get("b"), previewCounts.get("b"));
});

// ---------------------------------------------------------------------------
// Teste 3 — mesma espécie várias vezes
// ---------------------------------------------------------------------------

test("Teste 3 — mesma espécie ×5 vira 5 INSTÂNCIAS, não 1 template", () => {
  const req = request({ count: 5 });
  const preview = buildEncounterRoster(req, CATALOG_A);
  const encounter = createEncounterFromRoster("Encontro T3", req, CATALOG_A);

  assert.equal(preview.length, 5, "preview: 5 slots");
  assert.equal(encounter.participants.length, 5, "encontro: 5 participantes");
  assert.ok(
    encounter.participants.every((participant) => participant.enemyId === "a"),
    "todos apontam para o MESMO template",
  );

  const instanceIds = encounter.participants.map((participant) => participant.id);
  assert.ok(instanceIds.every((id) => typeof id === "string" && id.length > 0), "cada instância tem id próprio");
  assert.equal(new Set(instanceIds).size, 5, "5 IDs ÚNICOS — são instâncias, não uma ficha duplicada");
});

// ---------------------------------------------------------------------------
// Teste 4 — ordem
// ---------------------------------------------------------------------------

test("Teste 4 — ordem: a lista exibida é a ordem dos participantes criados", () => {
  const req = request({ count: 4 }); // 3 elegíveis + wrap-around → A, ?, ?, A
  const preview = buildEncounterRoster(req, CATALOG_ABC);
  const encounter = createEncounterFromRoster("Encontro T4", req, CATALOG_ABC);

  assert.equal(preview.length, 4);
  assert.deepEqual(
    enemyIdsOf(encounter),
    idsOf(preview),
    "posição i do preview = posição i do encontro (a ordem é semântica: é a ordem dos cartões do Mestre)",
  );

  // Mesma semente → mesma lista (a criação lê a MESMA semente do preview).
  assert.deepEqual(buildEncounterRoster(req, CATALOG_ABC), preview, "determinístico para a mesma semente");
  // A semente do ↻ muda o roster — e, por consequência, o encontro criado.
  const bySeed = new Set([0, 1, 2, 3, 4].map((seed) => JSON.stringify(idsOf(buildEncounterRoster({ ...req, seed }, CATALOG_ABC)))));
  assert.ok(bySeed.size > 1, "trocar a semente do ↻ troca o roster");
});

// ---------------------------------------------------------------------------
// Teste 5 — propriedades que o GM ajusta antes de criar
// ---------------------------------------------------------------------------

test("Teste 5 — nome, facção, quantidade, nível e semente chegam ao encontro", () => {
  const name = "Encontro Propriedades";
  const req = request({ count: 2, minLevel: 3, maxLevel: 4 });
  const preview = buildEncounterRoster(req, CATALOG_ABC);
  const encounter = createEncounterFromRoster(name, req, CATALOG_ABC);

  assert.equal(encounter.name, name, "nome digitado na tela");
  assert.equal(encounter.faction, FACTION, "facção escolhida");
  assert.equal(encounter.enemyCount, 2, "quantidade escolhida");
  assert.equal(encounter.participants.length, 2);

  // Intervalo de nível 3–4: só high entra (não há extreme no fixture).
  assert.deepEqual(idsOf(preview), ["c", "c"], "o filtro de nível vale para o preview");
  assert.ok(
    encounter.participants.every((participant) => participant.level >= 3),
    "e para o encontro criado (level deriva do threatLevel do template)",
  );

  // Propriedades de combate vêm do template mostrado (HP, arma, perícia).
  preview.forEach((enemy, index) => {
    assert.equal(encounter.participants[index].hp.max, enemy.combat.hp.max, "HP máximo do template");
    assert.equal(encounter.participants[index].weaponName, enemy.weapons[0]?.name, "arma do template");
    assert.equal(encounter.participants[index].refStat, enemy.stats.REF, "REF do template");
  });

  // Semente: criação usa exatamente a lista que o preview geraria com ela.
  const seeded = { ...req, seed: 7 };
  assert.deepEqual(
    enemyIdsOf(createEncounterFromRoster("s", seeded, CATALOG_ABC)),
    idsOf(buildEncounterRoster(seeded, CATALOG_ABC)),
    "a semente do ↻ vale também na criação",
  );

  // Faixa sem inimigos elegíveis → roster vazio e encontro SEM participantes.
  // (Antes da correção o CREATE caía no fallback `filteredCatalog.length > 0 ?
  // filteredCatalog : gmEnemyCatalog` e criava 4 inimigos de qualquer nível.)
  const emptyRequest = { ...request({ count: 4 }), minLevel: 4, maxLevel: 4 };
  assert.deepEqual(buildEncounterRoster(emptyRequest, CATALOG_ABC), [], "preview vazio, como a tela anuncia");
  assert.equal(
    createEncounterFromRoster("vazio", emptyRequest, CATALOG_ABC).participants.length,
    0,
    "nada é criado quando o preview não tem roster",
  );
  // Facção diferente do catálogo → mesmo comportamento.
  assert.deepEqual(buildEncounterRoster({ ...req, faction: "Inexistente" }, CATALOG_ABC), []);
});

// ---------------------------------------------------------------------------
// Teste 6 — round trip create → save → load
// ---------------------------------------------------------------------------

test("Teste 6 — round trip: criar, salvar e carregar devolve o mesmo roster", () => {
  const req = { faction: "Maelstrom", minLevel: 1, maxLevel: 4, count: 4, seed: 0 };
  const preview = buildEncounterRoster(req);
  const encounter = createEncounterFromRoster("Round trip", req);

  saveEncounter(encounter);
  const loaded = loadEncounters().find((entry) => entry.id === encounter.id);
  assert.ok(loaded, "o encontro gravado é lido de volta");

  assert.equal(loaded.participants.length, preview.length, "mesma quantidade");
  assert.deepEqual(enemyIdsOf(loaded), idsOf(preview), "mesma identidade e mesma ordem que o preview mostrou");
  assert.deepEqual(
    loaded.participants.map((p) => p.id),
    encounter.participants.map((p) => p.id),
    "IDs das instâncias preservados (é a chave do HP na mesa)",
  );
  assert.deepEqual(
    loaded.participants.map((p) => p.name),
    encounter.participants.map((p) => p.name),
    "nomes preservados",
  );
  assert.deepEqual(
    loaded.participants.map((p) => p.hp),
    encounter.participants.map((p) => p.hp),
    "HP preservado",
  );
  assert.equal(loaded.name, encounter.name);
  assert.equal(loaded.faction, encounter.faction);
  assert.equal(loaded.enemyCount, encounter.enemyCount);
});

// ---------------------------------------------------------------------------
// Guarda da fonte única — a tela não pode voltar a montar um roster próprio
// ---------------------------------------------------------------------------

test("guarda — a tela só usa a fonte única (nenhum segundo caminho de roster)", () => {
  const source = readFileSync(new URL("../src/app/gm/encounters/EncountersPageClient.tsx", import.meta.url), "utf8");

  assert.match(source, /buildEncounterRoster\(/, "o preview deriva do módulo único");
  assert.match(source, /createEncounterFromRoster\(/, "a criação deriva do módulo único");
  assert.doesNotMatch(source, /createEncounterFromFaction\(/, "a tela não chama mais a montagem direta");
  assert.doesNotMatch(source, /filteredCatalog/, "sem pool reconstruído no handler de criar");
  assert.doesNotMatch(source, /seededRandom/, "sem PRNG paralelo dentro do componente");
  assert.doesNotMatch(source, /getPreviewEnemies/, "sem lista de preview particular");
});
