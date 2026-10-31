'use strict';
// Rasterize our own vector mascot for the Windows executable's icon.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
app.whenReady().then(async () => {
  const art = fs.readFileSync(path.join(__dirname,'../app/renderer/assets/pumpkin-badge.svg'),'utf8');
  const html = `<html><head><style>html,body{margin:0;width:256px;height:256px;overflow:hidden;background:#132629}svg{width:256px;height:256px}</style></head><body>${art}</body></html>`;
  const win = new BrowserWindow({ width: 256, height: 256, show: false, frame: false, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise(resolve => setTimeout(resolve, 200));
  const png = (await win.webContents.capturePage()).toPNG();
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
  const dir = path.join(__dirname, '../build'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'icon.ico'), Buffer.concat([header, png]));
  fs.writeFileSync(path.join(dir, 'icon.png'), png);
  app.exit(0);
}).catch(error => { console.error(error.message); app.exit(1); });
