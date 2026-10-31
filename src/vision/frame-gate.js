"use strict";

// Shared pure logic, loaded in the capture page and exercised with Node tests.
((root, factory) => {
  const exports = factory();
  if (typeof module === "object" && module.exports) module.exports = exports;
  else root.FrameSelection = exports;
})(typeof globalThis === "object" ? globalThis : this, () => {
  const INTERVALS = [2, 3, 5, 8, 12];
  function intervalSeconds(value) { return INTERVALS.includes(Number(value)) ? Number(value) : 3; }
  function sceneDifference(current, previous) {
    if (!previous || previous.length !== current.length) return 255;
    let sum = 0; let count = 0;
    for (let i = 0; i < current.length; i += 4) {
      sum += Math.abs(current[i] - previous[i]) + Math.abs(current[i + 1] - previous[i + 1]) + Math.abs(current[i + 2] - previous[i + 2]);
      count += 3;
    }
    return count ? sum / count : 0;
  }
  class FrameGate {
    constructor({ seconds = 3, threshold = 3 } = {}) { this.intervalMs = intervalSeconds(seconds) * 1000; this.threshold = threshold; this.reset(); }
    reset() { this.lastSentAt = null; this.previous = null; }
    shouldSend(pixels, now) {
      if (!pixels || !pixels.length || pixels.length % 4 !== 0 || !Number.isFinite(now)) return false;
      if (this.lastSentAt !== null && now - this.lastSentAt < this.intervalMs) return false;
      return sceneDifference(pixels, this.previous) >= this.threshold;
    }
    markSent(pixels, now) { this.previous = Uint8ClampedArray.from(pixels); this.lastSentAt = now; }
  }
  function outputSize(width, height) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return { width: 0, height: 0 };
    const scale = Math.min(1, 960 / width, 540 / height);
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  }
  return { FrameGate, sceneDifference, outputSize, intervalSeconds };
});
