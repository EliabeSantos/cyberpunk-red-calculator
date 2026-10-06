import assert from "node:assert/strict";
import test from "node:test";

test("Death Save gateway rejeita resultado declarado antes de autenticar/persistir", async () => {
  const { POST } = await import("../src/app/api/mesa/[id]/combat/death-save/route.ts");
  const response = await POST(
    new Request("http://localhost/api/mesa/session/combat/death-save", {
      method: "POST",
      headers: { "content-type": "application/json", "x-mesa-token": "not-used" },
      body: JSON.stringify({ resolutionId: "r1", actorCombatantId: "c1", success: true, hp: 1 }),
    }),
    { params: Promise.resolve({ id: "session" }) },
  );
  const payload = (await response.json()) as { code?: string };
  assert.equal(response.status, 400);
  assert.equal(payload.code, "client_authority_forbidden");
});
