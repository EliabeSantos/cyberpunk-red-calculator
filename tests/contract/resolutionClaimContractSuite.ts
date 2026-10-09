/**
 * Contrato compartilhado das máquinas de resolução de ataque e reload.
 *
 * Este arquivo somente registra casos de teste; os alvos local/Supabase
 * fornecem drivers reais e fixtures descartáveis. Não há fake usado como
 * prova de locks ou transações.
 */
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import type {
  ResolutionClaim,
  ResolutionCommit,
  ResolutionKey,
  ResolutionRecoveryRecord,
} from "../../src/lib/mesa/infrastructure.ts";

export type ResolutionFamily = "attack" | "reload";

export interface ResolutionFixture {
  family: ResolutionFamily;
  key: ResolutionKey;
  claimToken: string;
  commitInput(claimToken: string): ResolutionCommit<Record<string, unknown>>;
  abandonClaim(): Promise<void>;
  readResolution(): Promise<Record<string, unknown>>;
  readEffects(): Promise<Record<string, unknown>>;
  cleanup(): Promise<void>;
}

export interface ResolutionClaimEnvironment {
  label: string;
  claim(family: ResolutionFamily, key: ResolutionKey): Promise<ResolutionClaim<Record<string, unknown>> | null>;
  recover(family: ResolutionFamily, key: ResolutionKey): Promise<ResolutionRecoveryRecord<Record<string, unknown>> | null>;
  release(family: ResolutionFamily, key: ResolutionKey & { claimToken: string }): Promise<void>;
  commit(family: ResolutionFamily, input: ResolutionCommit<Record<string, unknown>>): Promise<Record<string, unknown> | null>;
  createFixture(family: ResolutionFamily): Promise<ResolutionFixture>;
  close?(): Promise<void>;
}

export interface ResolutionClaimContractConfig {
  createEnvironment(): Promise<ResolutionClaimEnvironment | null>;
  pending(): string;
}

export function resolutionClaimContractSuite(config: ResolutionClaimContractConfig): void {
  let cached: Promise<ResolutionClaimEnvironment | null> | null = null;
  const environment = (): Promise<ResolutionClaimEnvironment | null> => {
    cached ??= config.createEnvironment();
    return cached;
  };

  async function withEnvironment(
    context: TestContext,
    body: (environment: ResolutionClaimEnvironment) => Promise<void>,
  ): Promise<void> {
    const env = await environment();
    if (!env) {
      context.skip(config.pending());
      return;
    }
    await body(env);
  }

  for (const family of ["attack", "reload"] as const) {
    test(`${family}: claim inicial e repetição preservam token e estado`, async (t) => {
      await withEnvironment(t, async (env) => {
        const fixture = await env.createFixture(family);
        try {
          const first = await env.claim(family, fixture.key);
          assert.equal(first?.claimed, true);
          assert.equal(first?.status, "processing");
          const second = await env.claim(family, fixture.key);
          assert.equal(second?.claimed, false);
          assert.equal(second?.status, "processing");
          assert.equal(second?.claim_token, first?.claim_token);
        } finally {
          await fixture.cleanup();
        }
      });
    });

    test(`${family}: claims concorrentes têm uma dona e um observador`, async (t) => {
      await withEnvironment(t, async (env) => {
        const fixture = await env.createFixture(family);
        try {
          const [first, second] = await Promise.all([
            env.claim(family, fixture.key),
            env.claim(family, fixture.key),
          ]);
          assert.deepEqual([first?.claimed, second?.claimed].sort(), [false, true]);
          assert.equal(first?.claim_token, second?.claim_token);
        } finally {
          await fixture.cleanup();
        }
      });
    });

    test(`${family}: recovery de claim abandonado torna a resolução failed`, async (t) => {
      await withEnvironment(t, async (env) => {
        const fixture = await env.createFixture(family);
        try {
          await env.claim(family, fixture.key);
          await fixture.abandonClaim();
          const recovered = await env.recover(family, fixture.key);
          assert.equal(recovered?.status, "failed");
          assert.equal((await fixture.readResolution()).status, "failed");
        } finally {
          await fixture.cleanup();
        }
      });
    });

    test(`${family}: release após falha não aplica efeitos`, async (t) => {
      await withEnvironment(t, async (env) => {
        const fixture = await env.createFixture(family);
        try {
          const claim = await env.claim(family, fixture.key);
          assert.ok(claim?.claim_token);
           await env.release(family, { ...fixture.key, claimToken: claim.claim_token });
           assert.equal((await fixture.readResolution()).status, "failed");
           assert.deepEqual(await fixture.readEffects(), fixture.family === "attack"
             ? { actions_remaining: 2, hp_current: 10 }
             : { actions_remaining: 2, combat_ammo: { weapon: 1 } });
        } finally {
          await fixture.cleanup();
        }
      });
    });

    test(`${family}: commit e replay pelo mesmo resolutionId não duplicam efeitos`, async (t) => {
      await withEnvironment(t, async (env) => {
        const fixture = await env.createFixture(family);
        try {
          const claim = await env.claim(family, fixture.key);
          assert.ok(claim?.claim_token);
          const input = fixture.commitInput(claim.claim_token);
          const first = await env.commit(family, input);
          const second = await env.commit(family, input);
          assert.ok(first);
          assert.deepEqual(second, first);
          assert.equal((await fixture.readResolution()).status, "committed");
        } finally {
          await fixture.cleanup();
        }
      });
    });

    test(`${family}: claim/commit fora do escopo não altera resolução nem combatente`, async (t) => {
      await withEnvironment(t, async (env) => {
         const fixture = await env.createFixture(family);
         try {
           const claim = await env.claim(family, fixture.key);
           assert.equal(claim?.claimed, true);
           const last = fixture.key.sessionId.slice(-1);
          const wrongKey = { ...fixture.key, sessionId: `${fixture.key.sessionId.slice(0, -1)}${last === "0" ? "1" : "0"}` };
          const recovered = await env.recover(family, wrongKey);
          assert.equal(recovered?.status, "missing");
          const wrongInput = fixture.commitInput(fixture.claimToken);
          wrongInput.claimToken = "00000000-0000-0000-0000-000000000001";
          wrongInput.rpcArgs = {
            ...wrongInput.rpcArgs,
            p_claim_token: wrongInput.claimToken,
          };
          await assert.rejects(
            env.commit(family, wrongInput),
          );
           assert.equal((await fixture.readResolution()).status, "processing");
           assert.deepEqual(await fixture.readEffects(), fixture.family === "attack"
             ? { actions_remaining: 2, hp_current: 10 }
             : { actions_remaining: 2, combat_ammo: { weapon: 1 } });
        } finally {
          await fixture.cleanup();
        }
      });
    });
  }

  test.after(async () => {
    const env = await environment();
    await env?.close?.();
  });
}
