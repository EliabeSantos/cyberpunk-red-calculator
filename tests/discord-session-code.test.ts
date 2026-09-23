import assert from "node:assert/strict";
import test from "node:test";

import { generateSessionCode, normalizeSessionCode } from "../src/lib/discord/sessionCode.ts";

test("normaliza o código da mesa (trim e minúsculas)", () => {
  assert.equal(normalizeSessionCode(" Night-City "), "night-city");
  assert.equal(normalizeSessionCode("mesa-1"), "mesa-1");
  assert.equal(normalizeSessionCode("abc"), "abc");
  assert.equal(normalizeSessionCode("a".repeat(48)), "a".repeat(48));
});

test("rejeita códigos inválidos", () => {
  assert.equal(normalizeSessionCode(""), null);
  assert.equal(normalizeSessionCode("   "), null);
  assert.equal(normalizeSessionCode("ab"), null, "curto demais");
  assert.equal(normalizeSessionCode("a".repeat(49)), null, "longo demais");
  assert.equal(normalizeSessionCode("mesa com espaço"), null, "espaço");
  assert.equal(normalizeSessionCode("mesa_invalida"), null, "underscore");
  assert.equal(normalizeSessionCode("-comeca-com-hifen"), null);
  assert.equal(normalizeSessionCode(123), null, "não é string");
  assert.equal(normalizeSessionCode(null), null);
});

test("gera um código válido", () => {
  const code = generateSessionCode();
  assert.equal(normalizeSessionCode(code), code, "código gerado deve ser válido");
  assert.ok(code.startsWith("mesa-"));
  assert.notEqual(generateSessionCode(), code, "gerações devem ser distintas");
});
