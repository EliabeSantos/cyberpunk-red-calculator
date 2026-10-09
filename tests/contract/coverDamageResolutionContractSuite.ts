/** Contrato real do commit atômico de dano à cobertura. */
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import type { ResolutionClaim, ResolutionCommit, ResolutionKey } from "../../src/lib/mesa/infrastructure.ts";

export interface CoverDamageFixture {
  key: ResolutionKey;
  commitInput(token: string, overrides?: Record<string, unknown>): ResolutionCommit<Record<string, unknown>>;
  readResolution(): Promise<Record<string, unknown>>;
  readEffects(): Promise<Record<string, unknown>>;
  cleanup(): Promise<void>;
}

export interface CoverDamageEnvironment {
  claim(key: ResolutionKey): Promise<ResolutionClaim<Record<string, unknown>> | null>;
  release(input: ResolutionKey & { claimToken: string }): Promise<void>;
  commit(input: ResolutionCommit<Record<string, unknown>>): Promise<Record<string, unknown> | null>;
  createFixture(): Promise<CoverDamageFixture>;
  close?(): Promise<void>;
}

export interface CoverDamageContractConfig {
  createEnvironment(): Promise<CoverDamageEnvironment | null>;
  pending(): string;
}

export function coverDamageResolutionContractSuite(config: CoverDamageContractConfig): void {
  let cached: Promise<CoverDamageEnvironment | null> | null = null;
  const environment = (): Promise<CoverDamageEnvironment | null> => {
    cached ??= config.createEnvironment();
    return cached;
  };

  async function withEnvironment(
    context: TestContext,
    body: (environment: CoverDamageEnvironment) => Promise<void>,
  ): Promise<void> {
    const env = await environment();
    if (!env) {
      context.skip(config.pending());
      return;
    }
    await body(env);
  }

  test("dano válido atualiza a cobertura, Actions, munição e resolução", async (t) => {
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
        assert.deepEqual(await fixture.readEffects(), {
          actions_remaining: 1,
          ammo: { weapon: 2 },
          cover_hp: 13,
          destroyed: false,
        });
      } finally {
        await fixture.cleanup();
      }
    });
  });

  test("replay e concorrência da mesma resolução não duplicam dano ou custo", async (t) => {
    await withEnvironment(t, async (env) => {
      const fixture = await env.createFixture();
      try {
        const claim = await env.claim(fixture.key);
        const claimToken = claim?.claim_token;
        assert.ok(claimToken);
        const input = fixture.commitInput(claimToken);
        const [first, second] = await Promise.all([env.commit(input), env.commit(input)]);
        assert.deepEqual(first, second);
        assert.deepEqual(await fixture.readEffects(), {
          actions_remaining: 1,
          ammo: { weapon: 2 },
          cover_hp: 13,
          destroyed: false,
        });
      } finally {
        await fixture.cleanup();
      }
    });
  });

  test("conflito de HP da cobertura faz rollback também do ator", async (t) => {
    await withEnvironment(t, async (env) => {
      const fixture = await env.createFixture();
      try {
        const claim = await env.claim(fixture.key);
        const claimToken = claim?.claim_token;
        assert.ok(claimToken);
        await assert.rejects(
          env.commit(fixture.commitInput(claimToken, { p_hp_before: 99 })),
          (error: unknown) => error instanceof Error && error.message.includes("cover_hp_conflict"),
        );
        assert.deepEqual(await fixture.readEffects(), {
          actions_remaining: 2,
          ammo: { weapon: 3 },
          cover_hp: 20,
          destroyed: false,
        });
        await env.release({ ...fixture.key, claimToken });
        assert.equal((await fixture.readResolution()).status, "failed");
      } finally {
        await fixture.cleanup();
      }
    });
  });

  test("resolução fora da sessão não altera ator nem cobertura", async (t) => {
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
        assert.deepEqual(await fixture.readEffects(), {
          actions_remaining: 2,
          ammo: { weapon: 3 },
          cover_hp: 20,
          destroyed: false,
        });
      } finally {
        await fixture.cleanup();
      }
    });
  });

  test.after(async () => {
    await (await environment())?.close?.();
  });
}
