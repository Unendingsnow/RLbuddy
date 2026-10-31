'use strict';
(() => {
  const $ = id => document.getElementById(id), api = window.buddy;
  const button = document.createElement('button'); button.className = 'nav-item'; button.textContent = 'Memory & coaching'; button.dataset.page = 'garage';
  document.querySelector('.sidebar nav').append(button);
  const page = document.createElement('section'); page.className = 'page'; page.id = 'page-garage';
  page.innerHTML = `<div class="page-heading"><div><div class="eyebrow">THE POST-MATCH AUTOPSY</div><h1>Remember. Review. Improve.</h1><p>Jackshaft keeps receipts. You decide what stays.</p></div></div>
  <div class="note"><p id="coach-gate" role="status">Checking game state…</p></div>
  <div class="settings-grid"><section class="card settings-card"><h2>Local match memory</h2>
  <label class="toggle-row"><span>Save match events & stats</span><input type="checkbox" id="memory-enabled"><span class="toggle-visual"></span></label>
  <label class="toggle-row"><span>Save selected-window frames this launch</span><input type="checkbox" id="memory-capture"><span class="toggle-visual"></span></label>
  <p>Choose a source in Connection & AI. Frames stay on this PC until you request an AI review. Capture resets to off each launch. Up to 90 frames per match, sampled at least 10 seconds apart; this is not a full video recording.</p>
  <label class="field-label" for="memory-days">Keep history</label><select id="memory-days"><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option></select>
  <p>Automatic limits: 100 matches / 500 MB. Deleting a match also removes its frames and saved review.</p>
  <button class="button secondary" id="memory-clear">Delete all match memory</button>
  <div id="memory-confirm" hidden><p>Delete all saved match events, frames and reviews? This cannot be undone.</p><button class="button primary" id="memory-clear-confirm">Delete permanently</button><button class="button secondary" id="memory-clear-cancel">Cancel</button></div>
  </section><section class="card settings-card"><h2>The meter</h2><div class="usage-grid" id="usage-totals"></div><p>Actual provider-reported tokens × published standard rates = estimated USD, not an invoice. Credits, discounts and tax are not included. Unknown models or interrupted requests with no usage are marked unpriced, never free.</p><p>Local Ollama: $0 API fee; it still uses your hardware and electricity. Prices verified October 31, 2026. Last 10,000 requests retained.</p><div id="usage-recent" class="usage-recent"></div></section></div>
  <section class="card settings-card garage-section"><h2>Your season so far</h2><p id="memory-progress"></p><p>AI review uses your selected provider. When Realtime is selected, detailed reports use OpenAI gpt-4.1-mini with the same API key. Other providers use your selected model.</p><div class="review-layout"><div id="match-list"></div><div><div id="review-actions" hidden><button class="button secondary" id="review-local">Free event debrief</button> <button class="button primary" id="review-ai">AI review · sends saved evidence</button> <button class="text-button" id="match-delete">Delete this match</button></div><p id="review-status" role="status"></p><pre id="review-text">Select a completed match. No demo events are saved.</pre><div id="review-frames"></div></div></div></section>
  <section class="card settings-card garage-section"><h2>Local AI workshop</h2><p>One setup button: reuse Ollama if installed, or download and install its official Windows release for your account. The runtime installer is about 1.6 GB; allow at least 7 GB free for setup, plus several GB for your chosen model. No terminal required.</p><div class="button-row"><button class="button primary" id="local-setup">Set up Ollama</button><button class="button secondary" id="local-setup-cancel" hidden>Cancel download</button></div><progress id="local-setup-progress" max="100" value="0" hidden style="width:100%;margin-top:12px"></progress><p id="local-setup-status" role="status">Checking for Ollama…</p><div class="button-row"><select id="local-model"><option value="qwen3.5:4b">Qwen3.5 4B · general vision</option><option value="qwen3-vl:4b">Qwen3-VL 4B · alternative</option><option value="qwen3.5:2b">Qwen3.5 2B · lighter</option></select><button class="button secondary" id="local-check">Check models</button><button class="button secondary" id="local-download">Download model</button><button class="button primary" id="local-use">Use local AI</button></div><p id="local-status" role="status">The app never silently switches to a paid provider. Local models share GPU memory with the game; benchmark between matches.</p><button class="button secondary" id="local-test">Run vision benchmark</button><p id="local-test-result"></p></section>`;
  document.querySelector('.main-footer').before(page);
  const evidence=document.createElement('div');evidence.id='team-evidence';$('review-text').before(evidence);
  function showTeam(match) {
    evidence.replaceChildren();const roster=match.roster || {},players=roster.players || [];
    const heading=document.createElement('h2');heading.textContent='Whole-field evidence';evidence.append(heading);
    if(!players.length){const p=document.createElement('p');p.textContent='This older match has no all-player record. New matches capture both teams.';evidence.append(p);return;}
    const table=document.createElement('table'),head=document.createElement('tr');for(const label of ['Player','Team','Role','G','Shots','A','Saves','Demos']){const th=document.createElement('th');th.textContent=label;head.append(th);}table.append(head);
    const local=players.find(p=>p.id===roster.localId);
    for(const p of players){const row=document.createElement('tr');const role=p.id===roster.localId?'You':local && [0,1].includes(local.team) && [0,1].includes(p.team)?p.team===local.team?'Teammate':'Opponent':'Unknown';for(const value of [p.name,p.team===0?'Blue':p.team===1?'Orange':'?',role,...['goals','shots','assists','saves','demos'].map(k=>p.stats?.[k]??'?')]){const td=document.createElement('td');td.textContent=String(value);row.append(td);}table.append(row);}evidence.append(table);
    const note=document.createElement('p');note.textContent=`${match.teamEvents?.length || 0} attributed events. “?” means not reported. Names and team stats are included when you request an AI review. Totals alone do not prove rotations or teammate fault.`;evidence.append(note);
  }
  // A separate bridge subscription keeps evidence private when play resumes.
  api.onState(s=>{if(!s.memory?.allowed)evidence.replaceChildren();});
  const originalGetMatch=api.getMatch;
  // Render evidence alongside the existing match selection without modifying the frozen bridge.
  async function getMatchWithTeam(id){const r=await originalGetMatch(id);if(r?.ok && latest?.memory?.allowed)showTeam(r.match);return r;}
  button.addEventListener('click', () => {
    document.querySelectorAll('.page').forEach(x => x.classList.toggle('active', x === page));
    document.querySelectorAll('[data-page]').forEach(x => x.classList.toggle('active', x === button));
    $('breadcrumb-current').textContent = 'Memory & coaching';
  });
  const style = document.createElement('label'); style.className = 'field-label'; style.textContent = 'Character art';
  const select = document.createElement('select'); select.id = 'character-art'; select.innerHTML = '<option value="jackshaft">Jackshaft · haunted pit crew</option><option value="classic">Ratchet · original art</option>';
  document.querySelector('.overlay-settings').append(style, select);
  select.addEventListener('change', () => action(() => api.saveSettings({character:select.value})));
  let latest, selected = null, signature = '', busy = false;
  async function action(fn) { try { const r = await fn(); if (r?.ok === false) throw new Error(r.error); return r; } catch(e) { $('review-status').textContent = e.message; return null; } }
  const money = n => '$' + n.toFixed(6);
  function render(s) {
    latest = s; const m = s.memory || {}, u = s.usage || {}, settings = s.settings || {};
    const setup=s.localSetup || {}, working=['checking','downloading','installing','starting'].includes(setup.phase);
    $('local-setup').disabled=working; $('local-setup-cancel').hidden=!['checking','downloading'].includes(setup.phase);
    $('local-setup-progress').hidden=setup.phase!=='downloading'; $('local-setup-progress').value=setup.total?setup.received/setup.total*100:0;
    if(setup.phase && setup.phase!=='idle')$('local-setup-status').textContent=setup.text;
    $('memory-enabled').checked = settings.memory?.enabled !== false; $('memory-capture').checked = Boolean(settings.memory?.capture); $('memory-days').value = settings.memory?.retentionDays || 30; select.value = settings.character || 'jackshaft';
    $('coach-gate').textContent = m.allowed ? 'Post-match review is available. Saved drills can be practiced later in Free Play.' : 'Coaching paused: match active or game mode unknown. Finish the match or close Rocket League. Live Free Play detection is not reliable enough to enable coaching automatically.';
    if (!m.allowed) { selected = null; $('review-text').textContent = 'Review hidden while coaching is paused.'; $('review-frames').replaceChildren(); $('review-actions').hidden = true; }
    if (selected && !(m.matches || []).some(x => x.id === selected)) { selected = null; evidence.replaceChildren(); $('review-actions').hidden = true; $('review-text').textContent = 'Match deleted or expired.'; $('review-frames').replaceChildren(); }
    const p = m.progress || {}; $('memory-progress').textContent = `${p.matches || 0} completed results · ${p.wins || 0} wins · ${p.goals || 0} goals · ${p.shots || 0} shots · ${p.saves || 0} saves. Totals only; incomplete matches excluded.`;
    $('usage-totals').replaceChildren(); for (const [key,label] of [['session','This launch'],['today','Today'],['retained','Retained history']]) { const t = u[key] || {usd:0,requests:0,unpriced:0}, el=document.createElement('div'); el.textContent = `${label}: ${money(t.usd)} estimated · ${t.requests} calls${t.unpriced ? ` · ${t.unpriced} unpriced` : ''}`; $('usage-totals').append(el); }
    $('usage-recent').replaceChildren(); for (const r of (u.recent || []).slice(0,8)) { const el = document.createElement('p'); el.textContent = `${new Date(r.at).toLocaleTimeString()} · ${r.kind} · ${r.model} · ${r.input ?? '?'} in / ${r.output ?? '?'} out · ${r.usd === null ? 'Unpriced' : money(r.usd)}`; $('usage-recent').append(el); }
    const sig = JSON.stringify([m.matches,m.allowed]); if (sig === signature) return; signature=sig;
    $('match-list').replaceChildren(); if (!m.matches?.length) $('match-list').textContent = 'Your next match will appear here when the game feed connects.';
    for (const match of m.matches || []) { const b=document.createElement('button'); b.className='match-row'; b.disabled=!m.allowed || !match.endedAt; b.textContent=`${new Date(match.startedAt).toLocaleString()} · ${match.result} · ${match.events} events / ${match.frames} frames`; b.addEventListener('click',async()=>{ const r=await action(()=>getMatchWithTeam(match.id)); if (!r || !latest.memory?.allowed) return; selected=match.id; $('review-actions').hidden=false; $('review-status').textContent=''; $('review-text').textContent=(r.match.review?.evidenceUpdated ? 'Evidence was updated after this report. Generate a fresh review.\n\n' : '') + (r.match.review?.text || 'Choose a free event debrief or an AI review.'); $('review-frames').replaceChildren(); for (const f of r.match.frames) { const figure=document.createElement('figure'), img=document.createElement('img'), caption=document.createElement('figcaption'); img.src=f.dataUrl; img.alt=`Saved game frame at ${f.seconds} seconds`; img.loading='lazy'; caption.textContent=`${f.seconds}s elapsed`; figure.append(img,caption); $('review-frames').append(figure); } }); $('match-list').append(b); }
  }
  for (const [id,key] of [['memory-enabled','enabled'],['memory-capture','capture']]) $(id).addEventListener('change',async()=>{ const r=await action(()=>api.saveSettings({memory:{[key]:$(id).checked}})); if (!r) render(latest); });
  $('memory-days').addEventListener('change',()=>action(()=>api.saveSettings({memory:{retentionDays:Number($('memory-days').value)}})));
  $('memory-clear').onclick=()=>{$('memory-confirm').hidden=false;}; $('memory-clear-cancel').onclick=()=>{$('memory-confirm').hidden=true;};
  $('memory-clear-confirm').onclick=async()=>{await action(()=>api.clearMemory());$('memory-confirm').hidden=true;};
  $('match-delete').onclick=()=>selected && action(()=>api.deleteMatch(selected));
  async function review(ai) { if (!selected || busy) return; busy=true; const id=selected; $('review-local').disabled=$('review-ai').disabled=true; $('review-status').textContent=ai?'Reviewing saved evidence… This may take up to two minutes.':'Building event debrief…'; const r=await action(()=>api.reviewMatch(id,ai)); if(r && selected===id && latest.memory?.allowed){$('review-text').textContent=r.text;$('review-status').textContent='Review saved locally.';} busy=false; $('review-local').disabled=$('review-ai').disabled=false; }
  $('review-local').onclick=()=>review(false); $('review-ai').onclick=()=>review(true);
  $('local-check').onclick=async()=>{ const r=await action(()=>api.localModels()); $('local-status').textContent=r?`Installed: ${r.models.map(m=>m.name).join(', ') || 'No models yet.'}`:$('review-status').textContent; };
  $('local-setup').onclick=async()=>{ $('local-setup').disabled=true; $('local-setup-status').textContent='Preparing local AI setup…'; const r=await action(()=>api.setupLocal()); if(!r)$('local-setup-status').textContent=$('review-status').textContent; $('local-setup').disabled=false; };
  $('local-setup-cancel').onclick=()=>action(()=>api.cancelLocalSetup());
  $('local-download').onclick=async()=>{ $('local-download').disabled=true; $('local-status').textContent='Downloading model through Ollama… several GB; may take many minutes. Ollama keeps partial downloads for resuming.'; const r=await action(()=>api.pullModel($('local-model').value)); $('local-status').textContent=r?'Model downloaded. Click Use local AI.':$('review-status').textContent; $('local-download').disabled=false; };
  $('local-use').onclick=async()=>{ const r=await action(()=>api.saveSettings({ai:{provider:'ollama',baseUrl:'http://127.0.0.1:11434',model:$('local-model').value,enabled:true},vision:{enabled:false}})); $('local-status').textContent=r?'Local AI selected. Run the vision benchmark next.':$('review-status').textContent; };
  $('local-test').onclick=async()=>{ $('local-test').disabled=true; $('local-test-result').textContent='Testing a synthetic scoreboard image…'; const r=await action(()=>api.testLocal()); $('local-test-result').textContent=r?`${(r.latencyMs/1000).toFixed(1)}s including model load. Model: ${r.text}. Expected: ${r.expected}. This checks image input, not gameplay accuracy.`:$('review-status').textContent; $('local-test').disabled=false; };
  api.onState(render); api.getState().then(render);
  api.detectLocal().then(r=>{if(!r.ok)return;$('local-setup').textContent=r.running?'Ollama ready':r.installed?'Start Ollama':'Download & install Ollama';$('local-setup-status').textContent=r.running?'Ollama is running. Choose a model below.':r.installed?'Ollama is installed. Start it with the button above.':'Ollama is not installed. Setup will fetch and verify the official installer.';}).catch(()=>{});
})();
