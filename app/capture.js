"use strict";
(() => {
  const video = document.getElementById("video");
  const small = document.createElement("canvas");
  small.width = 64; small.height = 36;
  const smallContext = small.getContext("2d", { willReadFrequently: true });
  const output = document.createElement("canvas");
  const outputContext = output.getContext("2d", { alpha: false });
  let stream = null;
  let timer = null;
  let generation = 0;
  let lastVideoTime = -1;
  let lastHeartbeat = 0;
  let latestFrameAt = 0;
  let lastSampleAt = 0;

  function stop() {
    generation += 1;
    clearInterval(timer); timer = null;
    if (stream) for (const track of stream.getTracks()) track.stop();
    stream = null;
    video.pause(); video.srcObject = null;
    output.width = 0; output.height = 0;
  }
  window.stopCapture = stop;
  window.addEventListener("beforeunload", stop);

  window.startCapture = async ({ sourceId, intervalSeconds = 3, legacy = false } = {}) => {
    stop();
    const run = generation;
    const gate = new window.FrameSelection.FrameGate({ seconds: intervalSeconds });
    try {
      const acquired = legacy
        ? await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: sourceId, maxWidth: 1280, maxHeight: 720, maxFrameRate: 15 } } })
        : await navigator.mediaDevices.getDisplayMedia({ audio: false, video: { frameRate: { ideal: 15, max: 15 }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      if (generation !== run) { for (const track of acquired.getTracks()) track.stop(); return { ok: false, error: "Capture was stopped." }; }
      stream = acquired;
      const track = stream.getVideoTracks()[0];
      if (!track || track.readyState !== "live") throw new Error("The selected source did not provide a live video track.");
      track.addEventListener("ended", () => {
        if (generation !== run) return;
        stop();
        window.captureBridge.status({ active: false, text: "Capture source closed. Select the game window again." });
      }, { once: true });
      video.srcObject = stream;
      await video.play();
      if (generation !== run) return { ok: false, error: "Capture was stopped." };
      lastVideoTime = -1; lastHeartbeat = 0; latestFrameAt = 0; lastSampleAt = 0;
      timer = setInterval(() => {
        if (generation !== run || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
        const now = Date.now();
        // A blocked/minimized source may freeze. Never upload the same stale video frame.
        const fresh = video.currentTime !== lastVideoTime;
        if (fresh) { latestFrameAt = now; lastVideoTime = video.currentTime; }
        if (now - lastHeartbeat > 5000) {
          lastHeartbeat = now;
          window.captureBridge.status({ active: true, text: fresh ? "Watching live video · 15 fps" : "Video stream is open; waiting for a fresh frame", lastCaptureAt: latestFrameAt, lastSampleAt });
        }
        if (!fresh) return;
        try {
          smallContext.drawImage(video, 0, 0, 64, 36);
          const pixels = smallContext.getImageData(0, 0, 64, 36).data;
          if (!gate.shouldSend(pixels, now)) return;
          const size = window.FrameSelection.outputSize(video.videoWidth, video.videoHeight);
          if (output.width !== size.width || output.height !== size.height) { output.width = size.width; output.height = size.height; }
          outputContext.drawImage(video, 0, 0, size.width, size.height);
          const dataUrl = output.toDataURL("image/jpeg", 0.65);
          if (dataUrl.length > 900000) throw new Error("Captured frame exceeds the size limit.");
          gate.markSent(pixels, now); lastSampleAt = now;
          window.captureBridge.frame({ dataUrl, capturedAt: now, changed: true });
        } catch (error) {
          stop();
          window.captureBridge.status({ active: false, text: `Capture stopped: ${String(error.message).slice(0, 180)}` });
        }
      }, 250);
      window.captureBridge.status({ active: true, text: "Watching live video · 15 fps" });
      return { ok: true };
    } catch (error) {
      stop();
      return { ok: false, error: String(error.message || error).slice(0, 240), name: error.name || "Error" };
    }
  };
})();
