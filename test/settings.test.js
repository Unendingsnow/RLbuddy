'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SettingsStore, normalizeSettings } = require('../src/settings');
const encryption = {
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async text => Buffer.from(`encrypted:${text}`),
  decryptStringAsync: async bytes => bytes.toString().replace(/^encrypted:/, ''),
};
function temporary(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlbuddy-settings-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
test('settings constrain overlay values and reject malformed nested input', () => {
  const settings = normalizeSettings({ ai: null, vision: [], overlayScale: 100, personalityId: '../../escape', spice: 9 });
  assert.equal(settings.overlayScale, 1.5); assert.equal(settings.personalityId, 'jackshaft'); assert.equal(settings.spice, 2);
});
test('keys are encrypted at rest, never returned to UI, and cleared when endpoints change', async t => {
  const store = new SettingsStore(temporary(t), encryption); await store.load();
  await store.save({ ai: { apiKey: 'secret-value', enabled: true } });
  assert.equal(store.public().ai.apiKey, undefined); assert.equal(store.public().ai.hasKey, true);
  assert.equal(fs.readFileSync(store.file, 'utf8').includes('secret-value'), false);
  assert.equal(store.private().ai.apiKey, 'secret-value');
  await store.save({ ai: { provider: 'compatible', baseUrl: 'https://example.com/v1' } });
  assert.equal(store.private().ai.apiKey, '');
});
test('capture never resumes without opting in again after restart', async t => {
  const dir = temporary(t); const store = new SettingsStore(dir, encryption); await store.load();
  await store.save({ vision: { enabled: true, sourceId: 'window:123', sourceName: 'Rocket League' } });
  const next = new SettingsStore(dir, encryption); await next.load(); assert.equal(next.settings.vision.enabled, false);
  assert.equal(next.settings.vision.sourceName, 'Rocket League');
});
test('concurrent patches preserve both updates and nested values', async t => {
  const store = new SettingsStore(temporary(t), encryption); await store.load();
  await Promise.all([store.save({ playerName: 'Player' }), store.save({ spice: 2 }), store.save({ ai: { model: 'custom-model' } })]);
  assert.equal(store.settings.playerName, 'Player'); assert.equal(store.settings.spice, 2);
  assert.equal(store.settings.ai.provider, 'openai-realtime'); assert.equal(store.settings.ai.model, 'custom-model');
});
