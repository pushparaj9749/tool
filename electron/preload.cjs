const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('forgeDesktop', {
  isDesktopApp: true,
  platform: process.platform,
  arch: process.arch,
  version: '1.0.0',
});
