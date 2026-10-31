"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { FrameGate, sceneDifference, outputSize, intervalSeconds } = require("../src/vision/frame-gate");
const pixels = (value) => new Uint8ClampedArray([value, value, value, 255, value, value, value, 255]);

test("continuous capture samples immediately then respects the analysis interval", () => {
  const gate = new FrameGate({ seconds: 3 });
  assert.equal(gate.shouldSend(pixels(10), 1000), true);
  gate.markSent(pixels(10), 1000);
  assert.equal(gate.shouldSend(pixels(200), 3999), false);
  assert.equal(gate.shouldSend(pixels(200), 4000), true);
});
test("static video frames and encoding noise do not trigger repeated analysis", () => {
  const gate = new FrameGate({ seconds: 2 });
  gate.markSent(pixels(50), 1000);
  assert.equal(gate.shouldSend(pixels(50), 10000), false);
  assert.equal(gate.shouldSend(pixels(52), 20000), false);
  assert.equal(gate.shouldSend(pixels(60), 21000), true);
});
test("scene comparison uses last transmitted frame so slow scene changes accumulate", () => {
  const gate = new FrameGate({ seconds: 2 });
  gate.markSent(pixels(50), 1000);
  assert.equal(gate.shouldSend(pixels(51), 5000), false);
  assert.equal(gate.shouldSend(pixels(52), 6000), false);
  assert.equal(gate.shouldSend(pixels(53), 7000), true);
});
test("frame baseline is copied and reset permits a fresh source immediately", () => {
  const gate = new FrameGate();
  const original = pixels(50);
  gate.markSent(original, 1000);
  original.fill(250);
  assert.equal(gate.shouldSend(pixels(50), 9000), false);
  gate.reset();
  assert.equal(gate.shouldSend(pixels(50), 1001), true);
});
test("analysis intervals are bounded to user-facing choices", () => {
  for (const seconds of [2, 3, 5, 8, 12]) assert.equal(intervalSeconds(seconds), seconds);
  for (const seconds of [0, -1, 1000, undefined, NaN]) assert.equal(intervalSeconds(seconds), 3);
});
test("frame dimensions remain within 960x540 without distorting aspect ratio", () => {
  assert.deepEqual(outputSize(1920, 1080), { width: 960, height: 540 });
  assert.deepEqual(outputSize(3840, 1080), { width: 960, height: 270 });
  assert.deepEqual(outputSize(1080, 1920), { width: 304, height: 540 });
  assert.deepEqual(outputSize(320, 180), { width: 320, height: 180 });
  assert.deepEqual(outputSize(0, 0), { width: 0, height: 0 });
});
test("scene differences ignore alpha and malformed samples are rejected", () => {
  assert.equal(sceneDifference(new Uint8ClampedArray([10, 10, 10, 0]), new Uint8ClampedArray([10, 10, 10, 255])), 0);
  const gate = new FrameGate();
  assert.equal(gate.shouldSend([], 1), false);
  assert.equal(gate.shouldSend([1, 2, 3], 1), false);
});
