import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import {
  getSessionConfig,
  saveSessionConfig,
} from "../src/lib/discord/sessionStore.ts";

// A store lê DISCORD_DATA_DIR a cada chamada: isolamos num diretório temporário.
const dataDir = mkdtempSync(join(tmpdir(), "cpr-discord-store-"));
process.env.DISCORD_DATA_DIR = dataDir;

const GUILD = "123456789012345678";
const CHANNEL = "987654321098765432";

after(() => {
  delete process.env.DISCORD_DATA_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

test("salva e recupera a vinculação mesa → guildId → channelId", () => {
  const saved = saveSessionConfig("night-city", { guildId: GUILD, channelId: CHANNEL });
  assert.ok(saved);
  assert.equal(saved.guildId, GUILD);
  assert.equal(saved.channelId, CHANNEL);
  assert.ok(saved.updatedAt);

  const loaded = getSessionConfig("night-city");
  assert.ok(loaded);
  assert.equal(loaded.guildId, GUILD);
  assert.equal(loaded.channelId, CHANNEL);
});

test("normaliza o código ao salvar e ao ler", () => {
  saveSessionConfig(" Cyberpunk-BR ", { guildId: GUILD, channelId: CHANNEL });
  assert.ok(getSessionConfig("cyberpunk-br"), "salvo normalizado");
  assert.ok(getSessionConfig(" CYBERPUNK-BR"), "lido normalizado");
});

test("mesa desconhecida retorna null", () => {
  assert.equal(getSessionConfig("mesa-inexistente"), null);
});

test("código de mesa inválido não salva", () => {
  assert.equal(saveSessionConfig("ab", { guildId: GUILD, channelId: CHANNEL }), null);
  assert.equal(saveSessionConfig("", { guildId: GUILD, channelId: CHANNEL }), null);
  assert.equal(saveSessionConfig(null, { guildId: GUILD, channelId: CHANNEL }), null);
  assert.equal(getSessionConfig("ab"), null);
});

test("ids que não são snowflakes do Discord não salvam", () => {
  assert.equal(
    saveSessionConfig("mesa-x", { guildId: "not-a-snowflake", channelId: CHANNEL }),
    null,
  );
  assert.equal(
    saveSessionConfig("mesa-x", { guildId: GUILD, channelId: "12ab" }),
    null,
  );
  assert.equal(getSessionConfig("mesa-x"), null, "nada foi persistido");
});

test("reconfigurar uma mesa sobrescreve a anterior", () => {
  const first = saveSessionConfig("mesa-y", { guildId: GUILD, channelId: CHANNEL });
  assert.ok(first);
  const otherChannel = "111222333444555666";
  const second = saveSessionConfig("mesa-y", { guildId: GUILD, channelId: otherChannel });
  assert.ok(second);
  assert.equal(getSessionConfig("mesa-y")?.channelId, otherChannel);
});

test("entradas corrompidas no arquivo são ignoradas sem quebrar a leitura", async () => {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(
    join(dataDir, "discord-sessions.json"),
    JSON.stringify({
      "mesa-ok": { guildId: GUILD, channelId: CHANNEL, updatedAt: "2026-01-01T00:00:00.000Z" },
      "mesa-ruim": { guildId: 42 },
      "codigo-invalido!!": { guildId: GUILD, channelId: CHANNEL },
    }),
    "utf8",
  );
  assert.ok(getSessionConfig("mesa-ok"), "entrada válida continua legível");
  assert.equal(getSessionConfig("mesa-ruim"), null, "entrada malformada é ignorada");
  assert.equal(getSessionConfig("codigo-invalido!!"), null);
});
