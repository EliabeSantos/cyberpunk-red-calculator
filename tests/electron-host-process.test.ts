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

// ---------------------------------------------------------------------------
// Auto-update: a causa raiz da v0.2.0 foi o desalinhamento entre o `path` do
// latest.yml (espaços→hífens, convenção do electron-updater) e o nome real do
// asset publicado (espaços→pontos, sanitização do GitHub Releases). O URL de
// download montado retornava 404: a verificação funcionava, o download não.
// ---------------------------------------------------------------------------

test("artifactName do electron-builder não contém espaços (latest.yml × asset da release)", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
    build?: { artifactName?: string };
  };
  const artifactName = packageJson.build?.artifactName;
  assert.ok(artifactName, "build.artifactName precisa estar configurado explicitamente");
  assert.ok(!artifactName.includes(" "), `artifactName não pode conter espaços: "${artifactName}"`);
  assert.match(artifactName, /\$\{version\}/, "o nome deve incluir ${version}");
  assert.match(artifactName, /\$\{ext\}/, "o nome deve incluir ${ext}");
  assert.match(artifactName, /Setup/, "os workflows casam artefatos com o glob *Setup*.exe");
  // Invariante central: sem espaços, as duas convenções de saneamento são
  // identidades e o nome publicado é exatamente o do latest.yml.
  assert.equal(artifactName.replace(/ /g, "-"), artifactName, "espaços→hífens (electron-updater) não muda nada");
  assert.equal(artifactName.replace(/ /g, "."), artifactName, "espaços→pontos (GitHub) não muda nada");
});

test("nomes com espaços divergem entre as convenções — o bug quebrou toda atualização", () => {
  // Convenção do electron-updater (GitHubProvider: p.replace(/ /g, "-")).
  const updaterName = "Cyberpunk RED Calculator Setup 0.2.0.exe".replace(/ /g, "-");
  // Sanitização do GitHub Releases ao publicar o asset (espaços→pontos).
  const publishedName = "Cyberpunk RED Calculator Setup 0.2.0.exe".replace(/ /g, ".");
  assert.notEqual(updaterName, publishedName,
    "com espaços no nome, o latest.yml e o asset da release apontam para arquivos diferentes (404 no download)");
});

test("release workflow verifica o nome do installer EXATAMENTE (sem normalizar separadores)", async () => {
  const workflow = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  // A comparação normalizada ([^a-z0-9] removido) foi o que escondeu o
  // desalhinhamento hífen×ponto e deixou a release quebrada passar pelo CI.
  assert.ok(!workflow.includes("[^a-z0-9]"),
    "a verificação não pode normalizar separadores — hífen e ponto são distintos no URL de download");
  assert.match(workflow, /\$metadataNames -notcontains \$installerName/,
    "a comparação precisa ser exata entre o nome do installer e o do latest.yml");
  assert.match(workflow, /UnescapeDataString/, "URLs do latest.yml são decodificadas antes da comparação");
});

test("updater registra todos os ciclos no updater.log para diagnóstico", async () => {
  const source = await readFile(new URL("../desktop/main.cjs", import.meta.url), "utf8");

  // Eventos do electron-updater espelhados no log (com versões e etapa).
  assert.match(source, /logUpdater\("checking_for_update"/);
  assert.match(source, /logUpdater\("update_available", \{ version: info\.version, currentVersion: app\.getVersion\(\) \}\)/);
  assert.match(source, /logUpdater\("up_to_date"/);
  assert.match(source, /logUpdater\("download_progress"/);
  assert.match(source, /logUpdater\("download_completed"/);
  assert.match(source, /logUpdater\("updater_error", \{ message, stage: updateState/);
  // Diálogos e escolhas do usuário (responde "o download foi iniciado?").
  assert.match(source, /logUpdater\("prompt_available_shown"/);
  assert.match(source, /logUpdater\("prompt_available_choice"/);
  assert.match(source, /logUpdater\("download_requested"/);
  assert.match(source, /logUpdater\("download_failed"/);
  // Motivo explícito quando o updater fica desabilitado (ex.: wrapper Inno).
  assert.match(source, /logUpdater\("disabled", \{ reason: "not_packaged"/);
  assert.match(source, /logUpdater\("disabled", \{ reason: "app_update_manifest_missing"/);
});
