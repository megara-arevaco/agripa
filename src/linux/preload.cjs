const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('agripa', {
  action: (name, value) => ipcRenderer.invoke('action', name, value),
  panelState: callback => ipcRenderer.on('panel-state', (_event, state) => callback(state)),
  opacityPreview: callback => ipcRenderer.on('opacity-preview', (_event, opacity) => callback(opacity)),
  openProfiles: callback => ipcRenderer.on('open-profiles', () => callback()),
  openUpdates: callback => ipcRenderer.on('open-updates', () => callback()),
  status: callback => ipcRenderer.on('status', (_event, status) => callback(status))
});
