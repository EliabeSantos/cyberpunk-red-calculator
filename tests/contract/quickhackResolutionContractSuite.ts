/** Contrato real do commit atômico de Quickhack. */
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import type { ResolutionClaim, ResolutionCommit, ResolutionKey } from "../../src/lib/mesa/infrastructure.ts";

export interface QuickhackFixture {
  key: ResolutionKey;
  commitInput(token: string, overrides?: Record<string, unknown>): ResolutionCommit<Record<string, unknown>>;
  readResolution(): Promise<Record<string, unknown>>;
  readEffects(): Promise<Record<string, unknown>>;
  cleanup(): Promise<void>;
}

export interface QuickhackEnvironment {
  claim(key: ResolutionKey): Promise<ResolutionClaim<Record<string, unknown>> | null>;
  release(input: ResolutionKey & { claimToken: string }): Promise<void>;
  commit(input: ResolutionCommit<Record<string, unknown>>): Promise<Record<string, unknown> | null>;
  createFixture(): Promise<QuickhackFixture>;
  close?(): Promise<void>;
}

export interface QuickhackContractConfig {
  createEnvironment(): Promise<QuickhackEnvironment | null>;
  pending(): string;
}

export function quickhackResolutionContractSuite(config: QuickhackContractConfig): void {
  let cached: Promise<QuickhackEnvironment | null> | null = null;
  const environment = (): Promise<QuickhackEnvironment | null> => {
    cached ??= config.createEnvironment();
    return cached;
  };

  async function withEnvironment(
    context: TestContext,
    body: (environment: QuickhackEnvironment) => Promise<void>,
  ): Promise<void> {
    const env = await environment();
    if (!env) {
      context.skip(config.pending());
      return;
    }
    await body(env);
  }

  const initialEffects = {
    actions_remaining: 2,
    target_hp: 20,
    target_dead: false,
    target_effect_count: 0,
    target_condition_count: 0,
    target_supply_quantity: 1,
  };
  const committedEffects = {
    actions_remaining: 1,
    target_hp: 15,
    target_dead: false,
    target_effect_count: 1,
    target_condition_count: 1,
    target_supply_quantity: 0,
  };

  test("Quickhack válido confirma ator, efeitos do alvo e resolução", async (t) => {
    await withEnvironment(t, async (env) => {
      const fixture = await env.createFixture();
      try {
        const claim = await env.claim(fixture.key);
        const claimToken = claim?.claim_token;
        assert.equal(claim?.claimed, true);
        assert.ok(claimToken);
        const result = await env.commit(fixture.commitInput(claimToken));
        assert.ok(result);
        assert.equal((await fixture.readResolution()).status, "committed");
        assert.deepEqual(await fixture.readEffects(), committedEffects);
      } finally {
        await fixture.cleanup();
      }
    });
  });

  test("replay e concorrência não duplicam Quickhack nem consumo de alvo", async (t) => {
    await withEnvironment(t, async (env) => {
      const fixture = await env.createFixture();
      try {
        const claim = await env.claim(fixture.key);
        const claimToken = claim?.claim_token;
        assert.ok(claimToken);
        const input = fixture.commitInput(claimToken);
        const [first, second] = await Promise.all([env.commit(input), env.commit(input)]);
        assert.deepEqual(first, second);
        assert.deepEqual(await fixture.readEffects(), committedEffects);
      } finally {
        await fixture.cleanup();
      }
    });
  });

  test("conflito do alvo não deixa Actions ou efeitos parciais", async (t) => {
    await withEnvironment(t, async (env) => {
      const fixture = await env.createFixture();
      try {
        const claim = await env.claim(fixture.key);
        const claimToken = claim?.claim_token;
        assert.ok(claimToken);
        await assert.rejects(
          env.commit(fixture.commitInput(claimToken, { p_target_hp_before: 99 })),
          (error: unknown) => error instanceof Error && error.message.includes("target_state_conflict"),
        );
        assert.deepEqual(await fixture.readEffects(), initialEffects);
        await env.release({ ...fixture.key, claimToken });
        assert.equal((await fixture.readResolution()).status, "failed");
      } finally {
        await fixture.cleanup();
      }
    });
  });

  test("resolução fora da sessão não altera ator nem alvo", async (t) => {
    await withEnvironment(t, async (env) => {
      const fixture = await env.createFixture();
      try {
        const claim = await env.claim(fixture.key);
        const claimToken = claim?.claim_token;
        assert.ok(claimToken);
        const wrong = fixture.commitInput(claimToken);
        wrong.sessionId = `${fixture.key.sessionId.slice(0, -1)}${fixture.key.sessionId.endsWith("0") ? "1" : "0"}`;
        wrong.rpcArgs = { ...wrong.rpcArgs, p_session_id: wrong.sessionId };
        await assert.rejects(env.commit(wrong));
        assert.deepEqual(await fixture.readEffects(), initialEffects);
      } finally {
        await fixture.cleanup();
      }
    });
  });

  test.after(async () => {
    await (await environment())?.close?.();
  });
}
