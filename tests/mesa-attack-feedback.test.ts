import assert from "node:assert/strict";
import test from "node:test";
import { formatAttackGatewayError } from "../src/lib/mesa/client.ts";

test("line_of_sight_blocked recebe feedback específico de ataque", () => {
  assert.equal(
    formatAttackGatewayError("Linha de visão bloqueada por geometria tática.", "line_of_sight_blocked"),
    "LINHA DE VISÃO BLOQUEADA — não é possível atacar este alvo.",
  );
});

test("outros erros de ataque preservam a mensagem existente", () => {
  assert.equal(formatAttackGatewayError("Não é seu turno.", "not_your_turn"), "Não é seu turno.");
  assert.equal(formatAttackGatewayError("Alvo inválido.", "target_not_found"), "Alvo inválido.");
});
