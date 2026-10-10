import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Electron empacotado oculta o PowerShell e sinaliza o bootstrap", async () => {
  const source = await readFile(new URL("../desktop/main.cjs", import.meta.url), "utf8");

  assert.match(source, /if \(app\.isPackaged\) args\.unshift\("-WindowStyle", "Hidden"\)/);
  assert.match(source, /windowsHide: app\.isPackaged/);
  assert.match(source, /MESA_ELECTRON_PACKAGED: app\.isPackaged \? "1" : "0"/);
  assert.match(source, /stdio: app\.isPackaged \? "ignore" : "inherit"/);
});

test("updater exige ação do usuário, exibe progresso e registra diagnóstico", async () => {
  const source = await readFile(new URL("../desktop/main.cjs", import.meta.url), "utf8");

  assert.match(source, /autoUpdater\.autoDownload = false/);
  assert.match(source, /autoUpdater\.autoInstallOnAppQuit = false/);
  assert.match(source, /autoUpdater\.on\("update-available"/);
  assert.match(source, /autoUpdater\.on\("download-progress"/);
  assert.match(source, /mainWindow\.setProgressBar/);
  assert.match(source, /updater\.log/);
  assert.match(source, /Reiniciar e instalar/);
});

test("bootstrap oculta somente o servidor empacotado e preserva os logs", async () => {
  const source = await readFile(new URL("../scripts/windows/bootstrap-host.ps1", import.meta.url), "utf8");

  assert.match(source, /\$windowStyle = if \(\$env:MESA_ELECTRON_PACKAGED -eq "1"\) \{ "Hidden" \} else \{ "Normal" \}/);
  assert.match(source, /-WindowStyle \$windowStyle/);
  assert.match(source, /-RedirectStandardOutput \(Join-Path \$logs "host\.log"\)/);
  assert.match(source, /-RedirectStandardError \(Join-Path \$logs "host-error\.log"\)/);
});

test("encerramento continua limitado ao host validado e sua árvore", async () => {
  const source = await readFile(new URL("../scripts/windows/stop-host.ps1", import.meta.url), "utf8");

  assert.match(source, /\$isBundledNode/);
  assert.match(source, /\$isExpectedScript/);
  assert.match(source, /taskkill\.exe \/PID \$hostPid \/T \/F/);
});

test("o ícone da janela e da distribuição usam o asset oficial", async () => {
  const main = await readFile(new URL("../desktop/main.cjs", import.meta.url), "utf8");
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { build?: { icon?: string } };
  const installer = await readFile(new URL("../installer/windows/CyberpunkRedCalculator.iss", import.meta.url), "utf8");

  assert.match(main, /path\.join\(installRoot, "app", "icon\.ico"\)/);
  assert.equal(packageJson.build?.icon, "src/app/icon.ico");
  assert.match(installer, /SetupIconFile=.*src\\app\\icon\.ico/);
  assert.match(installer, /IconFilename: "\{app\}\\app\\icon\.ico"/);
});
