const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronUpdater', {
  isPackaged: ipcRenderer.sendSync('update:is-packaged'),
  getVersion: () => ipcRenderer.invoke('update:get-version'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  quitAndInstall: () => ipcRenderer.invoke('update:install'),
  onEvent: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('update:event', listener);
    return () => ipcRenderer.removeListener('update:event', listener);
  }
});

contextBridge.exposeInMainWorld('appAuth', {
  getToken: () => ipcRenderer.invoke('auth:get-token')
});
