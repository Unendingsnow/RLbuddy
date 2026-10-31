'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Explicit opt-in integration test: real local inference, isolated app profile,
// synthetic image only. No desktop capture or cloud provider is used.
async function run({ dashboard, overlay, state, changeSettings }) {
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    if (!dashboard.webContents.isLoading() && await dashboard.webContents.executeJavaScript("Boolean(window.buddy?.testInteraction && document.getElementById('test-ai-sample'))")) break;
    await delay(100);
  }
  await changeSettings({ ai: { enabled: true, dynamicReactions: true, provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'qwen3.5:4b' } });
  const results = [];
  for (const event of ['goal', 'conceded']) {
    const result = await dashboard.webContents.executeJavaScript(`window.buddy.testInteraction({mode:'sample',event:${JSON.stringify(event)}})`);
    console.log(JSON.stringify({ event, ...result }));
    assert.equal(result.ok, true, result.error);
    assert.ok(['ai','fallback'].includes(result.outcome));
    await delay(200);
    assert.equal(state().history.at(-1).source, result.outcome==='ai'?'ai':'local');
    assert.equal(state().history.at(-1).eventType, event);
    assert.equal(await overlay.webContents.executeJavaScript("document.getElementById('overlay-text').textContent"), result.text);
    results.push({ event, ...result });
    await delay(2100);
  }
  assert.notEqual(results[0].text, results[1].text, 'Different plays should produce different replies');
  assert.equal(state().settings.vision.enabled, false, 'One-shot test must not enable capture');
  assert.equal(state().usage.today.requests, 2);
  const dir = path.resolve(__dirname, '../artifacts'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'local-interaction.json'), JSON.stringify({ at: new Date().toISOString(), results, usage: state().usage.today }, null, 2));
  fs.writeFileSync(path.join(dir, 'local-interaction-overlay.png'), (await overlay.webContents.capturePage()).toPNG());
  console.log('LOCAL AI INTERACTION PASSED: real image requests, distinct play reactions, truthful AI/fallback labels, overlay bubbles, usage ledger, capture stays off.');
}
module.exports = { run };
