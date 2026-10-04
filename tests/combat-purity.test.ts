/**
 * F1.2/F1.4 — Pureza ARQUITETURAL de `src/lib/combat/*` e da infraestrutura
 * de aleatoriedade (`src/lib/dice.ts`, `src/lib/random.ts`).
 *
 * O objetivo da extração foi tirar as regras de combate de um módulo que
 * começa com `import "client-only"` para módulos que qualquer contexto (API,
 * servidor, futuro Combat Engine) consiga carregar. Visualizar os imports não
 * basta: este arquivo prova isso de três jeitos —
 *
 *   1. cada módulo de `src/lib/combat/*` + `dice.ts`/`random.ts` é IMPORTADO
 *      em Node, sem janela nem React, e a carga não lança;
 *   2. o grafo de imports de **runtime** (o que sobrevive à remoção dos
 *      `import type`) nunca alcança `gmStorage.ts` nem nenhum arquivo que
 *      declare `import "client-only"`;
 *   3. nenhum desses módulos referencia `window`/`document`/`localStorage`
 *      nem um import de `react`/`next`/`client-only`/`supabase` — checado
 *      pela AST, então um comentário à mão não engana o teste.
 *
 * Exceção documentada: `combat/adapters.ts` (F1.1) lê o **tipo**
 * `EncounterParticipant` do `gmStorage` — `import type`, apagado em
 * compilação, sem aresta de execução. Trocar para `@/types/encounter` (onde o
 * tipo mora desde este F1.2) é uma linha, mas o F1.1 está fora do escopo da
 * etapa (§11), então fica registrado aqui como pendência.
 *
 * F1.3: a regra canônica `combat/damage.ts` entra nas três checagens
 * automaticamente (o diretório é lido do disco) e, por ser a fonte única do
 * dano, ainda não pode nem citar o `gmStorage`.
 *
 * F1.4: `dice.ts`/`random.ts` entram na mesma rede — o RandomSource não pode
 * ser um caminho para reintroduzir DOM, Supabase ou `gmStorage` no meio das
 * rolagens.
 *
 * F1.5: `combat/engine.ts` (o `execute`) passa pelas mesmas três checagens —
 * ele é quem chama as regras com o `rng` injetado e, por isso, também não
 * pode ser o lugar onde `Math.random` volta a aparecer.
 *
 * F1.7: `serverRandom.ts` (a fonte de aleatoriedade do SERVIDOR) entra na
 * mesma rede — importa `node:crypto` e continua pura: sem DOM, sem sorteio
 * comum e sem caminho para `gmStorage`. É o que prova que uma rolagem
 * server-side pode nascer no servidor sem abrir mão da pureza.
 *
 * Nenhuma configuração de teste/eslint/tsconfig foi tocada por causa disso.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COMBAT_DIR = resolve(ROOT, "src", "lib", "combat");
const GM_STORAGE = resolve(ROOT, "src", "lib", "gmStorage.ts");

/**
 * Módulos que são REGRA pura e portanto não podem nem citar o `gmStorage`
 * (nem como tipo): os extraídos no F1.2, a aplicação canônica de dano do F1.3,
 * a infraestrutura de aleatoriedade do F1.4 e a fonte server-side do F1.7.
 */
const REGRAS_SEM_GMSTORAGE = new Set([
  "enemyAttacks.ts",
  "enemyDamage.ts",
  "enemyConditions.ts",
  "participantSupplies.ts",
  "damage.ts",
  "dice.ts",
  "random.ts",
  "serverRandom.ts",
]);

/** `adapters.ts` ainda lê um TIPO do `gmStorage` (pendência conhecida, F1.1). */
const TIPO_NO_GM_STORAGE_PERMITIDO = new Set(["adapters.ts"]);

const combatFiles: string[] = readdirSync(COMBAT_DIR)
  .filter((name) => name.endsWith(".ts"))
  .sort()
  .map((name) => resolve(COMBAT_DIR, name));

/**
 * F1.4: o RandomSource mora fora de `combat/` (`src/lib/dice.ts`,
 * `src/lib/random.ts`) e passa pelas MESMAS três checagens — não se ignora a
 * nova dependência, cobre-se ela. F1.7: `serverRandom.ts` (a fonte do
 * servidor, `node:crypto`) segue pela mesma lista.
 */
const RANDOMNESS_FILES = ["dice.ts", "random.ts", "serverRandom.ts"].map((name) =>
  resolve(ROOT, "src", "lib", name),
);

/** Tudo que é regra pura e precisa sair limpo destes testes. */
const ruleFiles = [...combatFiles, ...RANDOMNESS_FILES];

const rel = (file: string): string => relative(ROOT, file);

/** Único arquivo autorizado a chamar `Math.random` — o `browserRandom` do F1.4. */
const DICE_FILE = resolve(ROOT, "src", "lib", "dice.ts");

interface ImportRef {
  spec: string;
  /** `import type ...` / `export type ... from` — apagados em compilação. */
  typeOnly: boolean;
}

/** Resolve `@/...` e imports relativos para um arquivo do repositório. */
function resolveSpec(spec: string, from: string): string | null {
  if (spec.startsWith("@/")) {
    const base = resolve(ROOT, "src", spec.slice(2));
    for (const candidate of [`${base}.ts`, `${base}.tsx`, resolve(base, "index.ts")]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
    if (existsSync(base) && statSync(base).isFile()) return base;
    return null;
  }
  if (spec.startsWith(".")) {
    const base = resolve(dirname(from), spec);
    for (const candidate of [`${base}.ts`, `${base}.tsx`, resolve(base, "index.ts")]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
    if (existsSync(base) && statSync(base).isFile()) return base;
    return null;
  }
  return null; // pacote externo: tratado pelo texto do specifier
}

/** Imports/exportações de um arquivo, lidos pela AST (comentários não contam). */
function importRefs(file: string): ImportRef[] {
  if (file.endsWith(".json")) return [];
  const source = readFileSync(file, "utf8");
  const ast = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const refs: ImportRef[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      refs.push({
        spec: node.moduleSpecifier.getText(ast).replace(/^["']|["']$/g, ""),
        typeOnly: Boolean(node.importClause?.isTypeOnly),
      });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      refs.push({
        spec: node.moduleSpecifier.getText(ast).replace(/^["']|["']$/g, ""),
        typeOnly: Boolean(node.isTypeOnly),
      });
    }
    node.forEachChild(visit);
  };
  ast.forEachChild(visit);
  return refs;
}

/** Identificadores de ambiente que um módulo puro não pode usar. */
const AMBIENTE_PROIBIDO = new Set([
  "window",
  "document",
  "localStorage",
  "sessionStorage",
  "supabase",
  "React",
]);

function identificadoresProibidos(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const ast = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const achados: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && AMBIENTE_PROIBIDO.has(node.text)) achados.push(node.text);
    node.forEachChild(visit);
  };
  ast.forEachChild(visit);
  return achados;
}

/**
 * Chamadas reais a `Math.random` na AST — comentário não conta (F1.5): uma
 * regra não pode "usar RandomSource" na documentação e sortear por fora.
 */
function chamadasMathRandom(file: string): number {
  const source = readFileSync(file, "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let total = 0;
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "Math" &&
      node.name.text === "random"
    ) {
      total += 1;
    }
    node.forEachChild(visit);
  };
  ast.forEachChild(visit);
  return total;
}

/* -------------------------------------------------------------------------- *
 * 1. Os módulos carregam fora de um contexto client.
 * -------------------------------------------------------------------------- */

test("cada módulo de src/lib/combat (e dice/random) carrega em Node, sem janela nem React", async () => {
  assert.ok(combatFiles.length >= 7, "esperava os módulos do F1.1 + F1.2 + F1.3");
  assert.ok(
    combatFiles.some((file) => file.endsWith("engine.ts")),
    "F1.5: o motor (engine.ts) tem de estar na rede de pureza",
  );
  assert.equal(RANDOMNESS_FILES.length, 3, "F1.4/F1.7: dice.ts, random.ts e serverRandom.ts entram na rede");

  for (const file of ruleFiles) {
    const modulo: unknown = await import(pathToFileURL(file).href);
    assert.equal(typeof modulo, "object", `${rel(file)} importou`);
  }
});

/* -------------------------------------------------------------------------- *
 * 2. A cadeia de RUNTIME nunca chega em gmStorage/client-only.
 * -------------------------------------------------------------------------- */

test("imports de runtime das regras nunca alcançam gmStorage nem client-only", () => {
  const visitados = new Set<string>();
  const pendentes = [...ruleFiles];

  while (pendentes.length > 0) {
    const file = pendentes.pop();
    if (!file || visitados.has(file)) continue;
    visitados.add(file);

    for (const ref of importRefs(file)) {
      // `import type` não gera aresta de execução — é exatamente o caso do
      // `EncounterParticipant` lido por `adapters.ts`.
      if (ref.typeOnly) continue;
      assert.ok(
        !/^(client-only|react|react-dom|next|@supabase)/.test(ref.spec),
        `${rel(file)} importa runtime "${ref.spec}"`,
      );
      const alvo = resolveSpec(ref.spec, file);
      if (alvo) pendentes.push(alvo);
    }
  }

  for (const file of visitados) {
    assert.notEqual(file, GM_STORAGE, `${rel(file)} entrou pela cadeia de runtime de uma regra`);
    assert.ok(
      !/^\s*import\s+["']client-only["']/m.test(readFileSync(file, "utf8")),
      `${rel(file)} declara import "client-only"`,
    );
  }

  // Garantia de que a travessia não está vazia: um resolvedor quebrado passaria
  // no teste de cima sem olhar dependency nenhuma. Os arquivos de PARTIDA não
  // contam (desde o F1.4 `dice.ts`/`random.ts` já começam fora de `combat/`):
  // só um arquivo alcançado de verdade prova que a rede foi seguida.
  const alcancados = [...visitados].filter((file) => !ruleFiles.includes(file));
  assert.ok(
    alcancados.some((file) => !file.startsWith(COMBAT_DIR)),
    "a travessia saiu dos próprios módulos de combate",
  );
});

/* -------------------------------------------------------------------------- *
 * 3. Nenhum módulo de combate usa DOM/localStorage/Supabase nem importa
 *    gmStorage em tempo de execução.
 * -------------------------------------------------------------------------- */

test("as regras (combate, dano e aleatoriedade) não referenciam DOM, localStorage, Supabase nem gmStorage", () => {
  for (const file of ruleFiles) {
    const nome = file.slice(file.lastIndexOf("/") + 1);

    for (const ref of importRefs(file)) {
      if (resolveSpec(ref.spec, file) !== GM_STORAGE) continue;
      // As regras (extraídas no F1.2 e a aplicação canônica do F1.3) não podem
      // conhecer o gmStorage de jeito nenhum — nem de tipo.
      assert.ok(
        !REGRAS_SEM_GMSTORAGE.has(nome),
        `${rel(file)} (regra pura de combate) importa gmStorage`,
      );
      // O F1.1 ainda lê um TIPO daqui; aresta de execução é proibida.
      assert.ok(
        ref.typeOnly && TIPO_NO_GM_STORAGE_PERMITIDO.has(nome),
        `${rel(file)} importa gmStorage fora de um "import type"`,
      );
    }

    const ambiente = identificadoresProibidos(file);
    assert.deepEqual(
      ambiente,
      [],
      `${rel(file)} referencia ambiente client: ${ambiente.join(", ")}`,
    );
  }
});

/* -------------------------------------------------------------------------- *
 * 4. Nenhuma regra sorteia por fora do RandomSource (F1.5).
 * -------------------------------------------------------------------------- */

test("nenhuma regra chama Math.random direto: a fonte só entra por RandomSource", () => {
  for (const file of ruleFiles) {
    const chamadas = chamadasMathRandom(file);
    const permitidas = file === DICE_FILE ? 1 : 0;
    assert.equal(
      chamadas,
      permitidas,
      file === DICE_FILE
        ? "dice.ts é o ÚNICO lugar autorizado a sortear uma face (browserRandom)"
        : `${rel(file)} chama Math.random: a fonte tem de chegar por RandomSource`,
    );
  }
});
