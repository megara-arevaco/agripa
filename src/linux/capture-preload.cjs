const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('agripaCapture', {
  action: (name, value) => ipcRenderer.invoke('capture-action', name, value),
  tick: callback => ipcRenderer.on('capture-tick', (_event, seconds) => callback(seconds))
});
