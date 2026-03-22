const { app, BrowserWindow, Menu, shell, ipcMain, screen } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater');

const store = new Store();
const WINDOW_BOUNDS_KEY = 'windowBounds';

// Disable auto-download — we control when to download
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

function getValidBounds() {
  const saved = store.get(WINDOW_BOUNDS_KEY);
  if (!saved) return null;

  const displays = screen.getAllDisplays();
  const onScreen = displays.some(d => {
    const { x, y, width, height } = d.workArea;
    return (
      saved.x >= x && saved.x < x + width &&
      saved.y >= y && saved.y < y + height
    );
  });

  return onScreen ? saved : null;
}

let mainWindow;

function createWindow() {
  const savedBounds = getValidBounds();

  mainWindow = new BrowserWindow({
    width: savedBounds ? savedBounds.width : 1366,
    height: savedBounds ? savedBounds.height : 768,
    x: savedBounds ? savedBounds.x : undefined,
    y: savedBounds ? savedBounds.y : undefined,
    minWidth: 800,
    minHeight: 600,
    icon: path.join(__dirname, 'favicon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.on('close', () => {
    store.set(WINDOW_BOUNDS_KEY, mainWindow.getBounds());
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadFile('index.html');
}

// ── IPC: electron-store ──────────────────────────────────
ipcMain.on('store-get', (event, key) => {
  event.returnValue = store.get(key, null);
});
ipcMain.on('store-set', (event, key, value) => {
  store.set(key, value);
  event.returnValue = true;
});
ipcMain.on('store-delete', (event, key) => {
  store.delete(key);
  event.returnValue = true;
});
ipcMain.on('store-has', (event, key) => {
  event.returnValue = store.has(key);
});

// ── IPC: auto-updater ────────────────────────────────────
ipcMain.on('check-for-updates', () => {
  autoUpdater.checkForUpdates();
});

ipcMain.on('download-update', () => {
  autoUpdater.downloadUpdate();
});

ipcMain.on('install-update', () => {
  autoUpdater.quitAndInstall();
});

// Forward updater events to renderer
autoUpdater.on('update-available', (info) => {
  mainWindow.webContents.send('update-available', info);
});

autoUpdater.on('update-not-available', () => {
  mainWindow.webContents.send('update-not-available');
});

autoUpdater.on('download-progress', (progress) => {
  mainWindow.webContents.send('download-progress', progress);
});

autoUpdater.on('update-downloaded', (info) => {
  mainWindow.webContents.send('update-downloaded', info);
});

autoUpdater.on('error', (err) => {
  mainWindow.webContents.send('update-error', err.message);
});

// ── App lifecycle ────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();

  // Check for updates silently after window is ready
  mainWindow.webContents.once('did-finish-load', () => {
    autoUpdater.checkForUpdates();
  });

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
