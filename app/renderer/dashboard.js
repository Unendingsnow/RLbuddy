'use strict';

const $ = (id) => document.getElementById(id);
const api = window.buddy;
let state = { settings: {}, personalities: [], status: {}, snapshot: {}, history: [] };
let formDirty = { game: false, ai: false };
let toastTimer;
let moodTimer;
let captureSources = [];

function toast(message, error = false) {
  $('toast').textContent = String(message || (error ? 'Something went wrong.' : 'Saved.'));
  $('toast').classList.toggle('error', error);
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), error ? 6500 : 3500);
}

async function call(operation, button) {
  if (button) button.disabled = true;
  try {
    const result = await operation();
    if (result?.ok === false) throw new Error(result.error || result.message || 'Could not complete that action.');
    return result;
  } catch (error) {
    toast(error.message || String(error), true);
    return null;
  } finally {
    if (button) button.disabled = false;
  }
}

async function save(patch, message) {
  const result = await call(() => api.saveSettings(patch));
  if (!result) return null;
  if (result.settings) state.settings = result.settings;
  else state.settings = { ...state.settings, ...patch, ai: { ...state.settings.ai, ...patch.ai }, vision: { ...state.settings.vision, ...patch.vision } };
  render();
  if (message) toast(message);
  return result;
}

function showPage(name) {
  if (!['companion', 'personalities', 'connection'].includes(name)) return;
  document.querySelectorAll('.page').forEach((page) => page.classList.toggle('active', page.id === `page-${name}`));
  document.querySelectorAll('[data-page]').forEach((button) => button.classList.toggle('active', button.dataset.page === name));
  $('breadcrumb-current').textContent = { companion: 'Companion', personalities: 'Personalities', connection: 'Connection & AI' }[name];
}

function selectedPack() {
  return state.personalities.find((pack) => pack.id === state.settings.personalityId) || state.personalities[0];
}

function setValue(id, value) {
  if (document.activeElement !== $(id)) $(id).value = value ?? '';
}

function render() {
  const settings = state.settings || {};
  const status = state.status || {};
  const snapshot = state.snapshot || {};
  const pack = selectedPack();
  const visible = settings.overlayVisible !== false;
  $('overlay-button-text').textContent = visible ? 'Buddy is on desktop' : 'Bring buddy to desktop';
  $('overlay-locked').checked = settings.overlayLocked !== false;
  setValue('overlay-scale', settings.overlayScale || 1);
  setValue('spice', settings.spice ?? 2);
  $('spice-label').textContent = ['Chill', 'Playful', 'Degenerate'][settings.spice ?? 2] || 'Degenerate';
  setValue('chattiness', settings.chattiness || 'balanced');
  $('connection-pill').classList.toggle('connected', Boolean(status.connected));
  $('connection-pill').querySelector('span').textContent = status.connected ? 'Rocket League connected' : status.text || 'Waiting for Rocket League';
  $('presence-label').textContent = snapshot.matchActive ? 'Watching your match' : 'Hanging out';
  $('version').textContent = `v${state.version || '0.1'}`;
  $('pack-count').textContent = state.personalities.length;
  if (pack) {
    document.documentElement.dataset.personality = pack.id;
    $('buddy-name').textContent = pack.name;
    $('bubble-name').textContent = pack.name.toUpperCase();
    $('buddy-tagline').textContent = pack.tagline || 'Your desktop ride or die.';
    $('buddy-description').textContent = pack.description || 'Always in your corner.';
    $('preview-personality').textContent = (pack.tagline || 'Your buddy. Your personality.').toUpperCase();
    document.documentElement.style.setProperty('--buddy-color', window.BuddyVisual.color(pack.color));
    $('mini-avatar').style.color = window.BuddyVisual.color(pack.color);
  }
  const seen = snapshot.connected || status.connected || snapshot.matchActive;
  $('blue-score').textContent = seen && Number.isFinite(snapshot.blueScore) ? snapshot.blueScore : '–';
  $('orange-score').textContent = seen && Number.isFinite(snapshot.orangeScore) ? snapshot.orangeScore : '–';
  const seconds = Number(snapshot.clock);
  $('match-clock').textContent = seen && Number.isFinite(seconds) ? `${snapshot.overtime ? '+' : ''}${Math.floor(Math.abs(seconds) / 60)}:${String(Math.floor(Math.abs(seconds) % 60)).padStart(2, '0')}` : '– : –';
  $('match-label').textContent = snapshot.matchActive ? 'LIVE MATCH' : 'STANDING BY';
  $('match-mode').textContent = snapshot.overtime ? 'OVERTIME' : snapshot.matchActive ? 'ROCKET LEAGUE' : 'WAITING FOR A MATCH';
  ['goals', 'saves', 'shots'].forEach((key) => { $(`stat-${key}`).textContent = seen && Number.isFinite(snapshot[key]) ? snapshot[key] : '–'; });
  if (!formDirty.game) setValue('player-name', settings.playerName || '');
  if (!formDirty.ai) {
    const ai = settings.ai || {};
    $('ai-enabled').checked = Boolean(ai.enabled);
    $('ai-dynamic').checked = Boolean(ai.dynamicReactions);
    setValue('ai-provider', ai.provider || 'openai-realtime');
    setValue('ai-model', ai.model || 'gpt-realtime-2.1');
    setValue('ai-base-url', ai.baseUrl || 'https://api.openai.com/v1');
    $('key-status').textContent = ai.hasKey ? '· saved' : '';
    $('ai-key').placeholder = ai.hasKey ? 'Saved · leave blank to keep' : 'Paste your API key';
    updateProviderHint();
  }
  $('ai-status').textContent = typeof status.ai === 'string' ? status.ai : settings.ai?.enabled ? 'AI is enabled. Your buddy falls back to local lines if needed.' : 'AI is off. Your personality pack has you covered.';
  $('interaction-provider').textContent = `Saved provider: ${settings.ai?.provider || 'none'} / ${settings.ai?.model || 'no model'}${settings.ai?.enabled ? '' : ' (AI off)'}`;
  const vision = settings.vision || {};
  $('vision-enabled').checked = Boolean(vision.enabled);
  setValue('vision-interval', vision.intervalSeconds || 3);
  if (vision.sourceId && !Array.from($('vision-source').options).some((option) => option.value === vision.sourceId)) {
    const option = document.createElement('option');
    option.value = vision.sourceId;
    option.textContent = vision.sourceName || 'Saved capture source';
    $('vision-source').append(option);
  }
  setValue('vision-source', vision.sourceId || '');
  $('vision-status').textContent = state.visionStatus?.text || (vision.enabled ? 'Live capture is enabled.' : 'Live vision is off.');
  renderVisionTiming();
  setValue('display-select', settings.displayId ?? '');
  renderPacks();
  renderFeed();
}

function renderVisionTiming() {
  const visionStatus = state.visionStatus || {};
  $('vision-latency').textContent = Number.isFinite(visionStatus.latencyMs) ? `AI response: ${(visionStatus.latencyMs / 1000).toFixed(1)}s` : 'AI response: waiting';
  const capturedAt = visionStatus.lastCaptureAt ? new Date(visionStatus.lastCaptureAt).getTime() : NaN;
  $('vision-frame-age').textContent = Number.isFinite(capturedAt) ? `Last AI check: ${Math.max(0, Math.floor((Date.now() - capturedAt) / 1000))}s ago` : 'Last AI check: none';
}

let lastPackSignature = '';
function renderPacks() {
  const signature = JSON.stringify([state.settings.personalityId, state.personalities]);
  if (signature === lastPackSignature) return;
  lastPackSignature = signature;
  const grid = $('personality-grid');
  grid.replaceChildren();
  state.personalities.forEach((pack, index) => {
    const selected = pack.id === state.settings.personalityId;
    const article = document.createElement('article');
    article.className = `card pack-card${selected ? ' selected' : ''}`;
    article.dataset.personality = pack.id;
    article.style.setProperty('--pack-color', window.BuddyVisual.color(pack.color));
    const stateLabel = document.createElement('div');
    stateLabel.className = 'pack-state';
    stateLabel.textContent = selected ? '● YOUR CURRENT BUDDY' : 'PERSONALITY PACK';
    const avatar = document.createElement('div');
    avatar.className = 'pack-avatar';
    avatar.textContent = ['✦', 'ϟ', '✳'][index % 3];
    if (pack.id === 'jackshaft') {
      const portrait = document.createElement('img');
      portrait.src = 'assets/jackshaft-portrait-v2.png';
      portrait.alt = 'Jackshaft, your pumpkin-headed pit mechanic';
      portrait.width = 240;
      portrait.height = 240;
      avatar.replaceChildren(portrait);
    }
    const name = document.createElement('h3');
    name.textContent = pack.name;
    const tagline = document.createElement('div');
    tagline.className = 'pack-tagline';
    tagline.textContent = pack.tagline || 'A fresh voice for your desktop.';
    const description = document.createElement('p');
    description.className = 'pack-description';
    description.textContent = pack.description || 'Ready to join your next match.';
    const author = document.createElement('div');
    author.className = 'pack-author';
    const authorName = document.createElement('span');
    authorName.textContent = `By ${typeof pack.author === 'string' ? pack.author : pack.author?.name || 'RL Buddy'}`;
    const version = document.createElement('span');
    version.textContent = `v${pack.version || '1.0.0'}`;
    author.append(authorName, version);
    const select = document.createElement('button');
    select.className = 'button secondary';
    select.textContent = selected ? '✓ Riding with you' : 'Choose this buddy';
    select.disabled = selected;
    select.addEventListener('click', () => save({ personalityId: pack.id }, `${pack.name} is your new ride or die.`));
    article.append(stateLabel, avatar, name, tagline, description, author, select);
    grid.append(article);
  });
}

function renderFeed() {
  const history = Array.isArray(state.history) ? state.history : [];
  $('feed-count').textContent = `${history.length} REACTION${history.length === 1 ? '' : 'S'}`;
  if (!history.length) return;
  $('activity-feed').replaceChildren();
  [...history].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 30).forEach((reaction) => {
    const row = document.createElement('div');
    row.className = 'feed-row';
    const icon = document.createElement('span');
    icon.className = 'feed-icon';
    icon.textContent = { goal: '⚽', conceded: '↙', epic_save: '◇', win: '♜', loss: '↘', chat: '↳', observation: '◉' }[reaction.eventType] || '✦';
    const copy = document.createElement('div');
    copy.className = 'feed-copy';
    const label = document.createElement('strong');
    label.textContent = `${String(reaction.eventType || 'reaction').replaceAll('_', ' ')} · ${reaction.source === 'ai' ? 'AI' : 'personality pack'}`;
    const text = document.createElement('p');
    text.textContent = reaction.text || '';
    copy.append(label, text);
    const time = document.createElement('span');
    time.className = 'feed-time';
    const date = new Date(reaction.at);
    time.textContent = Number.isNaN(date.getTime()) ? 'now' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    row.append(icon, copy, time);
    $('activity-feed').append(row);
  });
}

function reactionReceived(reaction) {
  if (!reaction?.text) return;
  $('preview-text').textContent = reaction.text;
  $('preview-character').dataset.mood = window.BuddyVisual.mood(reaction);
  clearTimeout(moodTimer);
  moodTimer = setTimeout(() => { $('preview-character').dataset.mood = 'idle'; }, 5500);
  state.history ||= [];
  if (!state.history.some((item) => item.at === reaction.at && item.text === reaction.text)) state.history = [...state.history, reaction].slice(-60);
  renderFeed();
}

function updateProviderHint() {
  const provider = $('ai-provider').value;
  $('ai-base-url').readOnly = provider === 'openai-realtime' || provider === 'openai';
  $('ai-provider-note').textContent = provider === 'ollama'
    ? 'Runs through your local Ollama server. Use a vision-capable model for Live vision. No API key is required for a local server.'
    : provider === 'openai-realtime'
      ? 'Persistent Realtime connection for optional chat and live vision. Requires an OpenAI API key and API credits, separate from a ChatGPT subscription. Enabled AI event banter, chat, and vision context go to OpenAI.'
      : 'Enabled AI event banter, chat, and vision context go to your chosen provider. API usage may cost money. Live vision needs a model that accepts images.';
}

document.querySelectorAll('[data-page]').forEach((button) => button.addEventListener('click', () => showPage(button.dataset.page)));
document.querySelectorAll('[data-go]').forEach((button) => button.addEventListener('click', () => showPage(button.dataset.go)));
document.querySelector('.brand').addEventListener('click', (event) => { event.preventDefault(); showPage('companion'); });
$('minimize').addEventListener('click', () => call(() => api.minimize()));
$('quit-app').addEventListener('click', () => call(() => api.quit()));
$('toggle-overlay').addEventListener('click', async () => {
  const visible = state.settings.overlayVisible === false;
  const result = await call(() => api.setOverlayVisible(visible));
  if (result !== null) { state.settings.overlayVisible = visible; render(); }
});
$('overlay-locked').addEventListener('change', async (event) => {
  const locked = event.target.checked;
  const result = await call(() => api.setOverlayLocked(locked));
  if (result !== null) { state.settings.overlayLocked = locked; toast(locked ? 'Buddy clicks pass through to your game.' : 'Buddy unlocked. Drag the character to move it.'); }
  else event.target.checked = !locked;
});
$('reset-overlay').addEventListener('click', () => call(() => api.resetOverlay()));
$('overlay-scale').addEventListener('change', (event) => save({ overlayScale: Number(event.target.value) }));
$('display-select').addEventListener('change', (event) => save({ displayId: event.target.value ? Number(event.target.value) : null }));
$('spice').addEventListener('input', (event) => { $('spice-label').textContent = ['Chill', 'Playful', 'Degenerate'][event.target.value]; });
$('spice').addEventListener('change', (event) => save({ spice: Number(event.target.value) }));
$('chattiness').addEventListener('change', (event) => save({ chattiness: event.target.value }));
document.querySelectorAll('[data-demo]').forEach((button) => button.addEventListener('click', () => call(() => api.demo(button.dataset.demo), button)));
$('chat-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = $('chat-input').value.trim();
  if (!text) return;
  $('preview-character').dataset.mood = 'thinking';
  const result = await call(() => api.chat(text), event.currentTarget.querySelector('button'));
  if (result) $('chat-input').value = '';
  else $('preview-character').dataset.mood = 'idle';
});
$('import-personality').addEventListener('click', async (event) => {
  const result = await call(() => api.importPersonality(), event.currentTarget);
  if (result?.personalities) { state.personalities = result.personalities; render(); toast('Personality pack added to your garage.'); }
});
$('open-personality-folder').addEventListener('click', () => call(() => api.openFolder('personalities')));
$('open-data-folder').addEventListener('click', () => call(() => api.openFolder('data')));
$('game-form').addEventListener('input', () => { formDirty.game = true; });
$('game-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = $('player-name').value.trim();
  if (!name) return toast('Enter your exact Rocket League player name.', true);
  const result = await save({ playerName: name }, 'Player name saved. Your buddy is ready for your next match.');
  if (result) { formDirty.game = false; render(); }
});
function showDetection(result) {
  if (!result) return;
  $('game-detection-title').textContent = result.enabled ? 'Game events are enabled' : result.installDir ? 'Rocket League installation found' : 'Local game-event setup';
  $('game-detection-text').textContent = result.message || (result.enabled ? `Ready. Restart Rocket League if you just enabled this. ${result.configPath || ''}` : result.configPath ? `Configuration: ${result.configPath}` : 'Enable events below, then restart Rocket League.');
  $('game-detection-dot').style.background = result.enabled ? '#6d8a24' : '#ff4b1e';
}
$('detect-game').addEventListener('click', async (event) => showDetection(await call(() => api.detectGame(), event.currentTarget)));
$('enable-game').addEventListener('click', async (event) => {
  const result = await call(() => api.enableGame(), event.currentTarget);
  if (result) { showDetection({ enabled: true, ...result }); toast(result.message || 'Game events enabled. Restart Rocket League to connect.'); }
});
$('ai-form').addEventListener('input', () => { formDirty.ai = true; });
$('ai-provider').addEventListener('change', () => {
  formDirty.ai = true;
  const defaults = {
    'openai-realtime': ['gpt-realtime-2.1', 'https://api.openai.com/v1'],
    openai: ['gpt-4.1-mini', 'https://api.openai.com/v1'],
    ollama: ['qwen3.5:4b', 'http://127.0.0.1:11434'],
    compatible: ['', 'http://127.0.0.1:1234/v1'],
  };
  const [model, base] = defaults[$('ai-provider').value];
  $('ai-model').value = model;
  $('ai-base-url').value = base;
  updateProviderHint();
});
$('ai-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const ai = { enabled: $('ai-enabled').checked, dynamicReactions: $('ai-dynamic').checked, provider: $('ai-provider').value, model: $('ai-model').value.trim(), baseUrl: $('ai-base-url').value.trim() };
  if ($('ai-key').value.trim()) ai.apiKey = $('ai-key').value.trim();
  const result = await save({ ai }, 'AI settings saved.');
  if (result) { formDirty.ai = false; $('ai-key').value = ''; render(); }
});
$('clear-key').addEventListener('click', async () => {
  const result = await save({ ai: { apiKey: '' } }, 'Saved API key removed.');
  if (result) { $('ai-key').value = ''; $('key-status').textContent = ''; }
});
$('refresh-sources').addEventListener('click', async (event) => {
  const result = await call(() => api.getCaptureSources(), event.currentTarget);
  if (!result) return;
  captureSources = Array.isArray(result) ? result : result.sources || [];
  $('vision-source').replaceChildren();
  const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'Choose a capture source'; $('vision-source').append(empty);
  captureSources.forEach((source) => { const option = document.createElement('option'); option.value = source.id; option.textContent = source.name; $('vision-source').append(option); });
  $('vision-source').value = state.settings.vision?.sourceId || '';
  toast(`${captureSources.length} capture sources found. Select the Rocket League window.`);
});
$('vision-source').addEventListener('change', async () => {
  const source = captureSources.find((item) => item.id === $('vision-source').value);
  $('vision-preview').hidden = true; $('vision-preview-placeholder').hidden = false;
  await save({ vision: { sourceId: source?.id || '', sourceName: source?.name || '', enabled: false } }, 'Capture source saved. Enable Watch this source when ready.');
});
$('vision-enabled').addEventListener('change', async (event) => {
  const enabled = event.target.checked;
  if (enabled && !state.settings.ai?.enabled) { event.target.checked = false; return toast('Enable and save your AI settings first.', true); }
  if (enabled && !state.settings.vision?.sourceId) { event.target.checked = false; return toast('Choose a window or display first.', true); }
  const result = await save({ vision: { enabled } }, enabled ? 'Live vision enabled for your selected source.' : 'Live vision stopped.');
  if (!result) event.target.checked = !enabled;
});
$('vision-interval').addEventListener('change', (event) => save({ vision: { intervalSeconds: Number(event.target.value) } }));
$('preview-source').addEventListener('click', async (event) => {
  const id = state.settings.vision?.sourceId;
  if (!id) return toast('Choose a capture source first.', true);
  const result = await call(() => api.previewCapture(id), event.currentTarget);
  if (result?.dataUrl?.startsWith('data:image/')) { $('vision-preview').src = result.dataUrl; $('vision-preview').hidden = false; $('vision-preview-placeholder').hidden = true; }
});

async function boot() {
  if (!api) { toast('The desktop bridge is unavailable. Start RL Buddy with its desktop launcher.', true); return; }
  api.onState((next) => { state = { ...state, ...next }; render(); });
  api.onClear?.(() => { $('preview-text').textContent = 'New match. Entertainment only; coaching is paused.'; });
  api.onReaction(reactionReceived);
  api.onPartial?.((partial) => {
    if (!partial?.text || partial.eventType !== 'chat') return;
    $('preview-text').textContent = partial.text;
    $('preview-character').dataset.mood = 'thinking';
    clearTimeout(moodTimer);
    moodTimer = setTimeout(() => { $('preview-character').dataset.mood = 'idle'; }, 12000);
  });
  api.onMoment?.((event) => {
    $('preview-character').dataset.mood = window.BuddyVisual.mood({ eventType: event.type });
    clearTimeout(moodTimer);
    moodTimer = setTimeout(() => { $('preview-character').dataset.mood = 'idle'; }, 5500);
  });
  api.onError((error) => toast(typeof error === 'string' ? error : error.message || error.error || 'Something went wrong.', true));
  const initial = await call(() => api.getState());
  if (initial) { state = { ...state, ...initial }; render(); const latest = [...(state.history || [])].sort((a, b) => new Date(b.at) - new Date(a.at))[0]; if (latest) reactionReceived(latest); }
  const displays = await call(() => api.getDisplays());
  if (Array.isArray(displays)) {
    displays.forEach((display) => { const option = document.createElement('option'); option.value = display.id; option.textContent = display.label || `Display ${display.id}`; $('display-select').append(option); });
    setValue('display-select', state.settings.displayId ?? '');
  }
}
setInterval(renderVisionTiming, 1000);
boot();

async function testInteraction(mode) {
  if (formDirty.ai) return toast('Save your AI settings before testing.', true);
  const buttons = [$('test-ai-sample'), $('test-ai-source')];
  buttons.forEach(button => { button.disabled = true; });
  $('interaction-result').textContent = 'Sending one image to your saved provider... waiting for the character reply.';
  try {
    const result = await api.testInteraction({ mode, event: $('interaction-event').value });
    if (!result.ok) throw new Error(result.error || 'The AI test failed.');
    const timing = `${result.provider} / ${result.model} · ${(result.latencyMs / 1000).toFixed(1)}s`;
    $('interaction-result').textContent = result.outcome === 'ai'
      ? `${timing} · AI reply shown on your character: “${result.text}”`
      : result.outcome === 'fallback' ? `${timing} - AI reply failed quality checks. Built-in line shown: ${result.text}` : result.outcome === 'rejected' ? `${timing} - AI reply failed quality checks. No bubble shown.` : `${timing} - AI stayed silent: no clear new moment. Try a sample play to check personality.`;
  } catch (error) { $('interaction-result').textContent = error.message; toast(error.message, true); }
  finally { buttons.forEach(button => { button.disabled = false; }); }
}
$('test-ai-sample').addEventListener('click', () => testInteraction('sample'));
$('test-ai-source').addEventListener('click', () => testInteraction('source'));
