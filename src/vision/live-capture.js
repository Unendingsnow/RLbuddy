"use strict";

const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { BrowserWindow, desktopCapturer, ipcMain, session } = require("electron");
const { intervalSeconds } = require("./frame-gate");
const CAPTURE_PAGE = path.resolve(__dirname, "../../app/capture.html");
const CAPTURE_URL = pathToFileURL(CAPTURE_PAGE).href;
const isBuddy = (source) => /rl\s*buddy/i.test(source.name);

/** Owns a continuous, silent MediaStream. Only selected fresh JPEG samples leave its renderer. */
class LiveCapture {
  constructor({ onFrame = () => {}, onStatus = () => {} } = {}) {
    this.onFrame = onFrame;
    this.onStatus = onStatus;
    this.window = null;
    this.selected = null;
    this.active = false;
    this.generation = 0;
    this.disposed = false;
    this.lastFrameAt = 0;
    this.lastReceivedAt = 0;
    this.lastDeliveredAt = 0;
    this.processing = false;
    this.pendingFrame = null;
    this.deliveryTimer = null;
    this.intervalMs = 3000;
    this.frameListener = (event, frame) => this.receiveFrame(event, frame);
    this.statusListener = (event, status) => this.receiveStatus(event, status);
    ipcMain.on("capture:frame", this.frameListener);
    ipcMain.on("capture:status", this.statusListener);
  }
  status(status) { this.onStatus({ sourceId: this.selected?.id || null, sourceName: this.selected?.name || null, ...status }); }
  isSender(event) {
    return this.window && !this.window.isDestroyed() && event.sender === this.window.webContents && event.senderFrame === this.window.webContents.mainFrame && event.senderFrame.url === CAPTURE_URL;
  }
  receiveFrame(event, frame) {
    if (!this.active || !this.isSender(event) || !frame || typeof frame !== "object") return;
    const now = Date.now();
    if (typeof frame.dataUrl !== "string" || frame.dataUrl.length > 900000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(frame.dataUrl)) return;
    if (!Number.isFinite(frame.capturedAt) || Math.abs(now - frame.capturedAt) > 10000 || frame.capturedAt <= this.lastFrameAt) return;
    if (this.lastFrameAt && frame.capturedAt - this.lastFrameAt < this.intervalMs) return;
    this.lastFrameAt = frame.capturedAt;
    this.lastReceivedAt = now;
    // Keep at most one pending frame, replacing it while analysis is busy.
    // There is never an accumulating backlog of old gameplay screenshots.
    this.pendingFrame = { dataUrl: frame.dataUrl, capturedAt: frame.capturedAt, changed: true };
    this.deliverLatest();
  }
  deliverLatest() {
    if (!this.active || this.processing || !this.pendingFrame || this.deliveryTimer) return;
    const delay = this.lastDeliveredAt + this.intervalMs - Date.now();
    if (delay > 0) {
      this.deliveryTimer = setTimeout(() => { this.deliveryTimer = null; this.deliverLatest(); }, delay);
      return;
    }
    const frame = this.pendingFrame; this.pendingFrame = null;
    if (Date.now() - frame.capturedAt > 10000) return;
    const run = this.generation;
    this.processing = true;
    this.lastDeliveredAt = Date.now();
    Promise.resolve().then(() => {
      if (this.active && run === this.generation) return this.onFrame(frame);
    }).catch((error) => {
      if (this.active && run === this.generation) this.status({ active: true, text: `Video is live; frame analysis failed: ${String(error.message).slice(0, 140)}` });
    }).finally(() => {
      if (run !== this.generation) return;
      this.processing = false;
      this.deliverLatest();
    });
  }
  receiveStatus(event, status) {
    if (!this.isSender(event) || !status || typeof status.active !== "boolean") return;
    if (!status.active) { this.stop(String(status.text || "Video capture stopped").slice(0, 240), "source-ended"); return; }
    if (!this.active) return;
    this.status({ active: true, text: String(status.text || "Watching live video").slice(0, 240), lastCaptureAt: Number.isFinite(status.lastCaptureAt) ? status.lastCaptureAt : undefined, lastSampleAt: Number.isFinite(status.lastSampleAt) ? status.lastSampleAt : undefined });
  }
  async sources(size = { width: 320, height: 180 }) {
    const items = await desktopCapturer.getSources({ types: ["window", "screen"], thumbnailSize: size, fetchWindowIcons: false });
    return items.filter((item) => !isBuddy(item));
  }
  async listSources() {
    return (await this.sources()).map((item) => ({ id: item.id, name: item.name, thumbnail: item.thumbnail.isEmpty() ? null : item.thumbnail.toDataURL() }));
  }
  async preview(id) {
    try {
      if (typeof id !== "string" || id.length > 256) throw new Error("Choose a capture source first.");
      const selected = (await this.sources({ width: 960, height: 540 })).find((item) => item.id === id);
      if (!selected) throw new Error("That window is no longer available. Refresh the capture sources.");
      if (selected.thumbnail.isEmpty()) throw new Error("This source has no preview. Restore its window and use borderless/windowed mode.");
      return { ok: true, dataUrl: selected.thumbnail.toDataURL() };
    } catch (error) { return { ok: false, error: String(error.message).slice(0, 240) }; }
  }
  async start({ sourceId, sourceName, intervalSeconds: seconds = 3 } = {}) {
    if (this.disposed) return { ok: false, error: "Capture service has been disposed." };
    this.stop();
    const run = this.generation;
    this.intervalMs = intervalSeconds(seconds) * 1000;
    try {
      if (typeof sourceId !== "string" || sourceId.length > 256 || typeof sourceName !== "string" || !sourceName || sourceName.length > 1024) throw new Error("Choose a game window or display first.");
      const selected = (await this.sources({ width: 0, height: 0 })).find((item) => item.id === sourceId && item.name === sourceName);
      if (run !== this.generation) return { ok: false, error: "Capture request cancelled." };
      if (!selected) throw new Error("The selected window changed or closed. Refresh sources and select it again.");
      this.selected = { id: selected.id, name: selected.name };
      const captureSession = session.fromPartition(`rlbuddy-capture-${randomUUID()}`, { cache: false });
      const win = new BrowserWindow({
        width: 320, height: 180, show: false, frame: false, skipTaskbar: true, focusable: false,
        title: "RL Buddy Capture", webPreferences: {
          preload: path.resolve(__dirname, "../../app/capture-preload.js"), session: captureSession,
          sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
          spellcheck: false, webSecurity: true, autoplayPolicy: "no-user-gesture-required",
        },
      });
      this.window = win;
      const own = (contents) => !win.isDestroyed() && contents === win.webContents && contents.getURL() === CAPTURE_URL && this.window === win;
      captureSession.setPermissionRequestHandler((contents, permission, callback, details) => {
        callback(own(contents) && ["display-capture", "media"].includes(permission) && !(details.mediaTypes || []).includes("audio"));
      });
      captureSession.setPermissionCheckHandler((contents, permission, _origin, details) => own(contents) && ["display-capture", "media"].includes(permission) && details.mediaType !== "audio");
      captureSession.setDisplayMediaRequestHandler(async (request, callback) => {
        try {
          if (run !== this.generation || win.isDestroyed() || request.frame !== win.webContents.mainFrame || request.audioRequested || !request.videoRequested) { callback(null); return; }
          const source = (await this.sources({ width: 0, height: 0 })).find((item) => item.id === sourceId && item.name === sourceName);
          if (!source || run !== this.generation || win.isDestroyed()) { callback(null); return; }
          callback({ video: source });
        } catch { callback(null); }
      }, { useSystemPicker: false });
      captureSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] }, (_details, callback) => callback({ cancel: true }));
      captureSession.on("will-download", (event) => event.preventDefault());
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.webContents.on("will-navigate", (event) => event.preventDefault());
      win.webContents.on("will-redirect", (event) => event.preventDefault());
      win.webContents.on("render-process-gone", () => { if (this.window === win) this.stop("Video capture process stopped. Start watching again.", "error"); });
      win.on("closed", () => {
        captureSession.setDisplayMediaRequestHandler(null);
        captureSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
        captureSession.setPermissionCheckHandler(() => false);
        if (this.window === win) this.stop("Video capture stopped", "closed");
      });
      await win.loadFile(CAPTURE_PAGE);
      if (run !== this.generation || win.isDestroyed()) return { ok: false, error: "Capture request cancelled." };
      this.active = true;
      const config = { sourceId, intervalSeconds: intervalSeconds(seconds) };
      const begin = async (options) => {
        let timeout;
        try {
          return await Promise.race([
            win.webContents.executeJavaScript(`window.startCapture(${JSON.stringify(options)})`, true),
            new Promise((_resolve, reject) => { timeout = setTimeout(() => reject(new Error("Video source did not start within 12 seconds. Restore the game window and try again.")), 12000); }),
          ]);
        } finally { clearTimeout(timeout); }
      };
      let result = await begin(config);
      // Hidden documents can fail getDisplayMedia's focus requirement. Electron's
      // documented desktop getUserMedia constraints target the exact same source.
      if (!result.ok && result.name === "InvalidStateError" && run === this.generation) {
        const stillSelected = (await this.sources({ width: 0, height: 0 })).some((item) => item.id === sourceId && item.name === sourceName);
        if (!stillSelected) throw new Error("Selected source closed before capture started.");
        result = await begin({ ...config, legacy: true });
      }
      if (run !== this.generation) return { ok: false, error: "Capture request cancelled." };
      if (!result.ok) throw new Error(result.error || "Unable to start capture.");
      this.status({ active: true, text: "Watching live video · 15 fps" });
      return { ok: true };
    } catch (error) {
      const message = String(error.message || error).slice(0, 240);
      if (run === this.generation) this.stop(`Capture unavailable: ${message}`, "error");
      return { ok: false, error: message };
    }
  }
  stop(text = "Video capture is off", reason = "manual") {
    this.generation += 1;
    this.active = false;
    this.lastFrameAt = 0; this.lastReceivedAt = 0;
    this.lastDeliveredAt = 0; this.processing = false; this.pendingFrame = null;
    clearTimeout(this.deliveryTimer); this.deliveryTimer = null;
    const win = this.window; this.window = null;
    if (win && !win.isDestroyed()) {
      // Destroying this isolated renderer releases every MediaStream track even
      // if page JavaScript has stalled. No recording or media files are created.
      win.destroy();
    }
    this.selected = null;
    this.status({ active: false, text, reason });
  }
  dispose() {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    ipcMain.removeListener("capture:frame", this.frameListener);
    ipcMain.removeListener("capture:status", this.statusListener);
  }
}

module.exports = { LiveCapture };
