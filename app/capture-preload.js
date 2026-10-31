"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("captureBridge", {
  frame: (frame) => ipcRenderer.send("capture:frame", frame),
  status: (status) => ipcRenderer.send("capture:status", status),
});
