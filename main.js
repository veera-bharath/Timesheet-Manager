const { app, BrowserWindow, Menu, shell, ipcMain, screen } = require('electron');
const path = require('path');
const Store = require('electron-store');

const store = new Store();
const WINDOW_BOUNDS_KEY = 'windowBounds';

function getValidBounds() {
  const saved = store.get(WINDOW_BOUNDS_KEY);
  if (!saved) return null;

  // Check saved bounds are within at least one connected display
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

function createWindow() {
  const savedBounds = getValidBounds();

  const mainWindow = new BrowserWindow({
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

  // Save window bounds on close
  mainWindow.on('close', () => {
    store.set(WINDOW_BOUNDS_KEY, mainWindow.getBounds());
  });

  // Handle external links safely
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Remove the default menu bar to keep the clean UI design
  Menu.setApplicationMenu(null);

  // Load the index.html of the app.
  mainWindow.loadFile('index.html');

  // Open the DevTools if needed (commented out for production)
  // mainWindow.webContents.openDevTools();
}

// IPC handlers for electron-store
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

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
