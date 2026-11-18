const { contextBridge, ipcRenderer } = require('electron');
const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('nativeFs', {
  pick: (title) => call('fs:pick', title),
  last: () => call('fs:last'),
  remember: (id) => call('fs:remember', id),
  list: (id, rel) => call('fs:list', id, rel),
  stat: (id, rel) => call('fs:stat', id, rel),
  read: async (id, rel) => new Uint8Array(await call('fs:read', id, rel)),
  write: (id, rel, bytes) => call('fs:write', id, rel, bytes),
  mkdir: (id, rel) => call('fs:mkdir', id, rel),
  remove: (id, rel, recursive) => call('fs:remove', id, rel, recursive),
});
contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  platform: process.platform,
  info: () => call('app:info'),
  onContextInfo: (cb) => ipcRenderer.on('ctx-info', (_e, info) => cb(info)),
  replaceMisspelling: (w) => call('spell:replace', w),
  addToDictionary: (w) => call('spell:add', w),
  paste: (plain) => call('clip:paste', !!plain),
});
