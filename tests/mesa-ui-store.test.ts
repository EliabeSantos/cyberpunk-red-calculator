import assert from "node:assert/strict";
import test from "node:test";

import {
  closeMesa,
  getMesaUiSnapshot,
  getServerMesaUiSnapshot,
  openMesa,
  subscribeToMesaUi,
} from "../src/lib/mesa/mesaUiStore.ts";

test("a sala começa fechada no servidor e no cliente", () => {
  assert.deepEqual(getServerMesaUiSnapshot(), { open: false, joinCode: null });
  assert.deepEqual(getMesaUiSnapshot(), { open: false, joinCode: null });
});

test("abrir a mesa guarda o código normalizado em maiúsculas", () => {
  openMesa("8f4k2");
  assert.deepEqual(getMesaUiSnapshot(), { open: true, joinCode: "8F4K2" });
  closeMesa();
});

test("fechar devolve o estado inicial, sem resquício do código", () => {
  openMesa("AB3D9");
  closeMesa();
  assert.deepEqual(getMesaUiSnapshot(), { open: false, joinCode: null });
});

test("o snapshot só muda quando o estado muda (render sem cascata)", () => {
  const before = getMesaUiSnapshot();
  closeMesa();
  assert.equal(getMesaUiSnapshot(), before, "fechar de novo não deve emitir novo objeto");

  openMesa("8F4K2");
  const opened = getMesaUiSnapshot();
  assert.notEqual(opened, before, "abrir deve emitir um snapshot novo");

  closeMesa();
  assert.notEqual(getMesaUiSnapshot(), opened, "fechar deve emitir um snapshot novo");
});

test("quem assina é avisado em cada transição e pode cancelar a assinatura", () => {
  let notifications = 0;
  const unsubscribe = subscribeToMesaUi(() => {
    notifications += 1;
  });

  openMesa("8F4K2");
  closeMesa();
  assert.equal(notifications, 2, "uma notificação por transição");

  unsubscribe();
  openMesa("8F4K2");
  assert.equal(notifications, 2, "assinante removido não deve ser avisado");
  closeMesa();
});

test("o snapshot do servidor nunca indica sala aberta", () => {
  openMesa("8F4K2");
  assert.deepEqual(getServerMesaUiSnapshot(), { open: false, joinCode: null });
  closeMesa();
});
