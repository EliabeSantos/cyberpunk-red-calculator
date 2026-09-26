import assert from "node:assert/strict";
import test from "node:test";

import {
  JOIN_CODE_LENGTH,
  generateJoinCode,
  normalizeJoinCode,
} from "../src/lib/mesa/joinCode.ts";

test("normaliza o código de entrada (trim e maiúsculas)", () => {
  assert.equal(normalizeJoinCode(" 8f4k2 "), "8F4K2");
  assert.equal(normalizeJoinCode("8F4K2"), "8F4K2");
  assert.equal(normalizeJoinCode("AB3D9"), "AB3D9");
});

test("rejeita códigos inválidos", () => {
  assert.equal(normalizeJoinCode(""), null, "vazio");
  assert.equal(normalizeJoinCode("   "), null, "só espaço");
  assert.equal(normalizeJoinCode("8F4K"), null, "curto demais");
  assert.equal(normalizeJoinCode("8F4K22"), null, "longo demais");
  assert.equal(normalizeJoinCode("8F4K-"), null, "hífen não é aceito");
  assert.equal(normalizeJoinCode("8F4K "), null, "espaço interno");
  assert.equal(normalizeJoinCode(12345), null, "não é string");
  assert.equal(normalizeJoinCode(null), null);
  assert.equal(normalizeJoinCode(undefined), null);
});

test("gera códigos dentro do formato aceito pelo banco", () => {
  for (let i = 0; i < 200; i += 1) {
    const code = generateJoinCode();
    assert.equal(code.length, JOIN_CODE_LENGTH, "sempre 5 caracteres");
    assert.match(code, /^[A-Z0-9]{5}$/, "mesmo formato da constraint do Postgres");
    assert.equal(normalizeJoinCode(code), code, "gerado precisa ser aceito");
  }
});

test("o alfabeto deixa de fora de 0, O, 1 e I", () => {
  const samples = Array.from({ length: 500 }, () => generateJoinCode()).join("");
  for (const forbidden of ["0", "O", "1", "I"]) {
    assert.ok(!samples.includes(forbidden), `caractere ${forbidden} não deve aparecer`);
  }
});

test("geração determinística com randomByte injetado", () => {
  // 0 → primeiro do alfabeto ("A"), 1 → segundo ("B"), etc.
  const sequence = [0, 1, 2, 3, 4];
  let index = 0;
  const code = generateJoinCode(() => sequence[index++ % sequence.length]);
  assert.equal(code, "ABCDE");
});

test("espaço de busca grande o suficiente para não ser adivinhado", () => {
  // Alfabeto sem 0/O/1/I: 24 letras + 8 dígitos = 32 símbolos.
  assert.ok(Math.pow(32, JOIN_CODE_LENGTH) > 10_000_000, "pelo menos 10 milhões de códigos");
});
