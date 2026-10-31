'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SafetyPause } = require('../src/safety-pause');
const { SettingsStore } = require('../src/settings');
const { AiGate } = require('../src/ai-gate');

test('emergency pause stops immediately and blocks AI even when settings cannot be saved', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlbuddy-pause-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // A missing settings directory causes an actual write failure without mocking I/O.
  const store = new SettingsStore(path.join(dir, 'unavailable'), {});
  store.settings.vision.enabled = true; store.settings.memory.capture = true;
  let captureActive = true, requestAborted = false;
  const safety = new SafetyPause(() => { captureActive = false; requestAborted = true; });
  const patch = safety.patch({ paused: true });
  const generation = safety.request(patch);
  assert.equal(captureActive, false); assert.equal(requestAborted, true);
  await assert.rejects(store.save(patch).then(() => safety.saved(patch, generation)), { code: 'ENOENT' });
  assert.equal(store.settings.paused, false);
  const effective = safety.apply(store.public());
  assert.equal(effective.paused, true); assert.equal(effective.vision.enabled, false); assert.equal(effective.memory.capture, false);
  const gate = new AiGate({ getSettings: () => safety.apply(store.settings), ledger: {} });
  assert.throws(() => gate.acquire({ provider: 'ollama', model: 'local' }), /paused/);
});

test('an older resume write cannot release a newer emergency pause', () => {
  const safety = new SafetyPause(() => {});
  safety.request({ paused: true });
  const resume = safety.patch({ paused: false });
  const oldGeneration = safety.request(resume);
  safety.request({ paused: true });
  safety.saved(resume, oldGeneration);
  assert.equal(safety.apply({ paused: false }).paused, true);
  const newGeneration = safety.request(resume);
  safety.saved(resume, newGeneration);
  assert.equal(safety.apply(resume).paused, false);
  assert.equal(resume.vision.enabled, false); assert.equal(resume.memory.capture, false);
});

for (const channel of ['vision', 'memory']) {
  test(`${channel} capture stops despite a disk failure without pausing event/chat AI`, async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlbuddy-capture-stop-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const store = new SettingsStore(path.join(dir, 'unavailable'), {});
    store.settings.vision.enabled = true; store.settings.memory.capture = true; store.settings.ai.enabled = true;
    let captureActive = true, observationCancelled = false, aiPaused = false;
    const safety = new SafetyPause(() => { aiPaused = true; }, () => { captureActive = false; observationCancelled = true; });
    const patch = channel === 'vision' ? { vision: { enabled: false } } : { memory: { capture: false } };
    const generation = safety.request(patch);
    assert.equal(captureActive, false); assert.equal(observationCancelled, true); assert.equal(aiPaused, false);
    await assert.rejects(store.save(patch).then(() => safety.saved(patch, generation)), { code: 'ENOENT' });
    const effective = safety.apply(store.settings);
    assert.equal(effective.paused, false); assert.equal(effective.ai.enabled, true);
    assert.equal(effective.vision.enabled, channel !== 'vision');
    assert.equal(effective.memory.capture, channel !== 'memory');
    const gate = new AiGate({ getSettings: () => safety.apply(store.settings), ledger: {} });
    const ticket = gate.acquire({ provider: 'ollama', model: 'local', kind: 'chat' });
    ticket.account({}); ticket.release();
  });

  test(`stale ${channel} capture enable cannot undo a newer stop`, () => {
    const safety = new SafetyPause(() => {});
    const disabled = channel === 'vision' ? { vision: { enabled: false } } : { memory: { capture: false } };
    const enabled = channel === 'vision' ? { vision: { enabled: true } } : { memory: { capture: true } };
    const settings = { paused: false, vision: { enabled: true }, memory: { capture: true } };
    const isEnabled = () => channel === 'vision' ? safety.apply(settings).vision.enabled : safety.apply(settings).memory.capture;
    safety.request(disabled);
    const oldEnable = safety.request(enabled);
    safety.request(disabled);
    safety.saved(enabled, oldEnable);
    assert.equal(isEnabled(), false);
    // An unrelated successful save cannot clear the failed stop's runtime latch.
    safety.saved({ spice: 2 }, safety.request({ spice: 2 }));
    assert.equal(isEnabled(), false);
    const currentEnable = safety.request(enabled);
    assert.equal(isEnabled(), false); // stay stopped until persistence succeeds
    safety.saved(enabled, currentEnable);
    assert.equal(isEnabled(), true);
  });
}

test('capture channels re-enable independently and pause/resume keeps both off', () => {
  const safety = new SafetyPause(() => {});
  const settings = { paused: false, vision: { enabled: true }, memory: { capture: true } };
  safety.request({ vision: { enabled: false }, memory: { capture: false } });
  const enableVision = { vision: { enabled: true } };
  safety.saved(enableVision, safety.request(enableVision));
  assert.equal(safety.apply(settings).vision.enabled, true);
  assert.equal(safety.apply(settings).memory.capture, false);
  const pause = safety.patch({ paused: true }); safety.request(pause);
  const resume = safety.patch({ paused: false }); safety.saved(resume, safety.request(resume));
  assert.equal(safety.apply(settings).paused, false);
  assert.equal(safety.apply(settings).vision.enabled, false);
  assert.equal(safety.apply(settings).memory.capture, false);
});
