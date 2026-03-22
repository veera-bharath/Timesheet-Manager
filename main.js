const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const Store = require('electron-store');

const store = new Store();

function createWindow() {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 800,
    minHeight: 600,
    icon: path.join(__dirname, 'favicon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
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

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
