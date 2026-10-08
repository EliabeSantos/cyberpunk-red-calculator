import assert from "node:assert/strict";
import test from "node:test";
import { formatAttackGatewayError } from "../src/lib/mesa/client.ts";

test("line_of_sight_blocked recebe feedback específico de ataque", () => {
  assert.equal(
    formatAttackGatewayError("Linha de visão bloqueada por geometria tática.", "line_of_sight_blocked"),
    "LINHA DE VISÃO BLOQUEADA — não é possível atacar este alvo.",
  );
});

test("melee_out_of_range recebe feedback específico de ataque", () => {
  assert.equal(
    formatAttackGatewayError("Alvo fora do alcance corpo a corpo.", "melee_out_of_range"),
    "FORA DO ALCANCE CORPO A CORPO — aproxime-se de uma casa adjacente.",
  );
});

test("outros erros de ataque preservam a mensagem existente", () => {
  assert.equal(formatAttackGatewayError("Não é seu turno.", "not_your_turn"), "Não é seu turno.");
  assert.equal(formatAttackGatewayError("Alvo inválido.", "target_not_found"), "Alvo inválido.");
});
