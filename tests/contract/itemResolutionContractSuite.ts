/**
 * Contrato comum das RPCs de consumo e cura por item.
 *
 * Os drivers devem fornecer fixtures reais (PostgreSQL local ou Supabase).
 * Esta suíte não calcula cura, normaliza inventário nem valida autorização:
 * essas regras continuam no domínio. Ela verifica somente a fronteira
 * transacional exposta pelo ResolutionStore.
 */
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import type { ResolutionClaim, ResolutionCommit, ResolutionKey } from "../../src/lib/mesa/infrastructure.ts";

export type ItemResolutionKind = "consume" | "heal";

export interface ItemResolutionFixture {
  key: ResolutionKey;
  claimToken: string;
  commitInput(token: string, overrides?: Record<string, unknown>): ResolutionCommit<Record<string, unknown>>;
  readResolution(): Promise<Record<string, unknown>>;
  readEffects(): Promise<Record<string, unknown>>;
  cleanup(): Promise<void>;
}

export interface ItemResolutionEnvironment {
  claim(key: ResolutionKey): Promise<ResolutionClaim<Record<string, unknown>> | null>;
  release(input: ResolutionKey & { claimToken: string }): Promise<void>;
  commit(kind: ItemResolutionKind, input: ResolutionCommit<Record<string, unknown>>): Promise<Record<string, unknown> | null>;
  createFixture(kind: ItemResolutionKind): Promise<ItemResolutionFixture>;
  close?(): Promise<void>;
}

export interface ItemResolutionContractConfig {
  createEnvironment(): Promise<ItemResolutionEnvironment | null>;
  pending(): string;
}

export function itemResolutionContractSuite(config: ItemResolutionContractConfig): void {
  let cached: Promise<ItemResolutionEnvironment | null> | null = null;
  const environment = (): Promise<ItemResolutionEnvironment | null> => {
    cached ??= config.createEnvironment();
    return cached;
  };

  async function withEnvironment(
    context: TestContext,
    body: (environment: ItemResolutionEnvironment) => Promise<void>,
  ): Promise<void> {
    const env = await environment();
    if (!env) {
      context.skip(config.pending());
      return;
    }
    await body(env);
  }

  for (const kind of ["consume", "heal"] as const) {
    test(`${kind}: commit válido aplica a resolução e aos efeitos uma única vez`, async (t) => {
      await withEnvironment(t, async (env) => {
        const fixture = await env.createFixture(kind);
        try {
          const claim = await env.claim(fixture.key);
          assert.equal(claim?.claimed, true);
          const result = await env.commit(kind, fixture.commitInput(claim!.claim_token));
          assert.ok(result);
          assert.equal((await fixture.readResolution()).status, "committed");
          assert.deepEqual(await fixture.readEffects(), kind === "consume"
            ? { actions_remaining: 1, inventory_quantity: 0, hp_current: 10 }
            : { actions_remaining: 1, inventory_quantity: 0, hp_current: 15 });
        } finally {
          await fixture.cleanup();
        }
      });
    });

    test(`${kind}: replay e concorrência da mesma resolução não duplicam efeitos`, async (t) => {
      await withEnvironment(t, async (env) => {
          const fixture = await env.createFixture(kind);
          try {
            const claim = await env.claim(fixture.key);
          const claimToken = claim?.claim_token;
          assert.ok(claimToken);
          const input = fixture.commitInput(claimToken);
          const [first, second] = await Promise.all([env.commit(kind, input), env.commit(kind, input)]);
          assert.deepEqual(first, second);
          assert.deepEqual(await fixture.readEffects(), kind === "consume"
            ? { actions_remaining: 1, inventory_quantity: 0, hp_current: 10 }
            : { actions_remaining: 1, inventory_quantity: 0, hp_current: 15 });
        } finally {
          await fixture.cleanup();
        }
      });
    });

    test(`${kind}: CAS inválido falha sem estado parcial e pode ser liberado`, async (t) => {
      await withEnvironment(t, async (env) => {
          const fixture = await env.createFixture(kind);
          try {
            const claim = await env.claim(fixture.key);
          const claimToken = claim?.claim_token;
          assert.ok(claimToken);
          await assert.rejects(
            env.commit(kind, fixture.commitInput(claimToken, { p_actions_before: 99, p_actions_after: 98 })),
            (error: unknown) => error instanceof Error && error.message.includes("consumption_conflict"),
          );
          assert.deepEqual(await fixture.readEffects(), kind === "consume"
            ? { actions_remaining: 2, inventory_quantity: 1, hp_current: 10 }
            : { actions_remaining: 2, inventory_quantity: 1, hp_current: 10 });
          await env.release({ ...fixture.key, claimToken });
          assert.equal((await fixture.readResolution()).status, "failed");
        } finally {
          await fixture.cleanup();
        }
      });
    });

    test(`${kind}: claim é isolado pela chave completa da resolução`, async (t) => {
      await withEnvironment(t, async (env) => {
        const fixture = await env.createFixture(kind);
        try {
          const claim = await env.claim(fixture.key);
          assert.equal(claim?.claimed, true);
          const wrong = fixture.commitInput(claim!.claim_token);
          wrong.sessionId = `${fixture.key.sessionId.slice(0, -1)}${fixture.key.sessionId.endsWith("0") ? "1" : "0"}`;
          wrong.rpcArgs = { ...wrong.rpcArgs, p_session_id: wrong.sessionId };
          await assert.rejects(env.commit(kind, wrong));
          assert.equal((await fixture.readResolution()).status, "processing");
        } finally {
          await fixture.cleanup();
        }
      });
    });
  }

  test.after(async () => {
    await (await environment())?.close?.();
  });
}
