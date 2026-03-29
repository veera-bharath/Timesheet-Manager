const { app, BrowserWindow, Menu, shell, ipcMain, screen, Tray, nativeImage, Notification } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater');

const store = new Store();
const WINDOW_BOUNDS_KEY = 'windowBounds';
const LS_KEY = 'timesheetState_v1';
const NOTIFICATION_KEY = 'notificationSettings';

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

function minsToHHMM(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function getTodayStats() {
  const saved = store.get(LS_KEY);
  const targetMins = saved?.dailyTargetMins || 480;
  if (!saved) return { totalMins: 0, targetMins, isHoliday: false };

  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const dayData = saved.allDaysByDate?.[dateStr];

  if (!dayData) return { totalMins: 0, targetMins, isHoliday: false };
  if (dayData.isHoliday || dayData.leaveTypeId) return { totalMins: 0, targetMins, isHoliday: true };

  const totalMins = (dayData.entries || []).reduce((sum, e) =>
    sum + (parseInt(e.hh) || 0) * 60 + (parseInt(e.mm) || 0), 0);

  return { totalMins, targetMins, isHoliday: false };
}

let mainWindow;
let tray = null;
let isQuitting = false;

function showMainWindow() {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('navigate-to-today');
}

function buildTrayMenu() {
  const { totalMins, targetMins, isHoliday } = getTodayStats();
  const statusLabel = isHoliday
    ? 'Today: Holiday / Leave'
    : `Today: ${minsToHHMM(totalMins)} / ${minsToHHMM(targetMins)}`;

  return Menu.buildFromTemplate([
    { label: statusLabel, enabled: false },
    { type: 'separator' },
    { label: 'Open Timesheet Manager', click: () => showMainWindow() },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } }
  ]);
}

function createTray() {
  const iconPath = path.join(__dirname, '../../favicon.png');
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Timesheet Manager');
  tray.setContextMenu(buildTrayMenu());

  tray.on('click', () => showMainWindow());
  tray.on('right-click', () => {
    tray.setContextMenu(buildTrayMenu());
    tray.popUpContextMenu();
  });
}

function scheduleNotifications() {
  setInterval(() => {
    const settings = store.get(NOTIFICATION_KEY, { enabled: true, time: '17:30', lastFiredDate: '' });
    if (!settings.enabled) return;

    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    if (currentTime !== settings.time) return;
    if (settings.lastFiredDate === todayStr) return;

    const { totalMins, targetMins, isHoliday } = getTodayStats();
    if (isHoliday || totalMins >= targetMins) return;

    const remaining = targetMins - totalMins;
    const notification = new Notification({
      title: 'Timesheet Manager',
      body: `Don't forget to log your time!\nToday: ${minsToHHMM(totalMins)} logged — ${minsToHHMM(remaining)} remaining`,
      icon: iconPath(),
    });

    notification.on('click', () => showMainWindow());
    notification.show();

    store.set(NOTIFICATION_KEY, { ...settings, lastFiredDate: todayStr });
  }, 30000); // check every 30 seconds
}

function iconPath() {
  return path.join(__dirname, '../../favicon.png');
}

function createWindow() {
  const savedBounds = getValidBounds();

  mainWindow = new BrowserWindow({
    width: savedBounds ? savedBounds.width : 1366,
    height: savedBounds ? savedBounds.height : 768,
    x: savedBounds ? savedBounds.x : undefined,
    y: savedBounds ? savedBounds.y : undefined,
    minWidth: 800,
    minHeight: 600,
    icon: path.join(__dirname, '../../favicon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload/index.js')
    }
  });

  mainWindow.on('close', (e) => {
    store.set(WINDOW_BOUNDS_KEY, mainWindow.getBounds());
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  Menu.setApplicationMenu(null);

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

// ── IPC: electron-store ──────────────────────────────────
ipcMain.handle('store-get', (_event, key) => store.get(key, null));
ipcMain.handle('store-set', (_event, key, value) => { store.set(key, value); });
ipcMain.handle('store-delete', (_event, key) => { store.delete(key); });
ipcMain.handle('store-has', (_event, key) => store.has(key));

// ── IPC: auto-updater ────────────────────────────────────
ipcMain.handle('check-for-updates', () => autoUpdater.checkForUpdates());
ipcMain.handle('download-update', () => autoUpdater.downloadUpdate());
ipcMain.handle('install-update', () => autoUpdater.quitAndInstall());

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
app.on('before-quit', () => { isQuitting = true; });

app.whenReady().then(() => {
  createWindow();
  createTray();
  scheduleNotifications();

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
