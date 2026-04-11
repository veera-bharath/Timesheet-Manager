const { app, BrowserWindow, Menu, shell, ipcMain, screen, Tray, nativeImage, Notification, dialog, clipboard } = require('electron');
const path = require('path');
const fs   = require('fs');
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater');

const store = new Store();
const WINDOW_BOUNDS_KEY   = 'windowBounds';
const LS_KEY              = 'timesheetState_v1';
const NOTIFICATION_KEY    = 'notificationSettings';
const BACKUP_SETTINGS_KEY = 'backupSettings';

// ── BACKUP HELPERS ───────────────────────────────────────
function getDefaultBackupFolder() {
  return path.join(app.getPath('documents'), 'TimesheetBackups');
}

function getBackupFolder() {
  const settings = store.get(BACKUP_SETTINGS_KEY) || {};
  return settings.folder || getDefaultBackupFolder();
}

function writeBackupFile() {
  const folder = getBackupFolder();
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

  const now      = new Date();
  const pad      = n => String(n).padStart(2, '0');
  const stamp    = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const filePath = path.join(folder, `timesheet-backup-${stamp}.json`);

  const backup = {
    version:    app.getVersion(),
    exportedAt: now.toISOString(),
    data:       store.get(LS_KEY) || {},
  };
  fs.writeFileSync(filePath, JSON.stringify(backup, null, 2), 'utf8');

  const settings = store.get(BACKUP_SETTINGS_KEY) || {};
  store.set(BACKUP_SETTINGS_KEY, { ...settings, lastBackupAt: now.toISOString() });

  return { filePath, exportedAt: now.toISOString() };
}

function pruneOldBackups() {
  const folder = getBackupFolder();
  if (!fs.existsSync(folder)) return;

  const settings      = store.get(BACKUP_SETTINGS_KEY) || {};
  const retentionDays = settings.retentionDays ?? 30;
  const cutoff        = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  fs.readdirSync(folder)
    .filter(f => f.startsWith('timesheet-backup-') && f.endsWith('.json'))
    .forEach(file => {
      const filePath = path.join(folder, file);
      try {
        if (fs.statSync(filePath).mtimeMs < cutoff) fs.unlinkSync(filePath);
      } catch (_) { /* skip */ }
    });
}

function isBackupDue() {
  const settings  = store.get(BACKUP_SETTINGS_KEY) || {};
  if (settings.enabled === false) return false;

  const frequency  = settings.frequency  || 'weekly';
  const dayOfWeek  = settings.dayOfWeek  ?? 1;   // 1=Mon … 5=Fri (matches JS getDay())
  const hour       = settings.hour       ?? 9;
  const lastBackup = settings.lastBackupAt ? new Date(settings.lastBackupAt) : null;
  const now        = new Date();

  if (now.getHours() < hour) return false;
  if (!lastBackup) return true;

  if (frequency === 'daily') {
    return lastBackup.toDateString() !== now.toDateString();
  }
  if (frequency === 'weekly') {
    if (now.getDay() !== dayOfWeek) return false;
    return lastBackup < new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  if (frequency === 'monthly') {
    return lastBackup.getMonth() !== now.getMonth() ||
           lastBackup.getFullYear() !== now.getFullYear();
  }
  return false;
}

function checkAutoBackup() {
  try {
    if (!isBackupDue()) return;
    writeBackupFile();
    pruneOldBackups();
  } catch (e) {
    console.warn('[backup] Auto-backup failed:', e.message);
  }
}

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

// ── IPC: backup ──────────────────────────────────────────
ipcMain.handle('backup:export', () => writeBackupFile());
ipcMain.handle('backup:get-folder', () => getBackupFolder());
ipcMain.handle('backup:open-json', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'Backup Files', extensions: ['json'] }],
    properties: ['openFile'],
    title: 'Open Backup File',
  });
  if (result.canceled || !result.filePaths.length) return null;
  const raw = fs.readFileSync(result.filePaths[0], 'utf8');
  return JSON.parse(raw);
});
ipcMain.handle('backup:choose-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choose Backup Folder',
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});
ipcMain.handle('backup:open-txt', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'Timesheet Report', extensions: ['txt'] }],
    properties: ['openFile'],
    title: 'Open TXT Report',
  });
  if (result.canceled || !result.filePaths.length) return null;
  const raw = fs.readFileSync(result.filePaths[0], 'utf8');
  try {
    return parseTxtReport(raw);
  } catch (e) {
    return { error: e.message || 'Failed to parse TXT report.' };
  }
});

// ── TXT REPORT PARSER ────────────────────────────────────
function parseTxtReport(text) {
  const MONTH_MAP = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
    Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
  };

  function parseDisplayDate(str) {
    // DD-Mon-YYYY → YYYY-MM-DD
    const m = str.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
    if (!m) return null;
    const month = MONTH_MAP[m[2]];
    if (!month) return null;
    return `${m[3]}-${month}-${m[1]}`;
  }

  const lines = text.split(/\r?\n/);
  const allDaysByDate = {};
  let currentDate = null;
  let isHoliday = false;
  let holidayLabelSet = false;

  // Regex to identify a day header line: DD-Mon-YYYY :
  const DAY_HEADER = /^(\d{2}-[A-Za-z]{3}-\d{4}) :(.*)/;
  // Regex to strip leading roman numeral: i), ii), iii), etc.
  const ROMAN_PREFIX = /^[ivxlcdm]+\)\s*/i;
  // Regex to extract (HH:MM) time token
  const TIME_TOKEN = /\((\d{1,2}):(\d{2})\)/;

  let lineIdx = 0;

  // Skip title line (first non-empty line) and separator
  while (lineIdx < lines.length && lines[lineIdx].trim() === '') lineIdx++;
  lineIdx++; // skip title
  while (lineIdx < lines.length && lines[lineIdx].trim() === '') lineIdx++;
  if (lineIdx < lines.length && lines[lineIdx].trim().startsWith('---')) lineIdx++; // skip separator

  for (; lineIdx < lines.length; lineIdx++) {
    const raw = lines[lineIdx];

    // Day header
    const headerMatch = raw.match(DAY_HEADER);
    if (headerMatch) {
      const isoDate = parseDisplayDate(headerMatch[1]);
      if (!isoDate) continue;
      currentDate = isoDate;
      const rest = headerMatch[2].trim();
      isHoliday = rest === '' || !/\d{2}:\d{2}/.test(rest);
      holidayLabelSet = false;
      if (!allDaysByDate[currentDate]) {
        allDaysByDate[currentDate] = {
          date: currentDate,
          isHoliday,
          entries: [],
        };
      }
      continue;
    }

    // Tab-indented line (entry or holiday label)
    if (currentDate && raw.startsWith('\t')) {
      const stripped = raw.replace(/^\t/, '').replace(ROMAN_PREFIX, '');

      if (isHoliday) {
        // First indented line on a holiday day = the leave label
        if (!holidayLabelSet) {
          allDaysByDate[currentDate].holidayLabel = stripped.trim();
          holidayLabelSet = true;
        }
        continue;
      }

      // Normal entry: ticket (11 chars padded), then (HH:MM), then optional " - desc"
      const timeMatch = stripped.match(TIME_TOKEN);
      if (!timeMatch) {
        // Continuation line for previous entry's multi-line desc
        const day = allDaysByDate[currentDate];
        if (day.entries.length > 0) {
          const last = day.entries[day.entries.length - 1];
          last.desc = (last.desc ? last.desc + '\n' : '') + stripped.trim();
        }
        continue;
      }

      const timeIdx = stripped.indexOf(timeMatch[0]);
      const ticket = stripped.substring(0, timeIdx).trim();
      const hh = String(parseInt(timeMatch[1], 10));
      const mm = String(timeMatch[2]).padStart(2, '0');

      // Everything after the time token
      const afterTime = stripped.substring(timeIdx + timeMatch[0].length).trim();
      // Desc starts after "- " if present
      const desc = afterTime.startsWith('- ')
        ? afterTime.substring(2).trim()
        : afterTime;

      allDaysByDate[currentDate].entries.push({
        ticket,
        hh,
        mm,
        type: 'jira',
        desc,
      });
      continue;
    }

    // Continuation line for multi-line desc (deeply indented, no tab prefix captured above)
    if (currentDate && !isHoliday && raw.startsWith('  ') && raw.trim() !== '') {
      const day = allDaysByDate[currentDate];
      if (day.entries.length > 0) {
        const last = day.entries[day.entries.length - 1];
        last.desc = (last.desc ? last.desc + '\n' : '') + raw.trim();
      }
    }
  }

  if (Object.keys(allDaysByDate).length === 0) {
    throw new Error('No timesheet days found in this file.');
  }

  return allDaysByDate;
}

// ── IPC: clipboard ───────────────────────────────────────
ipcMain.handle('clipboard:read',  () => clipboard.readText());
ipcMain.handle('clipboard:write', (_, text) => clipboard.writeText(text));

// ── IPC: app control ─────────────────────────────────────
ipcMain.handle('app-quit', () => { isQuitting = true; app.quit(); });

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

// ── Single instance lock ─────────────────────────────────
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());
}

// ── App lifecycle ────────────────────────────────────────
app.on('before-quit', () => { isQuitting = true; });

app.whenReady().then(() => {
  createWindow();
  createTray();
  scheduleNotifications();

  // Check for updates and run auto-backup silently after window is ready
  mainWindow.webContents.once('did-finish-load', () => {
    autoUpdater.checkForUpdates();
    checkAutoBackup();
  });

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
