/**
 * Alvo Supabase da suíte de contrato de `MesaRepository`.
 *
 * Executa CONTRA O BANCO REAL (PostgreSQL remoto do Supabase, via PostgREST)
 * usando o adaptador em uso em produção. As linhas criadas são de teste, com
 * IDs aleatórios, e a fixture apaga as próprias Mesas ao final.
 *
 * Sem `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (`.env`) os casos são
 * marcados como skip com o motivo explícito — não como aprovados.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { SupabaseMesaRepository } from "../src/lib/mesa/supabaseInfrastructure.ts";
import {
  mesaRepositoryContractSuite,
  type ContractFixture,
} from "./contract/mesaRepositoryContractSuite.ts";

try {
  process.loadEnvFile(".env");
} catch {
  // Sem .env o alvo é skipado, com motivo explícito.
}

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function joinCode(): string {
  return randomUUID().replace(/-/g, "").slice(0, 5).toUpperCase();
}

async function insertSessions(client: SupabaseClient, rows: Array<Record<string, unknown>>, attempt = 0): Promise<void> {
  const { error } = await client.from("mesa_sessions").insert(rows);
  if (error && /duplicate key value/i.test(error.message) && attempt < 3) {
    // join_code é único: colisão é esperada de vez em quando, gera outro.
    const novo = rows.map((row) => ({ ...row, join_code: joinCode() }));
    return insertSessions(client, novo, attempt + 1);
  }
  if (error) throw new Error(`fixture de sessões: ${error.message}`);
}

async function createFixture(client: SupabaseClient): Promise<ContractFixture> {
  const sessionId = randomUUID();
  const otherSessionId = randomUUID();
  const combatId = randomUUID();
  const otherCombatId = randomUUID();

  await insertSessions(client, [
    { id: sessionId, name: "Contrato Mesa A", status: "active", join_code: joinCode() },
    { id: otherSessionId, name: "Contrato Mesa B", status: "active", join_code: joinCode() },
  ]);

  const { error: combatError } = await client.from("mesa_combats").insert([
    { id: combatId, session_id: sessionId, status: "active" },
    { id: otherCombatId, session_id: otherSessionId, status: "active" },
  ]);
  if (combatError) {
    await client.from("mesa_sessions").delete().in("id", [sessionId, otherSessionId]);
    throw new Error(`fixture de combates: ${combatError.message}`);
  }

  return {
    sessionId,
    combatId,
    otherSessionId,
    otherCombatId,
    // Cascata: apagar a Mesa remove combates e combatents dela.
    async cleanup() {
      const { error } = await client.from("mesa_sessions").delete().in("id", [sessionId, otherSessionId]);
      if (error) throw new Error(`limpeza da fixture: ${error.message}`);
    },
  };
}

async function readCombatants(
  client: SupabaseClient,
  scope: { id?: string; combatId?: string; sessionId?: string },
): Promise<Array<Record<string, unknown>>> {
  let request = client.from("mesa_combatants").select("*");
  if (scope.id) request = request.eq("id", scope.id);
  if (scope.combatId) request = request.eq("combat_id", scope.combatId);
  if (scope.sessionId) request = request.eq("session_id", scope.sessionId);
  const { data, error } = await request;
  if (error) throw new Error(`leitura de contrato: ${error.message}`);
  return (data ?? []) as Array<Record<string, unknown>>;
}

mesaRepositoryContractSuite({
  createEnvironment: async () => {
    if (!url || !serviceKey) return null;

    const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    // Credenciais inválidas/devem FALHAR, nunca virar skip silencioso.
    const { error } = await client.from("mesa_sessions").select("id").limit(1);
    if (error) throw new Error(`alvo Supabase indisponível: ${error.message}`);

    return {
      label: "supabase remoto (PostgreSQL real via PostgREST)",
      kind: "supabase",
      repository: new SupabaseMesaRepository(client),
      readCombatants: (scope) => readCombatants(client, scope),
      createFixture: () => createFixture(client),
    };
  },
  pending: () =>
    "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes: contrato não executado contra o Supabase remoto",
});
