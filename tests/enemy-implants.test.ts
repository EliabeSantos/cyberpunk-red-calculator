import assert from "node:assert/strict";
import test from "node:test";

import { getEnemyImplants, implantCountForLevel, implantPool } from "../src/data/enemyImplants.ts";
import { catalogItems, getCatalogItem } from "../src/data/items.ts";

test("cota por nível: 1 → 2, 2 → 3, 3 → 4, 4 → 5 implantes", () => {
  assert.equal(implantCountForLevel(1), 2);
  assert.equal(implantCountForLevel(2), 3);
  assert.equal(implantCountForLevel(3), 4);
  assert.equal(implantCountForLevel(4), 5);
});

test("nível fora da faixa é aparado: nunca 0 e nunca acima de 5", () => {
  assert.equal(implantCountForLevel(0), 2, "nível 0 cai no mínimo");
  assert.equal(implantCountForLevel(-3), 2);
  assert.equal(implantCountForLevel(9), 5, "nível 9 cai no teto");
  assert.equal(implantCountForLevel(2.7), 3, "fração arredonda para baixo");
  assert.equal(implantCountForLevel(Number.NaN), 2, "NaN não quebra a cota");
});

test("pool de implantes sai do catálogo de cyberware do jogador", () => {
  const pool = implantPool();
  assert.ok(pool.length > 0, "o pool existe");
  assert.equal(new Set(pool).size, pool.length, "sem nomes repetidos");
  for (const name of pool) {
    const item = catalogItems.find((entry) => entry.name === name);
    assert.ok(item, `nome fora do catálogo: ${name}`);
    assert.equal(item.category, "cyberware", `${name} não é cyberware`);
  }
});

test("sem implante no JSON, o inimigo recebe exatamente a cota do nível", () => {
  for (const level of [1, 2, 3, 4] as const) {
    const implants = getEnemyImplants(undefined, level);
    assert.equal(implants.length, implantCountForLevel(level), `nível ${level}`);
    assert.equal(new Set(implants).size, implants.length, "sem repetição");
    for (const name of implants) {
      assert.ok(implantPool().includes(name), `${name} não veio do catálogo`);
    }
  }
});

test("os implantes do JSON do inimigo vêm primeiro e nunca são removidos", () => {
  const base = ["Grafted Muscle and Bone Lace", "Cyberarm", "Pain Editor", "Kerenzikov", "Cybereye"];
  const implants = getEnemyImplants(base, 1);

  // Nível 1 pede só 2, mas o catálogo do inimigo manda: nada é cortado.
  assert.deepEqual(implants.slice(0, base.length), base, "a base vem inteira e na ordem");
  assert.equal(implants.length, base.length, "nada foi somado por cima da cota");
});

test("a cota é completada com o catálogo, sem repetir o que já veio", () => {
  const implants = getEnemyImplants(["Cyberarm"], 3);

  assert.equal(implants.length, implantCountForLevel(3), "nível 3 → 4 implantes");
  assert.equal(implants[0], "Cyberarm", "o do JSON fica na frente");
  assert.equal(new Set(implants).size, implants.length, "sem duplicata (base repetida não conta)");
  for (const name of implants.slice(1)) {
    assert.ok(implantPool().includes(name), `${name} não veio do catálogo`);
  }
});

test("implantes repetidos ou vazios no JSON são ignorados", () => {
  const implants = getEnemyImplants(["Cybereye", "Cybereye", "  ", "", "Targeting Scope"], 1);
  assert.deepEqual(implants.slice(0, 2), ["Cybereye", "Targeting Scope"]);
  assert.equal(implants.length, 2);
});

test("maior nível = mais implantes (mesma base)", () => {
  const counts = [1, 2, 3, 4].map((level) => getEnemyImplants([], level).length);
  assert.deepEqual(counts, [2, 3, 4, 5]);
  for (let i = 1; i < counts.length; i += 1) {
    assert.ok(counts[i] > counts[i - 1], "a quantidade cresce com o nível");
  }
});

test("o sorteio cobre a cota mesmo com base vazia e pool grande", () => {
  // Garantia de que a cota é alcançável: o catálogo tem mais itens que o teto.
  assert.ok(catalogItems.filter((item) => item.category === "cyberware").length >= 5);
  assert.ok(getCatalogItem("cyberarm"), "cyberarm segue no catálogo");
  assert.equal(getEnemyImplants([], 4).length, 5);
});
