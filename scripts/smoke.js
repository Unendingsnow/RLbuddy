'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, label) {
  const end = Date.now() + 10000;
  while (Date.now() < end) { if (await check()) return; await delay(100); }
  throw new Error(`Timed out: ${label}`);
}
async function runSmoke({ dashboard, overlay, state, store, registry, changeSettings, game }) {
  const artifacts = path.resolve(__dirname, '..', 'artifacts'); fs.mkdirSync(artifacts, { recursive: true });
  const errors = [];
  for (const win of [dashboard, overlay]) win.webContents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); });
  await waitFor(() => dashboard.webContents.executeJavaScript("Boolean(window.buddy && document.getElementById('buddy-name')?.textContent === 'Jackshaft')"), 'dashboard ready');
  await waitFor(() => overlay.webContents.executeJavaScript("Boolean(document.getElementById('overlay-character')?.querySelector('svg'))"), 'overlay ready');
  assert.equal(state().personalities.length >= 3, true);
  assert.equal(overlay.isContentProtected(), false, 'desktop sharing must not exclude the buddy');
  assert.equal(await dashboard.webContents.executeJavaScript('typeof require'), 'undefined');
  assert.equal(await dashboard.webContents.executeJavaScript('typeof process'), 'undefined');
  const result = await dashboard.webContents.executeJavaScript("window.buddy.demo('goal')"); assert.equal(result.ok, true);
  await waitFor(() => overlay.webContents.executeJavaScript("!document.getElementById('overlay-bubble').classList.contains('hidden') && document.getElementById('overlay-text').textContent.length > 5"), 'goal bubble');
  const text = state().history.at(-1).text;
  assert.equal(await overlay.webContents.executeJavaScript("document.getElementById('overlay-text').textContent"), text);
  assert.equal(state().history.at(-1).source, 'local');
  const began = Date.now();
  game.tracker.setConnected(true);
  game.tracker.handleMessage({ Event: 'MatchCreated', Data: { MatchGuid: 'smoke-match' } });
  await delay(50);
  assert.ok(Date.now() - began < 500, 'local event handling must not wait on network');
  const save = await dashboard.webContents.executeJavaScript("window.buddy.saveSettings({personalityId:'hype',spice:2})");
  assert.equal(save.ok, true);
  await waitFor(() => dashboard.webContents.executeJavaScript("document.getElementById('buddy-name').textContent === 'Amp'"), 'personality switched');
  await dashboard.webContents.executeJavaScript("window.buddy.chat('hello buddy')");
  assert.equal(state().history.at(-1).personalityId, 'hype');
  assert.equal(state().history.at(-1).source, 'local');
  await changeSettings({ personalityId: 'jackshaft', spice: 2, overlayLocked: false });
  assert.equal(overlay.isFocusable(), true);
  await changeSettings({ overlayLocked: true }); assert.equal(overlay.isFocusable(), false);
  await dashboard.webContents.executeJavaScript("document.querySelector('[data-page=personalities]').click()");
  assert.equal(await dashboard.webContents.executeJavaScript("document.querySelector('.page.active').id"),'page-personalities');
  await waitFor(() => dashboard.webContents.executeJavaScript("document.querySelectorAll('.personality-card,.pack-card').length >= 3"), 'pack cards');
  dashboard.webContents.invalidate(); await delay(500);
  fs.writeFileSync(path.join(artifacts, 'personalities.png'), (await dashboard.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  await dashboard.webContents.executeJavaScript("document.querySelector('[data-page=connection]').click()");
  assert.equal(await dashboard.webContents.executeJavaScript("document.querySelector('.page.active').id"),'page-connection');
  dashboard.webContents.invalidate(); await delay(500);
  fs.writeFileSync(path.join(artifacts, 'connection.png'), (await dashboard.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  await dashboard.webContents.executeJavaScript("document.querySelector('[data-page=companion]').click(); window.buddy.demo('epic_save')");
  assert.equal(await dashboard.webContents.executeJavaScript("document.querySelector('.page.active').id"), 'page-companion');
  dashboard.webContents.invalidate(); await delay(500);
  fs.writeFileSync(path.join(artifacts, 'dashboard.png'), (await dashboard.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  fs.writeFileSync(path.join(artifacts, 'overlay.png'), (await overlay.webContents.capturePage()).toPNG());
  // Exercise memory/coaching through the real sandbox bridge; no paid provider calls.
  game.tracker.setConnected(true);
  const scorer={Name:'Smoke teammate',TeamNum:0,Shortcut:1,Goals:2,Shots:4,Assists:0,Saves:1};
  const assister={Name:'Smoke passer',TeamNum:0,Shortcut:2,Goals:0,Shots:1,Assists:2,Saves:0};
  game.tracker.handleMessage({ Event:'UpdateState', Data:{ MatchGuid:'smoke-match', Game:{TimeSeconds:100,Teams:[{TeamNum:0,Score:2},{TeamNum:1,Score:1}]},Players:[scorer,assister,{Name:'Smoke opponent',TeamNum:1,Shortcut:3,Goals:1,Shots:2,Assists:0,Saves:2}] } });
  game.tracker.handleMessage({Event:'GoalScored',Data:{Scorer:scorer,Assister:assister}});
  game.tracker.handleMessage({ Event:'MatchEnded', Data:{WinnerTeamNum:0} });
  const match = state().memory.matches.find(m => m.endedAt);
  assert.ok(match, 'completed match persisted');
  const review = await dashboard.webContents.executeJavaScript(`window.buddy.reviewMatch(${JSON.stringify(match.id)}, false)`);
  assert.equal(review.ok,true); assert.match(review.text,/FREE PLAY DRILL/);
  assert.match(review.text,/Smoke passer → Smoke teammate/);
  await dashboard.webContents.executeJavaScript("document.querySelector('[data-page=garage]').click()");
  await waitFor(() => dashboard.webContents.executeJavaScript("document.querySelectorAll('.match-row:not(:disabled)').length > 0"),'match list');
  await dashboard.webContents.executeJavaScript("document.querySelector('.match-row').click()");
  await waitFor(() => dashboard.webContents.executeJavaScript("document.getElementById('review-text').textContent.includes('FREE PLAY DRILL')"),'saved review');
  assert.equal(await dashboard.webContents.executeJavaScript("document.querySelectorAll('#team-evidence tr').length"),4);
  await delay(300);
  fs.writeFileSync(path.join(artifacts,'coaching.png'),(await dashboard.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  game.tracker.handleMessage({Event:'MatchCreated',Data:{MatchGuid:'next-smoke-match'}});
  await waitFor(() => dashboard.webContents.executeJavaScript("document.getElementById('review-actions').hidden && document.getElementById('review-text').textContent.includes('paused')"),'review hidden during match');
  assert.equal(await dashboard.webContents.executeJavaScript("document.querySelectorAll('#team-evidence tr').length"),0);
  const blocked = await dashboard.webContents.executeJavaScript(`window.buddy.reviewMatch(${JSON.stringify(match.id)}, false)`);
  assert.equal(blocked.ok,false);
  assert.equal(state().usage.today.requests,0);
  // Exercise the real UI -> IPC -> image transport -> overlay path against a
  // local compatible-endpoint fixture. Never contact a paid API in smoke tests.
  const requests = [];
  const server = require('node:http').createServer((req,res) => {
    let body = ''; req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      requests.push(JSON.parse(body)); res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify({choices:[{message:{content:'That goal just scared the bolts off my pumpkin.'}}],usage:{prompt_tokens:100,completion_tokens:12}}));
    });
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  try {
    await changeSettings({budget:{enabled:false},ai:{enabled:true,dynamicReactions:true,provider:'compatible',model:'fixture-vision',baseUrl:`http://127.0.0.1:${server.address().port}`}});
    await dashboard.webContents.executeJavaScript("document.querySelector('[data-page=connection]').click();document.getElementById('test-ai-sample').click()");
    await waitFor(() => dashboard.webContents.executeJavaScript("document.getElementById('interaction-result').textContent.includes('AI reply shown')"),'AI sample test result');
    assert.equal(requests.length,1);
    assert.equal(requests[0].messages[1].content[1].type,'image_url');
    assert.match(requests[0].messages[1].content[1].image_url.url,/^data:image\/png;base64,/);
    assert.match(requests[0].messages[1].content[0].text,/goal/);
    assert.equal(state().history.at(-1).source,'ai');
    assert.equal(await overlay.webContents.executeJavaScript("document.getElementById('overlay-text').textContent"),state().history.at(-1).text);
    assert.equal(state().settings.vision.enabled,false);
    assert.equal(state().memory.allowed,false,'AI entertainment must not unlock live coaching');
    assert.equal(state().usage.today.requests,1);
    assert.equal(state().usage.today.unpriced,1,'Unknown endpoint pricing is not reported as free');
    await dashboard.webContents.executeJavaScript("document.getElementById('interaction-test-card').scrollIntoView()");
    await delay(200);
    fs.writeFileSync(path.join(artifacts,'interaction-test.png'),(await dashboard.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  } finally { await new Promise(resolve => server.close(resolve)); }
  await dashboard.webContents.executeJavaScript("document.querySelector('[data-page=safety]').click()");
  assert.equal(await dashboard.webContents.executeJavaScript("document.querySelector('.page.active').id"),'page-safety');
  await dashboard.webContents.executeJavaScript("window.buddy.saveSettings({paused:true,reducedMotion:true,budget:{enabled:true,sessionUsd:0.2,dailyUsd:0.5}})");
  await waitFor(()=>dashboard.webContents.executeJavaScript("document.getElementById('capture-badge').textContent === 'BUDDY PAUSED' && document.documentElement.classList.contains('reduced-motion')"),'pause and reduced motion');
  assert.equal(state().settings.vision.enabled,false);assert.equal(state().settings.memory.capture,false);
  const paused=await dashboard.webContents.executeJavaScript("window.buddy.testInteraction({mode:'sample'})");assert.equal(paused.ok,false);
  assert.equal(state().usage.today.requests,1,'blocked request must not be billed');
  dashboard.webContents.invalidate(); await delay(500);
  fs.writeFileSync(path.join(artifacts,'safety.png'),(await dashboard.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  await changeSettings({paused:false});
  const art = await dashboard.webContents.executeJavaScript("(()=>{const c=document.querySelector('.jackshaft-art');return {width:c.width,height:c.height,alpha:c.getContext('2d').getImageData(0,0,1,1).data[3]}})()");
  assert.equal(art.width,384); assert.equal(art.height,512); assert.equal(art.alpha,0);
  const invalid = await dashboard.webContents.executeJavaScript("window.buddy.saveSettings({personalityId:'does-not-exist'})"); assert.equal(invalid.ok, false);
  await store.save({ ai: { apiKey: 'smoke-only-test-key' } });
  assert.equal(store.private().ai.apiKey, 'smoke-only-test-key');
  assert.equal(store.public().ai.apiKey, undefined);
  assert.equal(fs.readFileSync(store.file, 'utf8').includes('smoke-only-test-key'), false);
  await store.save({ ai: { apiKey: '' } });
  const settingsFile = JSON.parse(fs.readFileSync(store.file, 'utf8')); assert.equal(settingsFile.ai.apiKey, undefined);
  assert.equal(registry.errors.length, 0);
  // Check the supported small-window layout after loading the illustrated skin.
  const originalSize = dashboard.getSize();
  try {
    dashboard.setSize(960, 700);
    await dashboard.webContents.executeJavaScript("document.querySelector('[data-page=companion]').click(); window.scrollTo(0,0)");
    dashboard.webContents.invalidate(); await delay(500);
    assert.equal(await dashboard.webContents.executeJavaScript('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true, 'dashboard fits the minimum window width');
    const compactArt = await dashboard.webContents.executeJavaScript("(()=>{const c=document.querySelector('.jackshaft-art'),b=c.getBoundingClientRect(),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;return {width:b.width,height:b.height,display:getComputedStyle(c).display,hasPixels:d.some((v,i)=>i%4===3&&v>0)}})()");
    assert.ok(compactArt.width > 100 && compactArt.height > 100 && compactArt.display !== 'none' && compactArt.hasPixels, 'character remains visible at compact size with reduced motion');
    fs.writeFileSync(path.join(artifacts, 'dashboard-compact.png'), (await dashboard.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  } finally { dashboard.setSize(...originalSize); }
  assert.deepEqual(errors, []);
  console.log('APP SMOKE PASSED: sandboxed renderers, event bubbles, personality switch, chat fallback, overlay focus, navigation, screenshots, validation.');
}
module.exports = { runSmoke };
