/**
 * Alvo PostgreSQL LOCAL da suíte de contrato de `MesaRepository`.
 *
 * Executa o MESMO conjunto de casos de `tests/contract/mesaRepositoryContractSuite.ts`
 * contra um PostgreSQL real, local e descartável, usando o adapter mínimo
 * `LocalPostgresMesaRepository` (que implementa apenas o que estes contratos
 * cobrem).
 *
 * Pré-requisitos (documentados em `docs/f1-66-5-local-postgres-validation.md`):
 *   1. servidor PostgreSQL local em execução, com um papel para o usuário atual;
 *   2. banco DESCARTÁVEL criado (ex.: `createdb mesa_contract_test`);
 *   3. migrations aplicadas: `scripts/apply-contract-migrations.sh`;
 *   4. `MESA_LOCAL_TEST_DATABASE_URL=postgres:///mesa_contract_test`.
 *
 * Sem a variável, os casos aparecem como skip com motivo explícito — nunca
 * como aprovados. A URL também é validada aqui: só destino local e banco com
 * nome marcado como descartável são aceitos, para nenhum banco de
 * desenvolvimento/produção ser tocado por engano.
 */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

import { LocalPostgresMesaRepository } from "../src/lib/mesa/localPostgresInfrastructure.ts";
import {
  mesaRepositoryContractSuite,
  type ContractFixture,
} from "./contract/mesaRepositoryContractSuite.ts";

const localUrl = process.env.MESA_LOCAL_TEST_DATABASE_URL;

/** Mesma regra do `scripts/apply-contract-migrations.sh`: local e descartável. */
function disposableDatabaseName(url: string): string | null {
  const withoutScheme = url.replace(/^[^/]*\/\/*/, "").split(/[?#]/)[0];
  const dbName = withoutScheme.split("/").pop() ?? "";
  if (!/(contract|test|tmp|disposable)/.test(dbName)) return null;
  return dbName;
}

function isLocalUrl(url: string): boolean {
  return /^(?:postgresql|postgres):\/\/(?:[^/@]*@)?(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\//.test(url)
    || /^(postgresql|postgres):\/\//.test(url) && !/\/\/[^/@]*@/.test(url);
}

/**
 * `postgres:///banco` (sem host) significa socket unix com autenticação peer.
 * O `pg` cairia em TCP/localhost e falharia em SCRAM; aqui o socket é escolhido
 * explicitamente. URLs com host seguem como `connectionString` normal.
 */
function poolConfig(url: string): { host?: string; database?: string; connectionString?: string } {
  const socket = url.match(/^(?:postgresql|postgres):\/\/(?:[^/@]*@)?\/([^?#]+)/);
  if (socket) {
    return {
      host: process.env.MESA_LOCAL_PG_SOCKET_DIR || "/var/run/postgresql",
      database: socket[1],
    };
  }
  return { connectionString: url };
}

async function createFixture(pool: Pool): Promise<ContractFixture> {
  const sessionId = randomUUID();
  const otherSessionId = randomUUID();
  const combatId = randomUUID();
  const otherCombatId = randomUUID();

  const insertSessions = async (attempt: number): Promise<void> => {
    const codes = [joinCode(), joinCode()];
    try {
      await pool.query(
        "insert into public.mesa_sessions (id, name, status, join_code) values ($1, 'Contrato Mesa A', 'active', $3), ($2, 'Contrato Mesa B', 'active', $4)",
        [sessionId, otherSessionId, codes[0], codes[1]],
      );
    } catch (error) {
      // join_code é único: colisão é esperada de vez em quando, gera outro.
      if (error instanceof Error && /duplicate key value/i.test(error.message) && attempt < 3) {
        return insertSessions(attempt + 1);
      }
      throw error;
    }
  };

  await insertSessions(0);
  try {
    await pool.query(
      "insert into public.mesa_combats (id, session_id, status) values ($1, $3, 'active'), ($2, $4, 'active')",
      [combatId, otherCombatId, sessionId, otherSessionId],
    );
  } catch (error) {
    await pool.query("delete from public.mesa_sessions where id = any($1)", [[sessionId, otherSessionId]]);
    throw error;
  }

  return {
    sessionId,
    combatId,
    otherSessionId,
    otherCombatId,
    // Cascata: apagar a Mesa remove combates e combatents dela.
    async cleanup() {
      await pool.query("delete from public.mesa_sessions where id = any($1)", [[sessionId, otherSessionId]]);
    },
  };
}

function joinCode(): string {
  return randomUUID().replace(/-/g, "").slice(0, 5).toUpperCase();
}

async function readCombatants(
  pool: Pool,
  scope: { id?: string; combatId?: string; sessionId?: string },
): Promise<Array<Record<string, unknown>>> {
  const params: unknown[] = [];
  const filters: string[] = [];
  if (scope.id) {
    params.push(scope.id);
    filters.push(`id = $${params.length}`);
  }
  if (scope.combatId) {
    params.push(scope.combatId);
    filters.push(`combat_id = $${params.length}`);
  }
  if (scope.sessionId) {
    params.push(scope.sessionId);
    filters.push(`session_id = $${params.length}`);
  }
  const where = filters.length ? ` where ${filters.join(" and ")}` : "";
  const result = await pool.query(`select * from public.mesa_combatants${where}`, params);
  return result.rows as Array<Record<string, unknown>>;
}

mesaRepositoryContractSuite({
  createEnvironment: async () => {
    if (!localUrl) return null;

    const dbName = disposableDatabaseName(localUrl);
    if (!dbName || !isLocalUrl(localUrl)) {
      throw new Error(
        "MESA_LOCAL_TEST_DATABASE_URL foi recusada: o destino precisa ser local e o banco precisa estar marcado como descartável (contract/test/tmp/disposable)",
      );
    }

    const pool = new Pool(poolConfig(localUrl));

    // Erro de conexão e schema ausente são coisas diferentes — reportar um
    // pelo outro mascara a causa real.
    try {
      await pool.query("select 1");
    } catch (error) {
      await pool.end();
      throw new Error(
        `não foi possível conectar no PostgreSQL local: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    // Banco sem migrations deve FALHAR com erro claro, nunca virar skip.
    try {
      await pool.query("select id from public.mesa_combatants limit 1");
    } catch (error) {
      await pool.end();
      throw new Error(
        `banco local sem o schema da Mesa? rode scripts/apply-contract-migrations.sh antes: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return {
      label: `postgresql local descartável (banco ${dbName})`,
      kind: "local-postgres",
      repository: new LocalPostgresMesaRepository(pool),
      readCombatants: (scope) => readCombatants(pool, scope),
      createFixture: () => createFixture(pool),
      close: () => pool.end(),
    };
  },
  pending: () =>
    localUrl
      ? "MESA_LOCAL_TEST_DATABASE_URL presente mas ambiente local não montado"
      : "MESA_LOCAL_TEST_DATABASE_URL ausente: contrato não executado contra PostgreSQL local",
});
