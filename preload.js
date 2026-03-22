const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronStore', {
    get: (key) => ipcRenderer.sendSync('store-get', key),
    set: (key, value) => ipcRenderer.sendSync('store-set', key, value),
    delete: (key) => ipcRenderer.sendSync('store-delete', key),
    has: (key) => ipcRenderer.sendSync('store-has', key),
});
