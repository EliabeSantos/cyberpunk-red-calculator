/**
 * Suíte de contrato REUTILIZÁVEL de `MesaRepository`.
 *
 * O mesmo conjunto de casos roda contra qualquer alvo que implemente os
 * contratos de `src/lib/mesa/infrastructure.ts`:
 *
 * - `tests/mesa-repository-contract-supabase.test.ts` → adaptador Supabase
 *   (PostgreSQL real via PostgREST, remoto);
 * - `tests/mesa-repository-contract-local.test.ts` → futuro adaptador
 *   PostgreSQL local, contra um banco DESCARTÁVEL com as migrations aplicadas.
 *
 * O que esta suíte prova é comportamento observável do adaptador contra um
 * banco real: resultados persistidos, filtros de escopo, atualização
 * condicional (CAS) e conflito de CAS. Testes com clientes fake
 * (`tests/mesa-infrastructure-contract.test.ts`) só provam MAPEAMENTO de
 * chamadas e nunca são apresentados como equivalência SQL.
 *
 * Quando o alvo não está disponível, os casos são marcados como skip com o
 * motivo explícito: nada aqui é "aprovado" sem execução real.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";

import type { MesaRepository } from "../../src/lib/mesa/infrastructure.ts";

export interface ContractFixture {
  sessionId: string;
  combatId: string;
  otherSessionId: string;
  otherCombatId: string;
  cleanup(): Promise<void>;
}

export interface ContractEnvironment {
  /** Nome do alvo, usado nas mensagens de skip e nos relatórios. */
  label: string;
  kind: "supabase" | "local-postgres";
  repository: MesaRepository;
  /**
   * Leitura direta do banco, FORA do adapter — é o que confere que o adaptador
   * realmente persistiu o que diz ter persistido.
   */
  readCombatants(scope: {
    id?: string;
    combatId?: string;
    sessionId?: string;
  }): Promise<Array<Record<string, unknown>>>;
  /** Cria duas Mesas/combates (FK) e devolve a limpeza delas. */
  createFixture(): Promise<ContractFixture>;
  /** Libera recursos do alvo (pool, conexões) ao fim da suíte. */
  close?(): Promise<void>;
}

export interface ContractSuiteConfig {
  /** Retorna `null` quando o alvo não existe no ambiente. */
  createEnvironment(): Promise<ContractEnvironment | null>;
  /** Motivo do skip — sempre explícito, nunca silencioso. */
  pending(): string;
}

export function mesaRepositoryContractSuite(config: ContractSuiteConfig): void {
  let cached: Promise<ContractEnvironment | null> | null = null;
  const environment = (): Promise<ContractEnvironment | null> => {
    cached ??= config.createEnvironment();
    return cached;
  };

  async function withEnvironment(
    context: TestContext,
    body: (environment: ContractEnvironment) => Promise<void>,
  ): Promise<void> {
    const env = await environment();
    if (!env) {
      context.skip(config.pending());
      return;
    }
    await body(env);
  }

  const enemyRow = (id: string, fixture: ContractFixture, overrides: Record<string, unknown> = {}) => ({
    id,
    combat_id: fixture.combatId,
    session_id: fixture.sessionId,
    kind: "enemy",
    name: "Contrato",
    hp_current: 20,
    hp_max: 20,
    actions_max: 2,
    actions_remaining: 2,
    sort_order: 1,
    ...overrides,
  });

  test("insert persiste payload e escopo (session/combat) no banco", async (t) => {
    await withEnvironment(t, async (env) => {
      const fixture = await env.createFixture();
      try {
        const id = randomUUID();
        await env.repository.insertCombatants(
          [enemyRow(id, fixture, { name: "Alvo de contrato", sort_order: 7 })],
          "Falha ao criar os combatentes",
        );

        const rows = await env.readCombatants({ id });
        assert.equal(rows.length, 1, "a linha precisa existir após o insert");
        assert.equal(rows[0].session_id, fixture.sessionId);
        assert.equal(rows[0].combat_id, fixture.combatId);
        assert.equal(rows[0].kind, "enemy");
        assert.equal(rows[0].name, "Alvo de contrato");
        assert.equal(rows[0].hp_current, 20);
        assert.equal(rows[0].sort_order, 7);
      } finally {
        await fixture.cleanup();
      }
    });
  });

  test("insert de id repetido é erro de infraestrutura e preserva a linha original", async (t) => {
    await withEnvironment(t, async (env) => {
      const fixture = await env.createFixture();
      try {
        const id = randomUUID();
        await env.repository.insertCombatants([enemyRow(id, fixture, { name: "Original" })], "Falha ao criar os combatentes");

        await assert.rejects(
          env.repository.insertCombatants([enemyRow(id, fixture, { name: "Sobrescrita" })], "Falha ao criar os combatentes"),
          (error: unknown) =>
            error instanceof Error && error.message.startsWith("Falha ao criar os combatentes:"),
          "conflito de PK precisa virar erro com o contexto do domínio",
        );

        const rows = await env.readCombatants({ id });
        assert.equal(rows.length, 1);
        assert.equal(rows[0].name, "Original", "nada pode ser sobrescrito silenciosamente");
      } finally {
        await fixture.cleanup();
      }
    });
  });

  test("upsert substitui apenas as colunas do payload e mantém a identidade da linha", async (t) => {
    await withEnvironment(t, async (env) => {
      const fixture = await env.createFixture();
      try {
        const id = randomUUID();
        await env.repository.insertCombatants([enemyRow(id, fixture, { name: "Antes", hp_current: 13 })], "Falha ao criar os combatentes");

        // Identidade completa: combat_id/session_id/kind/name são NOT NULL sem
        // default e o Postgres valida ANTES de resolver o conflito.
        await env.repository.upsertCombatants(
          [{
            id,
            combat_id: fixture.combatId,
            session_id: fixture.sessionId,
            kind: "enemy",
            name: "Depois",
            initiative: 12,
            sort_order: 3,
          }],
          "Falha ao salvar a iniciativa",
        );

        const rows = await env.readCombatants({ id });
        assert.equal(rows.length, 1);
        assert.equal(rows[0].name, "Depois");
        assert.equal(rows[0].initiative, 12);
        assert.equal(rows[0].sort_order, 3);
        assert.equal(rows[0].hp_current, 13, "coluna fora do payload não pode mudar");
      } finally {
        await fixture.cleanup();
      }
    });
  });

  test("leituras respeitam o escopo: outra Mesa nunca devolve a linha", async (t) => {
    await withEnvironment(t, async (env) => {
      const fixture = await env.createFixture();
      try {
        const id = randomUUID();
        await env.repository.insertCombatants([enemyRow(id, fixture)], "Falha ao criar os combatentes");

        const naPropria = await env.repository.findCombatantById(id, {
          sessionId: fixture.sessionId,
          combatId: fixture.combatId,
        });
        assert.equal(naPropria?.id, id);

        const combatErrado = await env.repository.findCombatantById(id, {
          combatId: fixture.otherCombatId,
        });
        assert.equal(combatErrado, null, "escopo de outro combate não pode enxergar a linha");

        const naOutraMesa = await env.repository.findCombatantById(id, {
          sessionId: fixture.otherSessionId,
          combatId: fixture.otherCombatId,
        });
        assert.equal(naOutraMesa, null, "escopo de outra Mesa não pode enxergar a linha");
      } finally {
        await fixture.cleanup();
      }
    });
  });

  test("updateCombatant aplica o patch somente quando o valor anterior confere (CAS)", async (t) => {
    await withEnvironment(t, async (env) => {
      const fixture = await env.createFixture();
      try {
        const id = randomUUID();
        await env.repository.insertCombatants([enemyRow(id, fixture, { hp_current: 20 })], "Falha ao criar os combatentes");

        const aplicado = await env.repository.updateCombatant({
          id,
          sessionId: fixture.sessionId,
          combatId: fixture.combatId,
          patch: { hp_current: 12 },
          expected: { hp_current: 20 },
        });
        assert.equal(aplicado.length, 1, "CAS com valor anterior correto precisa afetar 1 linha");

        const conflito = await env.repository.updateCombatant({
          id,
          sessionId: fixture.sessionId,
          combatId: fixture.combatId,
          patch: { hp_current: 5 },
          expected: { hp_current: 20 },
        });
        assert.equal(conflito.length, 0, "CAS com valor divergente precisa afetar 0 linhas");

        const rows = await env.readCombatants({ id });
        assert.equal(rows[0].hp_current, 12, "o valor que venceu o CAS é o que fica persistido");
      } finally {
        await fixture.cleanup();
      }
    });
  });

  test("updateCombatant com escopo de outra Mesa não altera a linha", async (t) => {
    await withEnvironment(t, async (env) => {
      const fixture = await env.createFixture();
      try {
        const id = randomUUID();
        await env.repository.insertCombatants([enemyRow(id, fixture, { hp_current: 20 })], "Falha ao criar os combatentes");

        const escrita = await env.repository.updateCombatant({
          id,
          sessionId: fixture.otherSessionId,
          combatId: fixture.otherCombatId,
          patch: { hp_current: 1 },
        });
        assert.equal(escrita.length, 0);

        const rows = await env.readCombatants({ id });
        assert.equal(rows[0].hp_current, 20);
      } finally {
        await fixture.cleanup();
      }
    });
  });

  test("deleteCombatants remove apenas o escopo nomeado", async (t) => {
    await withEnvironment(t, async (env) => {
      const fixture = await env.createFixture();
      try {
        const alvo = randomUUID();
        const vizinho = randomUUID();
        const deOutraMesa = randomUUID();
        await env.repository.insertCombatants(
          [
            enemyRow(alvo, fixture),
            enemyRow(vizinho, fixture),
            enemyRow(deOutraMesa, fixture, {
              combat_id: fixture.otherCombatId,
              session_id: fixture.otherSessionId,
            }),
          ],
          "Falha ao criar os combatentes",
        );

        await env.repository.deleteCombatants(
          { id: alvo, combatId: fixture.combatId, sessionId: fixture.sessionId },
          "Falha ao remover o combatente",
        );
        assert.equal((await env.readCombatants({ id: alvo })).length, 0);
        assert.equal((await env.readCombatants({ id: vizinho })).length, 1);
        assert.equal((await env.readCombatants({ id: deOutraMesa })).length, 1);

        await env.repository.deleteCombatants({ combatId: fixture.combatId }, "Falha ao limpar combatentes");
        assert.equal((await env.readCombatants({ combatId: fixture.combatId })).length, 0);
        assert.equal((await env.readCombatants({ combatId: fixture.otherCombatId })).length, 1);
      } finally {
        await fixture.cleanup();
      }
    });
  });

  test("deleteCombatants sem escopo é recusado sem tocar o banco", async (t) => {
    await withEnvironment(t, async (env) => {
      await assert.rejects(
        env.repository.deleteCombatants({} as never, "Falha ao remover o combatente"),
        (error: unknown) =>
          error instanceof Error && error.message.includes("escopo de remoção vazio"),
      );
    });
  });

  test("listCombatantsByCombat usa a ordem canônica sort_order e id", async (t) => {
    await withEnvironment(t, async (env) => {
      const fixture = await env.createFixture();
      try {
        const rows = [
          enemyRow("00000000-0000-0000-0000-000000000003", fixture, { sort_order: 2 }),
          enemyRow("00000000-0000-0000-0000-000000000001", fixture, { sort_order: 1 }),
          enemyRow("00000000-0000-0000-0000-000000000002", fixture, { sort_order: 1 }),
        ];
        await env.repository.insertCombatants([...rows].reverse(), "Falha ao criar os combatentes");
        const listed = await env.repository.listCombatantsByCombat(fixture.combatId, fixture.sessionId);
        assert.deepEqual(listed.map((row) => row.id), [rows[1].id, rows[2].id, rows[0].id]);
      } finally {
        await fixture.cleanup();
      }
    });
  });

  test("updateCombatantHp preserva escopo, CAS e ausência de alteração parcial", async (t) => {
    await withEnvironment(t, async (env) => {
      const fixture = await env.createFixture();
      try {
        const id = randomUUID();
        await env.repository.insertCombatants([enemyRow(id, fixture, { hp_current: 20, hp_max: 30 })], "Falha ao criar os combatentes");
        const wrongScope = await env.repository.updateCombatantHp({
          id,
          sessionId: fixture.otherSessionId,
          combatId: fixture.otherCombatId,
          patch: { hp_current: 1, hp_max: 1 },
          expected: { hp_current: 20 },
        });
        assert.equal(wrongScope.length, 0);
        assert.equal((await env.readCombatants({ id }))[0].hp_current, 20);
        assert.equal((await env.readCombatants({ id }))[0].hp_max, 30);

        const conflict = await env.repository.updateCombatantHp({
          id,
          sessionId: fixture.sessionId,
          combatId: fixture.combatId,
          patch: { hp_current: 1, hp_max: 1 },
          expected: { hp_current: 99 },
        });
        assert.equal(conflict.length, 0);
        assert.equal((await env.readCombatants({ id }))[0].hp_current, 20);
        assert.equal((await env.readCombatants({ id }))[0].hp_max, 30);

        const applied = await env.repository.updateCombatantHp({
          id,
          sessionId: fixture.sessionId,
          combatId: fixture.combatId,
          patch: { hp_current: 12 },
          expected: { hp_current: 20 },
        });
        assert.equal(applied.length, 1);
        assert.equal((await env.readCombatants({ id }))[0].hp_current, 12);
      } finally {
        await fixture.cleanup();
      }
    });
  });

  test("debitCombatantAction é uma operação CAS atômica sob concorrência", async (t) => {
    await withEnvironment(t, async (env) => {
      const fixture = await env.createFixture();
      try {
        const id = randomUUID();
        await env.repository.insertCombatants([enemyRow(id, fixture, {
          actions_remaining: 2,
          movement_remaining: 6,
          is_dead: false,
        })], "Falha ao criar os combatentes");
        const input = {
          id,
          sessionId: fixture.sessionId,
          combatId: fixture.combatId,
          patch: { actions_remaining: 1, movement_remaining: 4 },
          expected: { actions_remaining: 2, movement_remaining: 6, is_dead: false },
        };
        const results = await Promise.all([
          env.repository.debitCombatantAction(input),
          env.repository.debitCombatantAction(input),
        ]);
        assert.deepEqual(results.map((result) => result.length).sort(), [0, 1]);
        const persisted = (await env.readCombatants({ id }))[0];
        assert.equal(persisted.actions_remaining, 1);
        assert.equal(persisted.movement_remaining, 4);
        assert.equal(persisted.is_dead, false);
      } finally {
        await fixture.cleanup();
      }
    });
  });

  // Libera pool/conexões do alvo ao fim do arquivo (no-op quando não há alvo).
  test.after(async () => {
    const env = await environment();
    await env?.close?.();
  });
}
