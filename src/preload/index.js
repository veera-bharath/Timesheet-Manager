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

contextBridge.exposeInMainWorld('nativeClipboard', {
    readText:  () => ipcRenderer.invoke('clipboard:read'),
    writeText: (text) => ipcRenderer.invoke('clipboard:write', text),
});

contextBridge.exposeInMainWorld('backup', {
    export:       () => ipcRenderer.invoke('backup:export'),
    getFolder:    () => ipcRenderer.invoke('backup:get-folder'),
    openJsonFile: () => ipcRenderer.invoke('backup:open-json'),
    openTxtFile:  () => ipcRenderer.invoke('backup:open-txt'),
    chooseFolder: () => ipcRenderer.invoke('backup:choose-folder'),
});

contextBridge.exposeInMainWorld('ai', {
    ask:            (prompt, context) => ipcRenderer.invoke('ai:ask', prompt, context),
    getSettings:    ()               => ipcRenderer.invoke('ai:get-settings'),
    setSettings:    (patch)          => ipcRenderer.invoke('ai:set-settings', patch),
    getMemory:      ()               => ipcRenderer.invoke('ai:get-memory'),
    setMemory:      (entries)        => ipcRenderer.invoke('ai:set-memory', entries),
    updateMemory:   (entry)          => ipcRenderer.invoke('ai:update-memory', entry),
    clearMemory:    ()               => ipcRenderer.invoke('ai:clear-memory'),
    testConnection:    (overrides) => ipcRenderer.invoke('ai:test-connection', overrides),
    getOllamaModels:   (url)      => ipcRenderer.invoke('ai:get-ollama-models', url),
    getGeminiModels:   (apiKey)  => ipcRenderer.invoke('ai:get-gemini-models', apiKey),
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
