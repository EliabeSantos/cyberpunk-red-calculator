import assert from "node:assert/strict";
import test from "node:test";

import { createId } from "../src/lib/id.ts";

const cryptoProperty = Object.getOwnPropertyDescriptor(globalThis, "crypto");

function setCrypto(value: unknown): void {
  Object.defineProperty(globalThis, "crypto", { configurable: true, value });
}

function restoreCrypto(): void {
  if (cryptoProperty) Object.defineProperty(globalThis, "crypto", cryptoProperty);
  else delete (globalThis as { crypto?: unknown }).crypto;
}

test.afterEach(restoreCrypto);

test("prefere crypto.randomUUID quando disponível", () => {
  setCrypto({ randomUUID: () => "uuid-from-randomUUID" });
  assert.equal(createId(), "uuid-from-randomUUID");
});

test("usa crypto.getRandomValues quando randomUUID não existe", () => {
  setCrypto({ getRandomValues: (bytes: Uint8Array) => {
    bytes.fill(0);
    return bytes;
  } });
  assert.equal(createId(), "00000000-0000-4000-8000-000000000000");
});

test("usa fallback UUID-like sem lançar quando Web Crypto não existe", () => {
  setCrypto(undefined);
  const first = createId();
  const second = createId();
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(second, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(first, second);
});
