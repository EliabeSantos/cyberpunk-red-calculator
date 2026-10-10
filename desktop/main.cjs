/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, dialog, Menu, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const installRoot = path.resolve(__dirname, "..", "..");
const dataRoot = path.join(process.env.ProgramData || "C:\\ProgramData", "Cyberpunk RED Calculator");
const configFile = path.join(dataRoot, "config", "host.env");
const bootstrapScript = path.join(installRoot, "windows", "bootstrap-host.ps1");
const stopScript = path.join(installRoot, "windows", "stop-host.ps1");
const iconFile = path.join(installRoot, "app", "favicon.ico");

let mainWindow;
let isStopping = false;
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

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    const executable = path.join(process.env.WINDIR || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const child = spawn(executable, [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      script,
    ], {
      cwd: installRoot,
      windowsHide: true,
      stdio: "ignore",
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
  await runPowerShell(stopScript);
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

function installApplicationMenu() {
  const addresses = Object.values(os.networkInterfaces())
    .flatMap((entries) => entries || [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => `http://${entry.address}:${configuredPort()}`);
  const connectionText = addresses.length > 0
    ? `No computador do jogador, use um destes endereços:\n\n${addresses.join("\n")}\n\nO jogador precisa estar na mesma LAN ou VPN. Não use localhost no outro dispositivo. Configure o firewall somente para os jogadores.`
    : "Nenhum endereço LAN/VPN foi detectado. Conecte o computador à rede e tente novamente.";
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: "Ajuda",
      submenu: [
        { label: "Como conectar jogadores", click: () => void dialog.showMessageBox({ type: "info", title: "Conexão de jogadores", message: connectionText }) },
        { role: "about" },
      ],
    },
  ]));
}

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  try {
    await startHostWithRetry();
    installApplicationMenu();
    createWindow();
  } catch {
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
