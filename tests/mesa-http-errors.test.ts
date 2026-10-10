import assert from "node:assert/strict";
import test from "node:test";

import { errorResponse } from "../src/lib/mesa/http.ts";
import { MesaError } from "../src/lib/mesa/store.ts";

test("preserva status e código seguro de erro de domínio 503", async () => {
  const response = errorResponse(new MesaError("detalhe interno que não deve sair", 503, "local_transaction_unavailable"));
  const payload = await response.json() as Record<string, unknown>;

  assert.equal(response.status, 503);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "local_transaction_unavailable");
  assert.equal(payload.error, "O serviço de Mesa está temporariamente indisponível.");
  assert.match(String(payload.errorId), /^[0-9a-f-]{36}$/);
  assert.doesNotMatch(JSON.stringify(payload), /detalhe interno/);
});
