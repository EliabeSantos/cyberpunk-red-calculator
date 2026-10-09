/**
 * Contrato real da RPC commit_mesa_move_resolution_atomic.
 *
 * Os dois alvos fornecem fixtures pelo driver nativo e usam exatamente o
 * mesmo ResolutionStore.commitMove. Nenhuma regra de distância é recriada
 * aqui: a suíte testa somente a fronteira transacional oficial.
 */
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import type {
  MoveResolutionCommitResult,
  ResolutionCommit,
} from "../../src/lib/mesa/infrastructure.ts";

export interface MoveFixture {
  sessionId: string;
  combatId: string;
  otherSessionId: string;
  otherCombatId: string;
  actorId: string;
  claimToken: string;
  resolutionId: string;
  cleanup(): Promise<void>;
}

export interface MoveContractEnvironment {
  label: string;
  commitMove<TResult = unknown>(input: ResolutionCommit<TResult>): Promise<MoveResolutionCommitResult<TResult> | null>;
  createFixture(): Promise<MoveFixture>;
  readActor(id: string): Promise<Record<string, unknown>>;
  readResolution(fixture: MoveFixture): Promise<Record<string, unknown>>;
  close?(): Promise<void>;
}

export interface MoveContractConfig {
  createEnvironment(): Promise<MoveContractEnvironment | null>;
  pending(): string;
}

export function moveResolutionContractSuite(config: MoveContractConfig): void {
  let cached: Promise<MoveContractEnvironment | null> | null = null;
  const environment = (): Promise<MoveContractEnvironment | null> => {
    cached ??= config.createEnvironment();
    return cached;
  };

  async function withEnvironment(
    context: TestContext,
    body: (environment: MoveContractEnvironment) => Promise<void>,
  ): Promise<void> {
    const env = await environment();
    if (!env) {
      context.skip(config.pending());
      return;
    }
    await body(env);
  }

  function input(fixture: MoveFixture, overrides: Record<string, unknown> = {}): ResolutionCommit<MoveResult> {
    const result: MoveResult = {
      combatantId: fixture.actorId,
      distance: 2,
      movementRemaining: 4,
      actionsRemaining: 2,
      position: { x: 0.4, y: 0.5 },
    };
    return {
      sessionId: fixture.sessionId,
      combatId: fixture.combatId,
      resolutionId: fixture.resolutionId,
      claimToken: fixture.claimToken,
      rpcArgs: {
        p_session_id: fixture.sessionId,
        p_combat_id: fixture.combatId,
        p_resolution_id: fixture.resolutionId,
        p_claim_token: fixture.claimToken,
        p_actor_id: fixture.actorId,
        p_movement_before: 6,
        p_movement_after: 4,
        p_actions_before: 2,
        p_actions_after: 2,
        p_position: result.position,
        p_netrunner_state: null,
        p_result: { ...result, ...overrides },
      },
    };
  }

  test("movimento válido atualiza o combatente e confirma a resolução", async (t) => {
    await withEnvironment(t, async (env) => {
      const fixture = await env.createFixture();
      try {
        const committed = await env.commitMove(input(fixture));
        assert.equal(committed?.status, "committed");
        assert.equal(committed?.result?.combatantId, fixture.actorId);
        const actor = await env.readActor(fixture.actorId);
        assert.equal(actor.movement_remaining, 4);
        assert.deepEqual(actor.position, { x: 0.4, y: 0.5 });
        const resolution = await env.readResolution(fixture);
        assert.equal(resolution.status, "committed");
      } finally {
        await fixture.cleanup();
      }
    });
  });

  test("mesma resolução é idempotente e não aplica movimento duas vezes", async (t) => {
    await withEnvironment(t, async (env) => {
      const fixture = await env.createFixture();
      try {
        const first = await env.commitMove(input(fixture));
        const second = await env.commitMove(input(fixture, { distance: 999 }));
        assert.equal(first?.status, "committed");
        assert.equal(second?.status, "already_committed");
        assert.deepEqual(second?.result, first?.result);
        assert.equal((await env.readActor(fixture.actorId)).movement_remaining, 4);
      } finally {
        await fixture.cleanup();
      }
    });
  });

  test("duas chamadas concorrentes da mesma resolução têm um commit e um replay", async (t) => {
    await withEnvironment(t, async (env) => {
      const fixture = await env.createFixture();
      try {
        const [first, second] = await Promise.all([
          env.commitMove(input(fixture)),
          env.commitMove(input(fixture)),
        ]);
        assert.deepEqual([first?.status, second?.status].sort(), ["already_committed", "committed"]);
        assert.equal((await env.readActor(fixture.actorId)).movement_remaining, 4);
      } finally {
        await fixture.cleanup();
      }
    });
  });

  test("conflito de CAS faz rollback e não deixa estado parcial", async (t) => {
    await withEnvironment(t, async (env) => {
      const fixture = await env.createFixture();
      try {
        await assert.rejects(
          env.commitMove({
            ...input(fixture),
            rpcArgs: { ...input(fixture).rpcArgs, p_movement_before: 99 },
          }),
          (error: unknown) => error instanceof Error && error.message.includes("movement_conflict"),
        );
        const actor = await env.readActor(fixture.actorId);
        assert.equal(actor.movement_remaining, 6);
        assert.deepEqual(actor.position, { x: 0.2, y: 0.5 });
        assert.equal((await env.readResolution(fixture)).status, "processing");
      } finally {
        await fixture.cleanup();
      }
    });
  });

  test("resolução fora do escopo não altera o combatente", async (t) => {
    await withEnvironment(t, async (env) => {
      const fixture = await env.createFixture();
      try {
        const wrong = input(fixture);
        wrong.sessionId = fixture.otherSessionId;
        wrong.combatId = fixture.otherCombatId;
        wrong.rpcArgs = {
          ...wrong.rpcArgs,
          p_session_id: fixture.otherSessionId,
          p_combat_id: fixture.otherCombatId,
        };
        await assert.rejects(
          env.commitMove(wrong),
          (error: unknown) => error instanceof Error && error.message.includes("resolution_not_claimed"),
        );
        assert.equal((await env.readActor(fixture.actorId)).movement_remaining, 6);
      } finally {
        await fixture.cleanup();
      }
    });
  });

  test.after(async () => {
    const env = await environment();
    await env?.close?.();
  });
}

interface MoveResult {
  combatantId: string;
  distance: number;
  movementRemaining: number;
  actionsRemaining: number;
  position: { x: number; y: number };
}
