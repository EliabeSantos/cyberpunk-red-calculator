import assert from "node:assert/strict";
import test from "node:test";

import { canBotSend } from "../src/lib/discord/permissions.ts";

const GUILD = "111111111111111111";
const BOT_USER = "222222222222222222";
const ROLE_GUARDAS = "333333333333333333";
const OUTRO_Membro = "999999999999999999";

const VIEW = 1024n;
const SEND = 2048n;
const ADMIN = 8n;
const VIEW_SEND = String(VIEW | SEND);

function everyone(perms: bigint | string) {
  return { id: GUILD, permissions: typeof perms === "string" ? perms : String(perms) };
}

test("base view+send e sem overwrites → pode enviar", () => {
  assert.equal(canBotSend(GUILD, [everyone(VIEW_SEND)], { roles: [] }, BOT_USER, []), true);
});

test("sem permissões base → não pode enviar", () => {
  assert.equal(canBotSend(GUILD, [everyone(0n)], { roles: [] }, BOT_USER, []), false);
});

test("overwrite do @everyone negando envio → não pode enviar", () => {
  const overwrites = [{ id: GUILD, type: 0, allow: "0", deny: String(SEND) }];
  assert.equal(canBotSend(GUILD, [everyone(VIEW_SEND)], { roles: [] }, BOT_USER, overwrites), false);
});

test("overwrite de papel concede envio que o @everyone negou → pode enviar", () => {
  const overwrites = [
    { id: GUILD, type: 0, allow: "0", deny: String(SEND) },
    { id: ROLE_GUARDAS, type: 0, allow: String(SEND), deny: "0" },
  ];
  assert.equal(
    canBotSend(GUILD, [everyone(VIEW)], { roles: [ROLE_GUARDAS] }, BOT_USER, overwrites),
    true,
  );
});

test("overwrite de papel que o bot NÃO possui é ignorado", () => {
  const overwrites = [{ id: ROLE_GUARDAS, type: 0, allow: "0", deny: String(SEND) }];
  assert.equal(
    canBotSend(GUILD, [everyone(VIEW_SEND)], { roles: [] }, BOT_USER, overwrites),
    true,
  );
});

test("overwrite do membro (bot) negando visão → não pode enviar", () => {
  const overwrites = [{ id: BOT_USER, type: 1, allow: "0", deny: String(VIEW) }];
  assert.equal(canBotSend(GUILD, [everyone(VIEW_SEND)], { roles: [] }, BOT_USER, overwrites), false);
});

test("overwrite de OUTRO membro não afeta o bot", () => {
  const overwrites = [
    { id: OUTRO_Membro, type: 1, allow: "0", deny: String(VIEW | SEND) },
  ];
  assert.equal(canBotSend(GUILD, [everyone(VIEW_SEND)], { roles: [] }, BOT_USER, overwrites), true);
});

test("ADMINISTRATOR na base → pode enviar mesmo sem view/send explícitos", () => {
  assert.equal(canBotSend(GUILD, [everyone(ADMIN)], { roles: [] }, BOT_USER, []), true);
});

test("tipos legados de string ('role'/'member') são aceitos", () => {
  const overwrites = [
    { id: GUILD, type: "role", allow: "0", deny: String(SEND) },
    { id: ROLE_GUARDAS, type: "role", allow: String(SEND), deny: "0" },
  ];
  assert.equal(
    canBotSend(GUILD, [everyone(VIEW)], { roles: [ROLE_GUARDAS] }, BOT_USER, overwrites),
    true,
  );
});
