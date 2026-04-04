const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronStore', {
    get: (key) => ipcRenderer.invoke('store-get', key),
    set: (key, value) => ipcRenderer.invoke('store-set', key, value),
    delete: (key) => ipcRenderer.invoke('store-delete', key),
    has: (key) => ipcRenderer.invoke('store-has', key),
});

contextBridge.exposeInMainWorld('tray', {
    onNavigateToToday: (cb) => ipcRenderer.on('navigate-to-today', () => cb()),
});

contextBridge.exposeInMainWorld('app', {
    quit: () => ipcRenderer.invoke('app-quit'),
});

contextBridge.exposeInMainWorld('updater', {
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    downloadUpdate: () => ipcRenderer.invoke('download-update'),
    installUpdate: () => ipcRenderer.invoke('install-update'),
    onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_, info) => cb(info)),
    onUpdateNotAvailable: (cb) => ipcRenderer.on('update-not-available', () => cb()),
    onDownloadProgress: (cb) => ipcRenderer.on('download-progress', (_, progress) => cb(progress)),
    onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', (_, info) => cb(info)),
    onError: (cb) => ipcRenderer.on('update-error', (_, msg) => cb(msg)),
});
