/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, dialog, Menu, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const installRoot = path.resolve(__dirname, "..", "..");
const programDataRoot = path.join(process.env.ProgramData || "C:\\ProgramData", "Cyberpunk RED Calculator");
const localDataRoot = path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || "C:\\Users\\Public", "AppData", "Local"), "Cyberpunk RED Calculator");
const dataRoot = fs.existsSync(path.join(programDataRoot, "config", "host.env")) || fs.existsSync(path.join(programDataRoot, "postgres", "PG_VERSION"))
  ? programDataRoot
  : localDataRoot;
process.env.MESA_DATA_DIR = dataRoot;
const configFile = path.join(dataRoot, "config", "host.env");
const bootstrapScript = path.join(installRoot, "windows", "bootstrap-host.ps1");
const stopScript = path.join(installRoot, "windows", "stop-host.ps1");
const iconFile = path.join(installRoot, "app", "favicon.ico");

let mainWindow;
let isStopping = false;
let applicationMenuReady = false;
let updateState = "disabled";
let updateVersion = "";
let updateProgress = 0;
let updateError = "";
let updatePromptOpen = false;
let manualUpdateCheck = false;
app.setName("Cyberpunk RED Calculator");
app.setAppUserModelId("com.cyberpunkred.calculator");

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

function configuredPort() {
  try {
    const contents = fs.readFileSync(configFile, "utf8");
    const match = contents.match(/^PORT=(\d+)$/m);
    return match ? Number(match[1]) : 3000;
  } catch {
    return 3000;
  }
}

function localUrl() {
  return `http://127.0.0.1:${configuredPort()}/`;
}

const updaterLogFile = path.join(dataRoot, "logs", "updater.log");

function logUpdater(event, details = {}) {
  try {
    fs.mkdirSync(path.dirname(updaterLogFile), { recursive: true });
    fs.appendFileSync(updaterLogFile, `${JSON.stringify({ at: new Date().toISOString(), event, ...details })}\n`, "utf8");
  } catch {
    // Diagnóstico não pode impedir o aplicativo de funcionar.
  }
}

function setUpdateState(state, details = {}) {
  updateState = state;
  if (details.version !== undefined) updateVersion = details.version;
  if (details.progress !== undefined) updateProgress = details.progress;
  if (details.error !== undefined) updateError = details.error;
  if (mainWindow) {
    setUpdateTitle();
    if (state !== "downloading") mainWindow.setProgressBar(-1);
  }
  if (applicationMenuReady) installApplicationMenu();
}

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    const executable = path.join(process.env.WINDIR || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const args = [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      script,
    ];
    if (app.isPackaged) args.unshift("-WindowStyle", "Hidden");
    const child = spawn(executable, args, {
      cwd: installRoot,
      windowsHide: app.isPackaged,
      env: {
        ...process.env,
        MESA_ELECTRON_PACKAGED: app.isPackaged ? "1" : "0",
      },
      stdio: app.isPackaged ? "ignore" : "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`PowerShell terminou com código ${code ?? 1}.`));
    });
  });
}

async function isHealthy() {
  try {
    const response = await fetch(localUrl(), { signal: AbortSignal.timeout(1500) });
    return response.status >= 200 && response.status < 500;
  } catch {
    return false;
  }
}

async function ensureHost() {
  if (!(await isHealthy())) await runPowerShell(bootstrapScript);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await isHealthy()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("O host não respondeu ao teste de saúde.");
}

async function startHostWithRetry() {
  for (;;) {
    try {
      await ensureHost();
      return;
    } catch (error) {
      const result = await dialog.showMessageBox({
        type: "error",
        title: "Cyberpunk RED Calculator",
        message: "Não foi possível iniciar o host local.",
        detail: "Verifique se o aplicativo foi instalado corretamente e tente novamente.",
        buttons: ["Tentar novamente", "Sair"],
        defaultId: 0,
        cancelId: 1,
      });
      if (result.response !== 0) throw error;
    }
  }
}

async function stopHost() {
  if (isStopping) return;
  isStopping = true;
  try {
    await runPowerShell(stopScript);
  } catch (error) {
    isStopping = false;
    throw error;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: "Cyberpunk RED Calculator",
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    show: false,
    icon: fs.existsSync(iconFile) ? iconFile : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.on("will-navigate", (event, destination) => {
    if (!destination.startsWith("http://127.0.0.1:") && !destination.startsWith("http://localhost:")) {
      event.preventDefault();
      void shell.openExternal(destination);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:")) return { action: "allow" };
    void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.once("ready-to-show", () => mainWindow.focus());
  mainWindow.on("close", (event) => {
    if (isStopping) return;
    event.preventDefault();
    void stopHost()
      .then(() => mainWindow.destroy())
      .catch(() => {
        isStopping = false;
        void dialog.showMessageBox(mainWindow, {
          type: "error",
          title: "Não foi possível encerrar o host",
          message: "O aplicativo continua aberto para proteger os dados em gravação.",
          detail: "Tente fechar novamente ou use a opção Parar no menu Iniciar.",
          buttons: ["OK"],
        });
      });
  });
  void mainWindow.loadURL(localUrl());
}

function setUpdateTitle() {
  if (!mainWindow) return;
  const suffix = updateState === "downloading"
    ? ` — Atualizando ${Math.round(updateProgress)}%`
    : updateState === "ready"
      ? " — Atualização pronta"
      : updateState === "available"
        ? " — Atualização disponível"
        : updateState === "checking"
          ? " — Verificando atualizações"
          : updateState === "error"
            ? " — Falha na atualização"
        : "";
  mainWindow.setTitle(`Cyberpunk RED Calculator${suffix}`);
  if (updateState === "downloading") mainWindow.setProgressBar(Math.max(0, Math.min(1, updateProgress / 100)));
}

async function installDownloadedUpdate() {
  if (updateState !== "ready") return;
  try {
    logUpdater("install_requested", { version: updateVersion });
    await stopHost();
    autoUpdater.quitAndInstall(false, true);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logUpdater("install_failed", { message });
    setUpdateState("error", { error: message });
    void dialog.showMessageBox(mainWindow, {
      type: "error",
      title: "Atualização não instalada",
      message: "A atualização foi baixada, mas não pôde ser instalada agora.",
      detail: "O aplicativo continuará usando a versão atual. Tente novamente ao reiniciar.",
      buttons: ["OK"],
    });
  }
}

async function downloadAvailableUpdate() {
  if (updateState !== "available") return;
  try {
    logUpdater("download_requested", { version: updateVersion });
    setUpdateState("downloading", { progress: 0 });
    await autoUpdater.downloadUpdate();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logUpdater("download_failed", { message });
    setUpdateState("error", { error: message });
    void dialog.showMessageBox(mainWindow, {
      type: "error",
      title: "Download interrompido",
      message: "Não foi possível baixar a atualização.",
      detail: "A versão atual continua instalada. Verifique sua conexão e tente novamente pelo menu Ajuda > Atualizações.",
      buttons: ["OK"],
    });
  }
}

function promptUpdateAvailable() {
  if (updatePromptOpen || !mainWindow) return;
  updatePromptOpen = true;
  void dialog.showMessageBox(mainWindow, {
    type: "info",
    title: "Nova versão disponível",
    message: `A versão ${updateVersion} está disponível.`,
    detail: `Versão instalada: ${app.getVersion()}\nVocê pode baixar em segundo plano e escolher quando reiniciar o aplicativo.`,
    buttons: ["Baixar agora", "Depois"],
    defaultId: 0,
    cancelId: 1,
  }).then((result) => {
    updatePromptOpen = false;
    if (result.response === 0) return downloadAvailableUpdate();
    return undefined;
  }).catch(() => {
    updatePromptOpen = false;
  });
}

function promptUpdateReady() {
  if (updatePromptOpen || !mainWindow) return;
  updatePromptOpen = true;
  void dialog.showMessageBox(mainWindow, {
    type: "info",
    title: "Atualização pronta",
    message: `A versão ${updateVersion} foi baixada.`,
    detail: "Reiniciar agora encerra o host local antes de instalar. Se houver uma Mesa em andamento, escolha Depois e reinicie quando for seguro.",
    buttons: ["Reiniciar e instalar", "Depois"],
    defaultId: 0,
    cancelId: 1,
  }).then((result) => {
    updatePromptOpen = false;
    if (result.response === 0) return installDownloadedUpdate();
    return undefined;
  }).catch(() => {
    updatePromptOpen = false;
  });
}

async function checkForUpdates(manual = false) {
  if (updateState === "checking" || updateState === "downloading") return;
  manualUpdateCheck = manual;
  setUpdateState("checking", { error: "" });
  logUpdater("check_requested", { manual, currentVersion: app.getVersion() });
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logUpdater("check_failed", { message });
    setUpdateState("error", { error: message });
    if (manual) {
      void dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: "Atualizações indisponíveis",
        message: "Não foi possível verificar atualizações agora.",
        detail: "A versão atual continua funcionando. Verifique sua conexão e tente novamente mais tarde.",
        buttons: ["OK"],
      });
    }
  }
}

function configureAutoUpdater() {
  const manifest = path.join(process.resourcesPath, "app-update.yml");
  if (!app.isPackaged || !fs.existsSync(manifest)) return;

  logUpdater("configured", { currentVersion: app.getVersion() });
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.on("checking-for-update", () => {
    setUpdateState("checking");
  });
  autoUpdater.on("update-available", (info) => {
    logUpdater("update_available", { version: info.version });
    setUpdateState("available", { version: info.version, progress: 0, error: "" });
    promptUpdateAvailable();
  });
  autoUpdater.on("update-not-available", (info) => {
    logUpdater("up_to_date", { version: info?.version ?? app.getVersion() });
    setUpdateState("current", { version: "", progress: 0, error: "" });
    if (manualUpdateCheck) {
      void dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "Aplicativo atualizado",
        message: `Você está usando a versão ${app.getVersion()}.`,
        detail: "Nenhuma atualização está disponível no momento.",
        buttons: ["OK"],
      });
    }
    manualUpdateCheck = false;
  });
  autoUpdater.on("download-progress", (progress) => {
    setUpdateState("downloading", { progress: progress.percent });
  });
  autoUpdater.on("update-downloaded", (info) => {
    logUpdater("download_completed", { version: info.version });
    setUpdateState("ready", { version: info.version, progress: 100, error: "" });
    promptUpdateReady();
  });
  autoUpdater.on("error", (error) => {
    const message = error instanceof Error ? error.message : String(error);
    logUpdater("updater_error", { message });
    setUpdateState("error", { error: message });
    manualUpdateCheck = false;
  });

  void checkForUpdates();
  const interval = setInterval(() => void checkForUpdates(), 6 * 60 * 60 * 1000);
  interval.unref();
}

function installApplicationMenu() {
  const addresses = Object.values(os.networkInterfaces())
    .flatMap((entries) => entries || [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => `http://${entry.address}:${configuredPort()}`);
  const connectionText = addresses.length > 0
    ? `No computador do jogador, use um destes endereços:\n\n${addresses.join("\n")}\n\nO jogador precisa estar na mesma LAN ou VPN. Não use localhost no outro dispositivo. Configure o firewall somente para os jogadores.`
    : "Nenhum endereço LAN/VPN foi detectado. Conecte o computador à rede e tente novamente.";
  const updateLabel = updateState === "ready"
    ? "Reiniciar e instalar atualização"
    : updateState === "available"
      ? "Baixar atualização"
      : updateState === "checking"
        ? "Verificando atualizações..."
        : "Verificar atualizações";
  const updateDetails = updateVersion
    ? `Nova versão disponível: ${updateVersion}`
    : `Versão instalada: ${app.getVersion()}${updateState === "error" ? " — última verificação falhou" : ""}`;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: "Ajuda",
      submenu: [
        { label: "Como conectar jogadores", click: () => void dialog.showMessageBox({ type: "info", title: "Conexão de jogadores", message: connectionText }) },
        {
          label: `Atualizações — ${updateDetails}`,
          enabled: updateState !== "disabled",
          submenu: [
            { label: `Versão instalada: ${app.getVersion()}`, enabled: false },
            ...(updateVersion ? [{ label: `Versão disponível: ${updateVersion}`, enabled: false }] : []),
            { type: "separator" },
            {
              label: updateLabel,
              enabled: updateState !== "checking" && updateState !== "downloading",
              click: () => {
                if (updateState === "ready") return installDownloadedUpdate();
                if (updateState === "available") return downloadAvailableUpdate();
                return checkForUpdates(true);
              },
            },
            ...(updateState === "downloading" ? [{ label: `Download: ${Math.round(updateProgress)}%`, enabled: false }] : []),
            ...(updateState === "error" && updateError ? [{ label: "Consulte o log updater.log para detalhes.", enabled: false }] : []),
          ],
        },
        { role: "about" },
      ],
    },
  ]));
  applicationMenuReady = true;
}

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  try {
    await startHostWithRetry();
    createWindow();
    configureAutoUpdater();
    installApplicationMenu();
  } catch {
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
