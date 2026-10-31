"use strict";
// Development-only real Electron capture check: no images written or sent online.
const { app } = require("electron");
const { LiveCapture } = require("./live-capture");
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  let capture;
  const timeout = setTimeout(() => { console.error("CAPTURE_SMOKE_TIMEOUT"); capture?.dispose(); app.exit(1); }, 20000);
  capture = new LiveCapture({
    onStatus: (status) => console.log("STATUS", JSON.stringify(status)),
    onFrame: (frame) => { console.log("CAPTURE_SMOKE_OK", JSON.stringify({ capturedAt: frame.capturedAt, bytes: frame.dataUrl.length })); clearTimeout(timeout); capture.dispose(); app.exit(0); },
  });
  const sources = await capture.listSources();
  console.log("SOURCE_COUNT", sources.length);
  const selected = sources.find((source) => source.id.startsWith("screen:"));
  if (!selected) throw new Error("No display to test");
  const result = await capture.start({ sourceId: selected.id, sourceName: selected.name, intervalSeconds: 2 });
  console.log("START", result);
  if (!result.ok) { clearTimeout(timeout); capture.dispose(); app.exit(1); }
}).catch((error) => { console.error(error); app.exit(1); });
