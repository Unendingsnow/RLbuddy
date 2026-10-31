'use strict';
const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  playerName: '', personalityId: 'jackshaft', spice: 2, chattiness: 'balanced',
  overlayVisible: true, overlayLocked: true, overlayScale: 1, displayId: null, overlayPosition: null,
  ai: { enabled: false, dynamicReactions: false, provider: 'openai-realtime', baseUrl: 'https://api.openai.com/v1', model: 'gpt-realtime-2.1' },
  character: 'jackshaft', memory: { enabled: true, capture: false, retentionDays: 30 },
  vision: { enabled: false, sourceId: '', sourceName: '', intervalSeconds: 3 },
  paused: false, reducedMotion: false, anonymizeNames: true,
  budget: { enabled: true, sessionUsd: 1, dailyUsd: 3 },
};
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
function normalizeSettings(input = {}) {
  const s = structuredClone(DEFAULTS);
  if (!plain(input)) return s;
  for(const key of ['paused','reducedMotion'])s[key]=input[key]===true;
  s.anonymizeNames=input.anonymizeNames!==false;
  if(plain(input.budget))s.budget={enabled:input.budget.enabled!==false,sessionUsd:Math.max(.1,Math.min(100,Number(input.budget.sessionUsd)||1)),dailyUsd:Math.max(.1,Math.min(500,Number(input.budget.dailyUsd)||3))};
  s.playerName = text(input.playerName, 80);
  s.personalityId = /^[a-z0-9][a-z0-9_-]{0,63}$/.test(input.personalityId) ? input.personalityId : s.personalityId;
  s.spice = [0, 1, 2].includes(input.spice) ? input.spice : s.spice;
  s.chattiness = ['quiet', 'balanced', 'chatty'].includes(input.chattiness) ? input.chattiness : s.chattiness;
  for (const key of ['overlayVisible', 'overlayLocked']) if (typeof input[key] === 'boolean') s[key] = input[key];
  if (Number.isFinite(input.overlayScale)) s.overlayScale = Math.min(1.5, Math.max(0.65, input.overlayScale));
  if (Number.isFinite(Number(input.displayId)) && input.displayId !== null) s.displayId = Number(input.displayId);
  if (plain(input.overlayPosition) && Number.isFinite(input.overlayPosition.x) && Number.isFinite(input.overlayPosition.y)) s.overlayPosition = { x: Math.round(input.overlayPosition.x), y: Math.round(input.overlayPosition.y) };
  if (plain(input.ai)) {
    const a = input.ai;
    s.ai.enabled = a.enabled === true;
    s.ai.dynamicReactions = a.dynamicReactions === true;
    if (['openai-realtime', 'openai', 'ollama', 'compatible'].includes(a.provider)) s.ai.provider = a.provider;
    s.ai.baseUrl = text(a.baseUrl, 500) || (s.ai.provider === 'ollama' ? 'http://127.0.0.1:11434' : s.ai.baseUrl);
    s.ai.model = text(a.model, 160);
  }
  if (plain(input.vision)) {
    s.vision = { enabled: input.vision.enabled === true, sourceId: text(input.vision.sourceId, 160), sourceName: text(input.vision.sourceName, 200), intervalSeconds: [2, 3, 5, 8, 12].includes(input.vision.intervalSeconds) ? input.vision.intervalSeconds : 3 };
  }
  s.character = input.character === 'classic' ? 'classic' : 'jackshaft';
  if (plain(input.memory)) s.memory = { enabled: input.memory.enabled !== false, capture: input.memory.capture === true, retentionDays: [7,30,90].includes(input.memory.retentionDays) ? input.memory.retentionDays : 30 };
  return s;
}

class SettingsStore {
  constructor(dir, encryption) {
    this.file = path.join(dir, 'settings.json');
    this.encryption = encryption;
    this.settings = structuredClone(DEFAULTS);
    this.apiKey = '';
    this.encryptedKey = '';
    this.warning = '';
    this.queue = Promise.resolve();
  }
  async load() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.settings = normalizeSettings(data);
      // Capture handles may identify a different window after a reboot. Always opt in each launch.
      this.settings.vision.enabled = false;
      this.settings.memory.capture = false;
      this.encryptedKey = typeof data.encryptedKey === 'string' ? data.encryptedKey : '';
      if (this.encryptedKey) {
        try { const decrypted = await this.encryption.decryptStringAsync(Buffer.from(this.encryptedKey, 'base64')); this.apiKey = typeof decrypted === 'string' ? decrypted : decrypted.result; }
        catch { this.warning = 'The saved AI key could not be unlocked. Re-enter it in Connection & AI.'; }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.warning = 'Settings could not be read; defaults are in use. The previous file has been preserved.';
        try{await fs.promises.copyFile(this.file,this.file+'.recovery-'+Date.now());}catch{this.warning='Settings could not be read or backed up. Check folder permissions before saving changes.';}
      }
    }
    return this.settings;
  }
  public() { return { ...structuredClone(this.settings), ai: { ...this.settings.ai, hasKey: Boolean(this.apiKey) } }; }
  private() { return { ...structuredClone(this.settings), ai: { ...this.settings.ai, apiKey: this.apiKey } }; }
  save(patch) {
    const task = this.queue.then(() => this.write(patch));
    this.queue = task.catch(() => {});
    return task;
  }
  async write(patch) {
    if (!plain(patch)) throw new Error('Invalid settings.');
    const next = normalizeSettings({ ...this.settings, ...patch, budget: { ...this.settings.budget, ...(plain(patch.budget) ? patch.budget : {}) }, memory: { ...this.settings.memory, ...(plain(patch.memory) ? patch.memory : {}) }, ai: { ...this.settings.ai, ...(plain(patch.ai) ? patch.ai : {}) }, vision: { ...this.settings.vision, ...(plain(patch.vision) ? patch.vision : {}) } });
    let apiKey = this.apiKey;
    let encryptedKey = this.encryptedKey;
    const endpointChanged = next.ai.provider !== this.settings.ai.provider || next.ai.baseUrl !== this.settings.ai.baseUrl;
    if (endpointChanged) { apiKey = ''; encryptedKey = ''; }
    if (plain(patch.ai) && typeof patch.ai.apiKey === 'string') {
      apiKey = patch.ai.apiKey.trim();
      if (apiKey.length > 2048) throw new Error('The API key is too long.');
      if (apiKey) {
        if (!(await this.encryption.isAsyncEncryptionAvailable())) throw new Error('Windows credential encryption is unavailable. Your key was not saved.');
        encryptedKey = (await this.encryption.encryptStringAsync(apiKey)).toString('base64');
      } else encryptedKey = '';
    }
    const temporary = `${this.file}.tmp`;
    await fs.promises.writeFile(temporary, JSON.stringify({ ...next, encryptedKey }, null, 2));
    await fs.promises.rename(temporary, this.file);
    this.settings = next; this.apiKey = apiKey; this.encryptedKey = encryptedKey;
    return this.public();
  }
}
module.exports = { SettingsStore, normalizeSettings, DEFAULTS };
