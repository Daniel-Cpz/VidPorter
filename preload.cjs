const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('streamcatch', {
  command: (name, payload) => ipcRenderer.invoke('command', name, payload),
  listen: callback => {
    for (const channel of ['resources', 'jobs', 'navigation', 'notice', 'tabs', 'download-added']) {
      ipcRenderer.on(channel, (_event, value) => callback(channel, value));
    }
  }
});
