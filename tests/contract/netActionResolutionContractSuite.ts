/** Contrato real do commit atômico de NET Action. */
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import type { ResolutionClaim, ResolutionCommit, ResolutionKey } from "../../src/lib/mesa/infrastructure.ts";

export interface NetActionFixture {
  key: ResolutionKey;
  commitInput(token: string, overrides?: Record<string, unknown>): ResolutionCommit<Record<string, unknown>>;
  readResolution(): Promise<Record<string, unknown>>;
  readEffects(): Promise<Record<string, unknown>>;
  cleanup(): Promise<void>;
}

export interface NetActionEnvironment {
  claim(key: ResolutionKey): Promise<ResolutionClaim<Record<string, unknown>> | null>;
  release(input: ResolutionKey & { claimToken: string }): Promise<void>;
  commit(input: ResolutionCommit<Record<string, unknown>>): Promise<Record<string, unknown> | null>;
  createFixture(): Promise<NetActionFixture>;
  close?(): Promise<void>;
}

export interface NetActionContractConfig {
  createEnvironment(): Promise<NetActionEnvironment | null>;
  pending(): string;
}

export function netActionResolutionContractSuite(config: NetActionContractConfig): void {
  let cached: Promise<NetActionEnvironment | null> | null = null;
  const environment = (): Promise<NetActionEnvironment | null> => {
    cached ??= config.createEnvironment();
    return cached;
  };

  async function withEnvironment(
    context: TestContext,
    body: (environment: NetActionEnvironment) => Promise<void>,
  ): Promise<void> {
    const env = await environment();
    if (!env) {
      context.skip(config.pending());
      return;
    }
    await body(env);
  }

  const committedEffects = {
    actions_remaining: 1,
    net_actions_remaining: 1,
    meatspace_action_used_for_netrunning: true,
    discovered_node_ids: ["node-1"],
    architecture_count: 0,
  };
  const initialEffects = {
    actions_remaining: 2,
    net_actions_remaining: 2,
    meatspace_action_used_for_netrunning: false,
    discovered_node_ids: [],
    architecture_count: 0,
  };

  test("NET Action válida confirma estado do Netrunner, descoberta e resolução", async (t) => {
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

  test("replay e concorrência da mesma NET Action não duplicam efeitos", async (t) => {
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

  test("conflito de Actions faz rollback também de descoberta e Architecture", async (t) => {
    await withEnvironment(t, async (env) => {
      const fixture = await env.createFixture();
      try {
        const claim = await env.claim(fixture.key);
        const claimToken = claim?.claim_token;
        assert.ok(claimToken);
        await assert.rejects(
          env.commit(fixture.commitInput(claimToken, { p_actions_before: 99, p_actions_after: 98 })),
          (error: unknown) => error instanceof Error && error.message.includes("action_conflict"),
        );
        assert.deepEqual(await fixture.readEffects(), initialEffects);
        await env.release({ ...fixture.key, claimToken });
        assert.equal((await fixture.readResolution()).status, "failed");
      } finally {
        await fixture.cleanup();
      }
    });
  });

  test("resolução fora da sessão não altera o estado NET", async (t) => {
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
