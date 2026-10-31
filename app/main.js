'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, globalShortcut, dialog, shell, safeStorage } = require('electron');
const { SettingsStore } = require('../src/settings');
const { StatsClient } = require('../src/game/stats-client');
const { detectGame, enableStatsApi } = require('../src/game/setup');
const { PersonalityRegistry } = require('../src/personality/registry');
const { ReactionEngine } = require('../src/personality/engine');
const { LiveBanter } = require('../src/personality/live-banter');
const { LiveCapture } = require('../src/vision/live-capture');
const { UsageLedger } = require('../src/usage');
const { MatchMemory } = require('../src/coaching/memory');
const { Coach, coachingAllowed } = require('../src/coaching/coach');
const { execFile } = require('node:child_process');
const { LocalRuntime } = require('../src/local-runtime');
const {AiGate}=require('../src/ai-gate');
const {LocalModels,hardware}=require('../src/local-models');
const {readJson}=require('../src/http');
let localRuntime,localModels,aiGate,storageWarning=null;
let memory, ledger, coach, processAbsent = false, processCheckedAt = 0, processTimer;
const allowed = () => !store?.settings.paused && coachingAllowed(snapshot, processAbsent && Date.now() - processCheckedAt < 5000);
let speechUntil = 0, liveBanter, interactionTestBusy = false;
function watchProcess() {
  execFile('tasklist.exe', ['/FI', 'IMAGENAME eq RocketLeague.exe', '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 3000 }, (error, out) => {
    const before = allowed(); processAbsent = !error && !/RocketLeague\.exe/i.test(out); processCheckedAt = Date.now();
    if (before && !allowed()) coach?.cancel(); broadcast();
  });
}

const verifyBuild = process.argv.includes('--verify-build');
const localInteractionTest = process.argv.includes('--test-local-interaction');
const smoke = process.argv.includes('--smoke') || verifyBuild || localInteractionTest;
if (smoke) app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'rlbuddy-smoke-')));
else {
  const dataDir = path.join(app.getPath('appData'), 'rlbuddy');
  fs.mkdirSync(dataDir, { recursive: true });
  app.setPath('userData', dataDir);
}
app.setAppUserModelId('com.rlbuddy.desktop');
let dashboard, overlay, tray, store, registry, engine, game, capture;
let quitting = false;
let status = { connected: false, text: 'Waiting for Rocket League', ai: 'Built-in banter is ready' };
let snapshot = {};
let history = [];
let visionStatus = { active: false, text: 'Live vision is off', lastCaptureAt: null };
let broadcastTimer = null;
let captureGeneration = 0;
let settingsQueue = Promise.resolve();

function icon() {
  const file = path.join(__dirname, '../build/icon.png');
  if (fs.existsSync(file)) return nativeImage.createFromPath(file);
  const pixels = Buffer.alloc(32 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    if ((x - 16) ** 2 + (y - 16) ** 2 > 210) continue;
    const i = (y * 32 + x) * 4;
    const eye = y >= 12 && y <= 17 && ((x >= 8 && x <= 11) || (x >= 20 && x <= 23));
    pixels[i] = eye ? 30 : 30; pixels[i + 1] = eye ? 33 : 75; pixels[i + 2] = eye ? 27 : 255; pixels[i + 3] = 255;
  }
  return nativeImage.createFromBitmap(pixels, { width: 32, height: 32 });
}
function state() {
  return { settings: store.public(), personalities: registry.list(), status, snapshot, history, visionStatus, localSetup: localRuntime?.status, modelDownload:localModels?.status, aiControl:aiGate?.status(), storageWarning, memory: memory ? { matches: memory.list(), progress: memory.progress(), allowed: allowed() } : null, usage: ledger?.summary(), version: app.getVersion() };
}
function send(channel, value) {
  for (const win of [dashboard, overlay]) if (win && !win.isDestroyed()) win.webContents.send(channel, value);
}
function broadcast(immediate = false) {
  if (!store) return;
  if (immediate) { clearTimeout(broadcastTimer); broadcastTimer = null; send('buddy:state', state()); return; }
  if (!broadcastTimer) broadcastTimer = setTimeout(() => { broadcastTimer = null; send('buddy:state', state()); }, 180);
}
function problem(message) { send('buddy:error', typeof message === 'string' ? message : message.message); }
function publish(reaction, force = false) {
  if (!reaction || quitting || store.settings.paused) return;
  if (!force && reaction.eventType !== 'chat' && Date.now() < speechUntil) return;
  reaction.durationMs = Math.max(10000, Math.min(18000, reaction.text.length * 70));
  speechUntil = Date.now() + reaction.durationMs + 1500;
  history.push(reaction); history = history.slice(-80);
  send('buddy:reaction', reaction); broadcast();
}
function secureWindow(win, file) {
  const expected = pathToFileURL(path.join(__dirname, 'renderer', file)).href;
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (url.split('#')[0] !== expected) event.preventDefault(); });
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.webContents.on('did-finish-load', () => broadcast(true));
  let recoveredAt=0;
  win.webContents.on('render-process-gone', () => { if(quitting)return;if(Date.now()-recoveredAt<60000)return problem('A companion window repeatedly stopped. Restart RL Buddy.');recoveredAt=Date.now();win.loadFile(path.join(__dirname,'renderer',file)).catch(()=>problem('Could not restore the companion window.')); });
}
function display() { return screen.getAllDisplays().find(d => d.id === store.settings.displayId) || screen.getPrimaryDisplay(); }
function clampPosition(bounds) {
  const area = screen.getDisplayMatching(bounds).workArea;
  return { ...bounds, x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - bounds.width)), y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - bounds.height)) };
}
function applyOverlay(reset = false) {
  if (!overlay || overlay.isDestroyed()) return;
  const s = store.settings;
  const area = display().workArea;
  const width = Math.round(380 * s.overlayScale), height = Math.round(400 * s.overlayScale);
  const pos = reset || !s.overlayPosition ? { x: area.x + area.width - width - 24, y: area.y + area.height - height - 24 } : s.overlayPosition;
  overlay.setBounds(clampPosition({ ...pos, width, height }));
  overlay.webContents.setZoomFactor(s.overlayScale);
  overlay.setIgnoreMouseEvents(s.overlayLocked, { forward: true });
  overlay.setFocusable(!s.overlayLocked);
  overlay.setAlwaysOnTop(true, 'screen-saver');
  if (s.overlayVisible && !smoke) overlay.showInactive(); else overlay.hide();
  updateTray();
}
function createWindows() {
  const webPreferences = { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, offscreen: smoke };
  const area = screen.getPrimaryDisplay().workArea;
  const width = smoke ? 1220 : Math.min(1220, area.width - 24);
  const height = smoke ? 900 : Math.min(900, area.height - 24);
  dashboard = new BrowserWindow({ width, height, minWidth: Math.min(960, width), minHeight: Math.min(700, height), show: false, backgroundColor: '#0e181a', autoHideMenuBar: true, title: 'RL Buddy', icon: icon(), webPreferences });
  dashboard.setMenu(null);
  secureWindow(dashboard, 'index.html');
  dashboard.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  dashboard.once('ready-to-show', () => { if (!smoke) dashboard.show(); });
  dashboard.on('close', event => { if (!quitting && !smoke) { event.preventDefault(); dashboard.hide(); } });
  overlay = new BrowserWindow({ width: 380, height: 400, frame: false, transparent: true, backgroundColor: '#00000000', resizable: false, hasShadow: false, skipTaskbar: true, focusable: false, alwaysOnTop: true, show: false, title: 'RL Buddy Overlay', webPreferences });
  overlay.setContentProtection(true);
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  secureWindow(overlay, 'overlay.html');
  overlay.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
  overlay.once('ready-to-show', () => {
    applyOverlay();
    if (!smoke) engine.react({ type: 'greeting', source: 'desktop' }, { force: true, localOnly: true }).then(publish).catch(problem);
  });
  overlay.on('close', event => { if (!quitting) { event.preventDefault(); changeSettings({ overlayVisible: false }).catch(problem); } });
  let positionTimer;
  overlay.on('moved', () => {
    clearTimeout(positionTimer);
    positionTimer = setTimeout(() => {
      if (quitting || overlay.isDestroyed()) return;
      const [x, y] = overlay.getPosition();
      store.save({ overlayPosition: { x, y } }).catch(problem);
    }, 350);
  });
  screen.on('display-removed', () => applyOverlay(true));
  screen.on('display-metrics-changed', () => applyOverlay());
}
function showDashboard() { if (dashboard.isMinimized()) dashboard.restore(); dashboard.show(); dashboard.focus(); }
function updateTray() {
  if (!tray || !store) return;
  tray.setToolTip(`RL Buddy — ${status.text}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open RL Buddy', click: showDashboard },
    { label:'Pause AI & capture',type:'checkbox',checked:store.settings.paused,click:item=>changeSettings({paused:item.checked}).catch(problem) },
    { label: 'Show buddy', type: 'checkbox', checked: store.settings.overlayVisible, click: item => changeSettings({ overlayVisible: item.checked }).catch(problem) },
    { label: 'Click through buddy', type: 'checkbox', checked: store.settings.overlayLocked, click: item => changeSettings({ overlayLocked: item.checked }).catch(problem) },
    { label: 'Stop all capture', enabled: store.settings.vision.enabled || store.settings.memory.capture, click: () => changeSettings({ vision: { enabled: false }, memory: { capture: false } }).catch(problem) },
    { type: 'separator' },
    { label: 'Quit RL Buddy', click: () => app.quit() },
  ]));
}
function startEngine() {
  liveBanter?.reset();
  engine?.dispose();
  engine = new ReactionEngine({ gate:aiGate, onUsage: row => { ledger.record(row); broadcast(); }, getSettings: () => store.private(), getPersonality: id => registry.get(id), onStatus: value => {
    status.ai = value.text; status.aiState = value.state; broadcast();
    if (value.eventType === 'chat' && value.partialText) send('buddy:partial', { text: value.partialText, eventType: 'chat', personalityId: store.settings.personalityId });
  } });
}
function connectGame() {
  game?.removeAllListeners(); game?.stop();
  game = new StatsClient({ playerName: store.settings.playerName });
  snapshot = game.tracker.snapshot();
  game.on('status', next => { status = { ...status, ...next }; updateTray(); broadcast(); });
  game.on('snapshot', value => { snapshot = value; memory.snapshot(value); if (!value.connected) memory.finish('interrupted'); if (!allowed()) coach.cancel(); broadcast(); });
  game.on('team-event', event => { if(store.settings.memory.enabled)memory.teamEvent(event); });
  game.on('event', event => {
    if (event.type === 'match_start') { snapshot.matchActive = true; snapshot.matchEnded = false; coach.cancel(); startEngine(); send('buddy:clear'); speechUntil = 0; }
    memory.event(event, store.settings.memory.enabled);
    if (['win','loss','match_end'].includes(event.type)) memory.prune(store.settings.memory.retentionDays);
    send('buddy:moment', event);
    liveBanter.event(event).catch(() => problem('A reaction could not be generated.'));
  });
  if (!smoke) game.start();
}
async function syncCapture() {
  liveBanter?.reset();
  const generation = ++captureGeneration;
  engine.cancelObservation?.();
  capture.stop();
  const s = store.settings;
  if (!(s.vision.enabled && s.ai.enabled) && !s.memory.capture) {
    visionStatus = { ...visionStatus, active: false, text: 'Live vision is off' }; broadcast(); return;
  }
  if (!s.vision.sourceId) throw new Error('Choose a game window before enabling live vision.');
  const result = await capture.start(s.vision);
  if (generation !== captureGeneration) return;
  if (result && result.ok === false) {
    await store.save({ vision: { enabled: false } });
    visionStatus = { active: false, text: result.error || 'Capture could not start' }; broadcast();
    throw new Error(visionStatus.text);
  }
}
function changeSettings(patch) {
  const operation = settingsQueue.then(async () => {
    const before = store.public();
    if(patch?.paused===true){patch={...patch,vision:{...(patch.vision||{}),enabled:false},memory:{...(patch.memory||{}),capture:false}};engine.cancel();liveBanter.reset();send('buddy:clear');}
    if (patch?.personalityId && !registry.list().some(p => p.id === patch.personalityId)) throw new Error('That personality pack was not found.');
    const nextAi = { ...before.ai, ...(patch?.ai || {}) };
    const nextVision = { ...before.vision, ...(patch?.vision || {}) };
    if (patch?.ai?.enabled === false) { patch = { ...patch, vision: { ...(patch.vision || {}), enabled: false } }; nextVision.enabled = false; }
    if (nextVision.enabled && ((patch.paused ?? before.paused) || !nextAi.enabled || !nextVision.sourceId)) throw new Error('Enable an AI provider and choose a game window before turning on live vision.');
    if (patch?.memory?.capture && ((patch.paused ?? before.paused) || !nextVision.sourceId || !(patch.memory.enabled ?? before.memory.enabled))) throw new Error('Enable match memory and choose a capture window first.');
    coach?.cancel();
    await store.save(patch);
    if(patch.ai || patch.budget || patch.paused!==undefined)aiGate.reason=null;
    const engineChanged = ['personalityId', 'spice', 'chattiness'].some(key => before[key] !== store.settings[key]) || Boolean(patch.ai) || Boolean(patch.budget) || before.paused !== store.settings.paused;
    if (engineChanged) startEngine();
    if (before.playerName !== store.settings.playerName) connectGame();
    applyOverlay(before.displayId !== store.settings.displayId);
    if (patch.memory?.enabled === false) { memory.finish(); await store.save({ memory: { capture: false } }); }
    if (patch.memory) memory.prune(store.settings.memory.retentionDays);
    if (patch.vision || patch.ai || patch.memory) await syncCapture();
    broadcast(true);
    return { ok: true, settings: store.public() };
  });
  settingsQueue = operation.catch(() => {});
  return operation;
}
function handle(channel, handler) {
  ipcMain.handle(channel, async (event, payload) => {
    if (![dashboard?.webContents, overlay?.webContents].includes(event.sender) || event.senderFrame !== event.sender.mainFrame) throw new Error('Untrusted window.');
    try { return await handler(payload); } catch (error) { return { ok: false, error: error.message }; }
  });
}
function registerIpc() {
  handle('buddy:diagnostics',async()=>{
    const result=await dialog.showSaveDialog(dashboard,{title:'Export private diagnostics',defaultPath:'RL-Buddy-diagnostics.json',filters:[{name:'JSON',extensions:['json']}]});
    if(result.canceled)return {ok:true,canceled:true};
    const report={version:app.getVersion(),platform:process.platform,arch:process.arch,ramGiB:Math.round(os.totalmem()/1024**3),
      gameConnected:Boolean(snapshot.connected),matchActive:Boolean(snapshot.matchActive),captureActive:Boolean(visionStatus.active),
      ai:{provider:store.settings.ai.provider,enabled:store.settings.ai.enabled,control:aiGate.status()},
      memory:{matches:memory.list().length,storageWarning:Boolean(storageWarning)},usage:ledger.summary().today,
      privacy:'No screenshots, player names, chat, keys, source titles, server URLs, or filesystem paths are included.'};
    await fs.promises.writeFile(result.filePath,JSON.stringify(report,null,2));return {ok:true};
  });
  handle('buddy:check-release',async()=>{
    const r=await fetch('https://api.github.com/repos/Unendingsnow/RLbuddy/releases/latest',{headers:{Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(10000)});
    if(r.status===404)return {ok:true,text:'No public stable release is published yet. This is a beta build.'};
    if(!r.ok)throw Error('GitHub update check unavailable. Try again later.');
    const data=await readJson(r);const tag=/^v?\d+\.\d+\.\d+$/.test(data.tag_name)?data.tag_name:'unknown';
    return {ok:true,text:`Installed: ${app.getVersion()}. Latest published: ${tag}. Open releases to compare notes and download manually.`};
  });
  handle('buddy:open-releases',async()=>{await shell.openExternal('https://github.com/Unendingsnow/RLbuddy/releases');return {ok:true};});
  handle('buddy:test-interaction', async payload => {
    if (!['sample', 'source'].includes(payload?.mode)) throw new Error('Choose a sample or selected-source test.');
    if (interactionTestBusy || liveBanter.busy || engine.active) throw new Error('Your buddy is already thinking. Try again when the reply finishes.');
    const settings = store.private();
    if(settings.paused)throw new Error('Buddy is paused. Resume before running an AI image test.');
    if (!settings.ai.enabled) throw new Error('Enable and save an AI provider first.');
    if (['openai','openai-realtime'].includes(settings.ai.provider) && !settings.ai.apiKey) throw new Error('Add and save your API key first.');
    if (Date.now() - engine.lastAiRequest < 2000) throw new Error('Wait two seconds before another AI test.');
    const activeEngine = engine, generation = captureGeneration, started = Date.now();
    interactionTestBusy = true;
    try {
      let dataUrl, context = {};
      if (payload.mode === 'sample') {
        const type = ['goal','conceded','epic_save'].includes(payload.event) ? payload.event : 'goal';
        dataUrl = nativeImage.createFromPath(path.join(__dirname,'renderer/assets/vision-test.png')).toDataURL();
        context = { type, source: 'demo', player: 'You', team: 0, blueScore: 2, orangeScore: 1, clock: 83 };
      } else {
        const source = (await capture.listSources()).find(s => s.id === settings.vision.sourceId && s.name === settings.vision.sourceName);
        if (!source) throw new Error('Find windows and select the Rocket League window again before testing.');
        const result = await capture.preview(source.id);
        if (!result.ok) throw new Error(result.error);
        dataUrl = result.dataUrl;
        context = snapshot.connected && snapshot.matchActive ? { ...snapshot, player: snapshot.playerName } : {};
      }
      if (activeEngine !== engine || generation !== captureGeneration) throw new Error('Settings changed. Run the test again.');
      let reaction = await activeEngine.observe({ dataUrl, context }, { force: true, once: true });
      if (activeEngine !== engine || generation !== captureGeneration) throw new Error('Test cancelled because settings or the match changed.');
      if(!reaction && payload.mode==='sample' && activeEngine.observationOutcome==='rejected')reaction=await activeEngine.react(context,{force:true,localOnly:true});
      if (activeEngine.observationError) throw new Error(aiGate.status().reason || activeEngine.observationError);
      if (activeEngine.observationOutcome === 'skipped') throw new Error('No image request was completed. The request limit may be reached; wait a minute and retry.');
      if (reaction) publish({ ...reaction, test: true }, true);
      return { ok: true, provider: settings.ai.provider, model: settings.ai.model, latencyMs: Date.now() - started,
        text: reaction?.text || '', outcome: reaction ? reaction.source==='ai'?'ai':'fallback' : activeEngine.observationOutcome === 'rejected' ? 'rejected' : 'silent', mode: payload.mode };
    } finally { interactionTestBusy = false; }
  });
  handle('buddy:state', state);
  handle('buddy:match', id => {
    if (!allowed()) throw new Error('Match review is paused while playing or game mode is unknown.');
    return {ok:true, match:memory.get(id)};
  });
  handle('buddy:review', async payload => { const text = await coach.review(payload?.id, payload?.ai === true); broadcast(); return {ok:true,text}; });
  handle('buddy:delete-match', id => { coach.cancel(); memory.delete(id); broadcast(true); return {ok:true}; });
  handle('buddy:clear-memory', () => { coach.cancel(); memory.finish(); for (const m of memory.list()) memory.delete(m.id); broadcast(true); return {ok:true}; });
  handle('buddy:local-models', async () => {
    try { const r = await fetch('http://127.0.0.1:11434/api/tags', {signal:AbortSignal.timeout(4000)}); if (!r.ok) throw new Error(); const data = await r.json(); return {ok:true,models:(data.models || []).map(m => ({name:m.name,size:m.size}))}; }
    catch { throw new Error('Ollama is not running. Click Set up Ollama to install or start it.'); }
  });
  handle('buddy:local-detect', () => localRuntime.detect());
  handle('buddy:local-setup', () => localRuntime.setup());
  handle('buddy:local-cancel', () => { localRuntime.cancel(); return {ok:true}; });
  handle('buddy:local-pull', name => localModels.pull(name));
  handle('buddy:model-cancel', () => {localModels.cancel();return {ok:true};});
  handle('buddy:hardware',hardware);
  handle('buddy:local-test', async () => {
    const ai = store.private().ai;
    if (ai.provider !== 'ollama') throw new Error('Select and save the Ollama provider first.');
    if (!allowed()) throw new Error('Run the benchmark between matches or with Rocket League closed.');
    const started = Date.now();
    const ticket=aiGate.acquire({provider:ai.provider,model:ai.model,kind:'benchmark'});
    try {
    const testImage = nativeImage.createFromPath(path.join(__dirname,'renderer/assets/vision-test.png')).toJPEG(85).toString('base64');
    const r = await fetch(require('../src/personality/engine').endpointFor(ai), {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:ai.model,stream:false,think:false,messages:[{role:'user',content:'Read the score and clock shown in this synthetic test image. Reply with only the two scores and clock.',images:[testImage]}],options:{num_predict:80,num_ctx:2048}}),signal:AbortSignal.timeout(120000)});
    if (!r.ok) throw new Error('Local vision test failed. Verify the model supports images.');
    const data=await readJson(r); ticket.account({}); ledger.record({provider:'ollama',model:ai.model,kind:'benchmark',usage:{input_tokens:data.prompt_eval_count,output_tokens:data.eval_count}}); broadcast();
    return {ok:true,text:String(data.message?.content || '').slice(0,500),latencyMs:Date.now()-started,expected:'Blue 2, Orange 1, clock 1:23'};
    } catch(error){ledger.record({provider:ai.provider,model:ai.model,kind:'benchmark',status:'usage unavailable'});throw error;}finally{ticket.release();}
  });
  handle('buddy:settings', changeSettings);
  handle('buddy:visible', value => changeSettings({ overlayVisible: Boolean(value) }));
  handle('buddy:locked', value => changeSettings({ overlayLocked: Boolean(value) }));
  handle('buddy:reset-overlay', async () => { await store.save({ overlayPosition: null }); applyOverlay(true); broadcast(true); return { ok: true }; });
  handle('buddy:move-overlay', delta => {
    if (store.settings.overlayLocked) return { ok: false };
    if (!Number.isFinite(delta?.dx) || !Number.isFinite(delta?.dy)) return { ok: false };
    const bounds = overlay.getBounds();
    overlay.setBounds(clampPosition({ ...bounds, x: bounds.x + Math.round(Math.max(-100, Math.min(100, delta.dx))), y: bounds.y + Math.round(Math.max(-100, Math.min(100, delta.dy))) }));
    return { ok: true };
  });
  handle('buddy:displays', () => screen.getAllDisplays().map((d, index) => ({ id: d.id, label: d.label || `Display ${index + 1}` })));
  handle('buddy:demo', async type => {
    if (!['goal', 'conceded', 'epic_save', 'save', 'win', 'loss', 'demo', 'overtime', 'match_start'].includes(type)) throw new Error('Unknown demo event.');
    const event = { type, id: `demo-${Date.now()}`, source: 'demo', player: store.settings.playerName || 'You', blueScore: 2, orangeScore: 1, clock: 90 };
    send('buddy:moment', event);
    publish(await engine.react(event, { force: true, localOnly: true }), true);
    return { ok: true };
  });
  handle('buddy:chat', async text => {
    if (typeof text !== 'string' || !text.trim() || text.length > 1000) throw new Error('Enter a message under 1,000 characters.');
    if (!allowed()) { publish(await engine.react({type:'chat',message:text},{force:true,localOnly:true})); return {ok:true}; }
    publish(await engine.chat(text)); return { ok: true };
  });
  handle('buddy:import', async () => {
    const result = await dialog.showOpenDialog(dashboard, { title: 'Import personality pack', filters: [{ name: 'RL Buddy personality', extensions: ['json'] }], properties: ['openFile'] });
    if (result.canceled) return { ok: false, canceled: true };
    registry.importFile(result.filePaths[0]); broadcast(true);
    return { ok: true, personalities: registry.list() };
  });
  handle('buddy:detect-game', () => detectGame());
  handle('buddy:enable-game', async () => {
    let detected = detectGame();
    if (!detected.installDir) {
      const result = await dialog.showOpenDialog(dashboard, { title: 'Choose your Rocket League install folder', properties: ['openDirectory'] });
      if (result.canceled) return { ok: false, message: 'Choose the Rocket League installation folder to enable its game feed.' };
      detected.installDir = result.filePaths[0];
    }
    return enableStatsApi(detected.installDir);
  });
  handle('buddy:capture-sources', () => capture.listSources());
  handle('buddy:capture-preview', id => capture.preview(id));
  handle('buddy:folder', async which => {
    if (!['personalities', 'data'].includes(which)) throw new Error('Unknown folder.');
    const folder = which === 'personalities' ? path.join(app.getPath('userData'), 'personalities') : app.getPath('userData');
    const error = await shell.openPath(folder); if (error) throw new Error(error); return { ok: true };
  });
  handle('buddy:minimize', () => dashboard.minimize());
  handle('buddy:quit', () => app.quit());
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (dashboard) showDashboard(); });
  app.whenReady().then(async () => {
    store = new SettingsStore(app.getPath('userData'), safeStorage); await store.load();
    registry = new PersonalityRegistry({ builtinDir: path.join(__dirname, '..', 'personalities'), userDir: path.join(app.getPath('userData'), 'personalities') });
    const onStorageError=message=>{storageWarning=message;broadcast();};
    memory = new MatchMemory(app.getPath('userData'),Date.now,{background:true,onError:onStorageError}); memory.prune(store.settings.memory.retentionDays);
    ledger = new UsageLedger(app.getPath('userData'),{background:true,onError:onStorageError});
    aiGate = new AiGate({getSettings:()=>store.settings,ledger,onChange:()=>broadcast()});
    localModels = new LocalModels({onStatus:()=>broadcast()});
    localRuntime = new LocalRuntime({dir:path.join(app.getPath('userData'),'downloads'),onStatus:()=>broadcast()});
    coach = new Coach({ getSettings: () => store.private(), getPack: () => registry.get(store.settings.personalityId), memory, ledger, allowed, gate:aiGate });
    if (!smoke) { watchProcess(); processTimer = setInterval(watchProcess, 2000); }
    startEngine();
    liveBanter = new LiveBanter({ getEngine: () => engine, getSettings: () => store.settings, getSnapshot: () => snapshot,
      canSpeak: () => !store.settings.paused && !aiGate.status().busy && !interactionTestBusy && Date.now() >= speechUntil, publish,
      onObservation: value => { visionStatus.lastCaptureAt = value.capturedAt; visionStatus.latencyMs = value.latencyMs; broadcast(); } });
    capture = new LiveCapture({
      onStatus: value => {
        const { lastCaptureAt, ...rest } = value;
        visionStatus = { ...visionStatus, ...rest, lastVideoFrameAt: lastCaptureAt };
        if (!value.active && value.reason && value.reason !== 'manual' && (store.settings.vision.enabled || store.settings.memory.capture)) {
          ++captureGeneration; liveBanter.reset(); engine.cancelObservation?.();
          store.save({ vision: { enabled: false }, memory: { capture: false } }).then(() => { updateTray(); broadcast(true); }).catch(problem);
        }
        broadcast();
      },
      onFrame: async frame => {
        if (store.settings.memory.capture && store.settings.memory.enabled && snapshot.matchActive && Date.now() - frame.capturedAt < 2000) memory.frame(frame);
        await liveBanter.observe(frame);
      },
    });
    registerIpc(); createWindows(); connectGame();
    if (!smoke) {
      tray = new Tray(icon()); tray.on('double-click', showDashboard); updateTray();
      globalShortcut.register('CommandOrControl+Shift+P', () => changeSettings({paused:!store.settings.paused}).catch(problem));
      globalShortcut.register('CommandOrControl+Shift+B', () => changeSettings({ overlayVisible: !store.settings.overlayVisible }).catch(problem));
      globalShortcut.register('CommandOrControl+Shift+L', () => changeSettings({ overlayLocked: !store.settings.overlayLocked }).catch(problem));
    }
    if (store.warning) dashboard.webContents.once('did-finish-load', () => problem(store.warning));
    if (verifyBuild) {
      const until = Date.now() + 15000;
      while (Date.now() < until) {
        if (!dashboard.webContents.isLoading() && await dashboard.webContents.executeJavaScript('Boolean(window.buddy)')) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const result = await dashboard.webContents.executeJavaScript("window.buddy.demo('goal')");
      if (!result.ok || !history.at(-1)?.text || registry.list().length !== 6) throw new Error('Packaged app verification failed.');
      if (!fs.existsSync(path.join(__dirname,'renderer/assets/jackshaft-sheet.png'))) throw new Error('Packaged character missing.');
      const features = await dashboard.webContents.executeJavaScript("Boolean(document.getElementById('page-garage') && document.getElementById('local-setup') && document.querySelector('.jackshaft-art') && window.buddy.setupLocal && document.getElementById('ai-dynamic') && document.getElementById('test-ai-sample') && window.buddy.testInteraction)");
      if (!features || !state().usage || !state().memory) throw new Error('Packaged upgrade features missing.');
      await Promise.all([memory.flush(),ledger.flush()]);app.exit(0);
    } else if (localInteractionTest) {
      await require('../scripts/test-local-interaction').run({ dashboard, overlay, state, changeSettings });
      await Promise.all([memory.flush(),ledger.flush()]);app.exit(0);
    } else if (smoke) {
      const { runSmoke } = require('../scripts/smoke');
      await runSmoke({ dashboard, overlay, state, store, registry, changeSettings, capture, game, publish, engine });
      await Promise.all([memory.flush(),ledger.flush()]);app.exit(0);
    }
  }).catch(error => { console.error(error.stack); if (!smoke) dialog.showErrorBox('RL Buddy could not start', error.message); app.exit(1); });
  app.on('window-all-closed', () => {});
  app.on('before-quit', event => {
    event.preventDefault();if(quitting)return;quitting=true;localModels?.cancel();localRuntime?.dispose();clearInterval(processTimer);coach?.cancel();memory?.finish();clearTimeout(broadcastTimer);globalShortcut.unregisterAll();capture?.dispose();game?.stop();engine?.dispose();liveBanter?.reset();
    Promise.all([memory?.flush(),ledger?.flush()]).finally(()=>app.exit(0));
  });
}
