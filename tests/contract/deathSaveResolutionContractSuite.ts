/**
 * Contrato real do commit de Death Save.
 *
 * Claim e release não possuem RPC própria: a resolução usa a tabela e as
 * funções de `mesa_attack_resolutions`. O driver expõe essa particularidade
 * explicitamente, enquanto o commit é testado pelo método específico.
 */
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import type { ResolutionClaim, ResolutionCommit, ResolutionKey } from "../../src/lib/mesa/infrastructure.ts";

export interface DeathSaveFixture {
  key: ResolutionKey;
  commitInput(token: string, overrides?: Record<string, unknown>): ResolutionCommit<Record<string, unknown>>;
  readResolution(): Promise<Record<string, unknown>>;
  readEffects(): Promise<Record<string, unknown>>;
  cleanup(): Promise<void>;
}

export interface DeathSaveEnvironment {
  claim(key: ResolutionKey): Promise<ResolutionClaim<Record<string, unknown>> | null>;
  release(input: ResolutionKey & { claimToken: string }): Promise<void>;
  commit(input: ResolutionCommit<Record<string, unknown>>): Promise<Record<string, unknown> | null>;
  createFixture(): Promise<DeathSaveFixture>;
  close?(): Promise<void>;
}

export interface DeathSaveContractConfig {
  createEnvironment(): Promise<DeathSaveEnvironment | null>;
  pending(): string;
}

export function deathSaveResolutionContractSuite(config: DeathSaveContractConfig): void {
  let cached: Promise<DeathSaveEnvironment | null> | null = null;
  const environment = (): Promise<DeathSaveEnvironment | null> => {
    cached ??= config.createEnvironment();
    return cached;
  };

  async function withEnvironment(
    context: TestContext,
    body: (environment: DeathSaveEnvironment) => Promise<void>,
  ): Promise<void> {
    const env = await environment();
    if (!env) {
      context.skip(config.pending());
      return;
    }
    await body(env);
  }

  test("Death Save válida confirma resolução e altera somente o estado esperado", async (t) => {
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
          death_save_dc: 10,
          death_save_failures: 1,
          is_dead: false,
          hp_current: 0,
        });
      } finally {
        await fixture.cleanup();
      }
    });
  });

  test("replay e concorrência da mesma Death Save não duplicam o resultado", async (t) => {
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
          death_save_dc: 10,
          death_save_failures: 1,
          is_dead: false,
          hp_current: 0,
        });
      } finally {
        await fixture.cleanup();
      }
    });
  });

  test("conflito CAS não deixa alteração parcial e permite release", async (t) => {
    await withEnvironment(t, async (env) => {
      const fixture = await env.createFixture();
      try {
        const claim = await env.claim(fixture.key);
        const claimToken = claim?.claim_token;
        assert.ok(claimToken);
        await assert.rejects(
          env.commit(fixture.commitInput(claimToken, { p_failures_before: 99 })),
          (error: unknown) => error instanceof Error && error.message.includes("death_save_conflict"),
        );
        assert.deepEqual(await fixture.readEffects(), {
          death_save_dc: 10,
          death_save_failures: 0,
          is_dead: false,
          hp_current: 0,
        });
        await env.release({ ...fixture.key, claimToken });
        assert.equal((await fixture.readResolution()).status, "failed");
      } finally {
        await fixture.cleanup();
      }
    });
  });

  test("resolução de outra sessão não altera o personagem", async (t) => {
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
          death_save_dc: 10,
          death_save_failures: 0,
          is_dead: false,
          hp_current: 0,
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
