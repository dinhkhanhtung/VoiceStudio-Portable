const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { autoUpdater } = require('electron-updater');

autoUpdater.autoDownload = false;

const APP_AUTH_TOKEN = crypto.randomBytes(32).toString('hex');

let mainWindow = null;
let splashWindow = null;
let setupPromise = null;
let serverStarted = false;

// --- Custom Data Directory (config pointer) ---
// Tiny JSON file that always lives at the Electron default userData location
// (C:\Users\<user>\AppData\Roaming\Voice Studio\data_dir.json).
// Contains { "customDir": "D:\\VoiceStudioData" } when the customer has
// chosen a custom folder, absent/empty otherwise.
// Must be readable BEFORE app.on('ready') resolves getUserDataDir().
function getDataDirConfigPath() {
  return path.join(app.getPath('userData'), 'data_dir.json');
}

function readDataDirConfig() {
  try {
    const configPath = getDataDirConfigPath();
    if (fs.existsSync(configPath)) {
      const { customDir } = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (customDir && fs.existsSync(customDir)) return customDir;
    }
  } catch (_) {}
  return null;
}

function saveDataDirConfig(customDir) {
  const configPath = getDataDirConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({ customDir }, null, 2), 'utf-8');
}

// In dev mode (electron . from repo), use the repo .venv directly.
// In production (installed app), use userData so we have write permissions.
function getUserDataDir() {
  if (!app.isPackaged) {
    // Dev: project root = where electron_main.js lives
    return path.join(__dirname);
  }
  // Custom data directory chosen by customer during first install
  const customDir = readDataDirConfig();
  if (customDir) return customDir;
  // Default: Electron's standard userData on C:
  return app.getPath('userData');
}

// 1. Create Splash Window for loading/setup
function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 660,
    height: 700,
    frame: false,             // Frameless for a clean look
    transparent: true,        // Transparent window for card blur shadow
    resizable: false,
    icon: path.join(__dirname, 'build_icon.ico'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  splashWindow.loadFile(path.join(__dirname, 'backend', 'splash.html'));

  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

// 2. Create main Browser Window
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 700,
    title: "Voice Studio",
    icon: path.join(__dirname, 'build_icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Hide native menu bar for clean premium app feel
  mainWindow.setMenuBarVisibility(false);

  if (app.isPackaged) {
    // Token app-only (v1.2.10) is retrievable via DevTools console
    // (`window.appAuth.getToken()`) or the Network tab -- block the trivial
    // path to extracting it. Not airtight (a debugger could still attach),
    // just removes the "open devtools, type one line" shortcut.
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const key = input.key.toLowerCase();
      if (key === 'f12') {
        event.preventDefault();
        return;
      }
      if (input.control && input.shift && ['i', 'j', 'c'].includes(key)) {
        event.preventDefault();
      }
    });
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow.webContents.closeDevTools();
    });
  }

  // Load the backend server (which serves React frontend)
  mainWindow.loadURL('http://localhost:8891');

  mainWindow.on('closed', () => {
    mainWindow = null;
    app.quit();
  });
}

// Auto-update IPC handlers + event forwarding
ipcMain.handle('update:get-version', () => app.getVersion());

ipcMain.handle('auth:get-token', () => APP_AUTH_TOKEN);

ipcMain.on('update:is-packaged', (event) => {
  event.returnValue = app.isPackaged;
});

// --- Data Directory: BrowserWindow-based picker for fresh install ---
// Uses a real BrowserWindow (dir_picker.html) with alwaysOnTop to guarantee
// visibility on Windows. Returns a Promise.
function promptDataDirectory() {
  const defaultDir = app.getPath('userData');
  return new Promise((resolve) => {
    const pickerWin = new BrowserWindow({
      width: 520, height: 360,
      resizable: false, minimizable: false, maximizable: false,
      alwaysOnTop: true, center: true,
      title: 'Voice Studio',
      icon: path.join(__dirname, 'build_icon.ico'),
      webPreferences: { nodeIntegration: true, contextIsolation: false },
    });
    pickerWin.setMenuBarVisibility(false);
    pickerWin.show();
    pickerWin.focus();
    pickerWin.loadFile(path.join(__dirname, 'backend', 'dir_picker.html'));
    pickerWin.webContents.once('did-finish-load', () => {
      pickerWin.webContents.send('init', { defaultDir });
    });
    ipcMain.handle('dirPicker:browse', async () => {
      const result = dialog.showOpenDialogSync(pickerWin, {
        title: 'Choose data directory',
        properties: ['openDirectory', 'createDirectory'],
      });
      return (result && result.length > 0) ? result[0] : null;
    });
    ipcMain.once('dirPicker:done', (_event, chosenDir) => {
      ipcMain.removeHandler('dirPicker:browse');
      pickerWin.destroy();
      if (!chosenDir) { resolve(null); return; }
      try {
        fs.mkdirSync(chosenDir, { recursive: true });
        const t = path.join(chosenDir, '.vs_write_test');
        fs.writeFileSync(t, 'ok'); fs.unlinkSync(t);
      } catch (_) { resolve(null); return; }
      try {
        const s = fs.statfsSync(chosenDir);
        if ((s.bsize * s.bavail) / (1024 ** 3) < 15) { resolve(null); return; }
      } catch (_) {}
      saveDataDirConfig(chosenDir);
      resolve(chosenDir);
    });
    pickerWin.on('closed', () => {
      ipcMain.removeHandler('dirPicker:browse');
      resolve(null);
    });
  });
}



ipcMain.handle('update:check', async () => {
  if (!app.isPackaged) return { skipped: 'dev-mode' };
  return autoUpdater.checkForUpdates();
});

ipcMain.handle('update:download', async () => {
  if (!app.isPackaged) return { skipped: 'dev-mode' };
  return autoUpdater.downloadUpdate();
});

ipcMain.handle('update:install', async () => {
  if (!app.isPackaged) return { skipped: 'dev-mode' };
  return autoUpdater.quitAndInstall();
});

if (app.isPackaged) {
  ['checking-for-update', 'update-available', 'update-not-available', 'download-progress', 'update-downloaded', 'error'].forEach((eventName) => {
    autoUpdater.on(eventName, (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update:event', { type: eventName, payload: data });
      }
    });
  });
}

// 3. Start setup procedure
function runSetup(userDataDir) {
  const DesktopSetup = require('./backend/desktop_setup.js');

  let driverPromptCallback = null;

  const setup = new DesktopSetup(
    userDataDir,
    // onProgress callback
    (percent, status) => {
      console.log(`Setup progress: ${percent}% - ${status}`);
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.webContents.send('setup-progress', { percent, status });
      }
    },
    // onPromptDriver callback
    (cardName, callback) => {
      driverPromptCallback = callback;
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.webContents.send('prompt-driver', { cardName });
      }
    },
    // onLog callback — raw terminal-style output line, shown in the splash screen's log panel
    (line) => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.webContents.send('setup-log', line);
      }
    }
  );

  // Handle IPC actions from splash window
  ipcMain.on('action-driver', (event, action) => {
    if (driverPromptCallback) {
      driverPromptCallback(action);
      driverPromptCallback = null;
    }
  });

  return setup.start();
}

app.on('ready', async () => {
  // --- Fresh-install dir picker (BEFORE splash) ---
  // Must run before createSplashWindow so the native dialog appears
  // as a standalone top-level window (no transparent parent to hide behind).
  // Existing customers always have .venv or data/ at userData -> never see this.
  if (app.isPackaged && !readDataDirConfig()) {
    const defaultDir = app.getPath('userData');
    const venvExists = fs.existsSync(path.join(defaultDir, '.venv'));
    const dataExists = fs.existsSync(path.join(defaultDir, 'data'));
    if (!venvExists && !dataExists) {
      console.log('[DirPicker] Fresh install — showing native dialog');
      await promptDataDirectory();
    }
  }

  createSplashWindow();
  preventQuitOnClose = false; // Safe to quit normally on window-all-closed from now on

  // getUserDataDir() now reads data_dir.json (if promptDataDirectory saved it)
  let userDataDir = getUserDataDir();
  console.log(`[Electron] userDataDir = ${userDataDir}`);

  // Wait a bit for splash screen to mount
  setTimeout(async () => {
    try {

      const setupSuccess = await runSetup(userDataDir);
      
      if (setupSuccess) {
        // Expose userData path to backend/server.js via env var
        process.env.USER_DATA_DIR = userDataDir;

        // HF_HOME: only set when using a custom directory, so existing
        // customers (default C:) keep their model cache at the huggingface
        // default (~/.cache/huggingface) untouched — no re-download.
        const customDir = readDataDirConfig();
        if (customDir) {
          process.env.HF_HOME = path.join(userDataDir, '.cache', 'huggingface');
        }

        process.env.APP_IS_PACKAGED = app.isPackaged ? '1' : '0';
        process.env.APP_AUTH_TOKEN = APP_AUTH_TOKEN;

        // Start express server
        console.log("Starting backend server...");
        // require backend server to run inline
        require('./backend/server.js');
        serverStarted = true;

        // Give server 1.5 seconds to start up completely
        setTimeout(() => {
          if (splashWindow) {
            splashWindow.close();
          }
          createMainWindow();

          if (app.isPackaged) {
            setTimeout(() => {
              autoUpdater.checkForUpdates().catch((err) => console.error('Auto-update check failed:', err));
            }, 3000);
          }
        }, 1500);

      } else {
        // Setup stopped, possibly waiting for driver install or errored out
        console.log("Setup was not completed or exited.");
        // We do not close splash so user can see instructions or we can quit
        // app.quit();
      }
    } catch (err) {
      console.error("Setup error:", err);
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.webContents.send('setup-progress', { percent: 0, status: `❌ Lỗi: ${err.message}` });
      }
    }
  }, 1000);
});

let preventQuitOnClose = true; // Prevents app.quit() during window transitions like closing dir picker

app.on('window-all-closed', () => {
  if (preventQuitOnClose) return;
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('quit', () => {
  // express server will clean up the spawned python process on 'exit' hook,
  // which is triggered when Electron app process exits.
  console.log("Voice Studio Desktop exiting...");
});
