'use strict';
const fs = require('node:fs');
const path = require('node:path');
// USD / million tokens, standard processing. Verified 2026-10-31.
const RATES = {
  'gpt-4.1-mini': { input: .4, cached: .1, output: 1.6 },
  'gpt-4.1-mini-2025-04-14': { input: .4, cached: .1, output: 1.6 },
  'gpt-realtime-2.1': { input: 4, cached: .4, output: 24, image: 5, cachedImage: .5, audio: 32, cachedAudio: .4, audioOutput: 64 },
  'gpt-realtime-2.1-mini': { input: .6, cached: .06, output: 2.4, image: .8, cachedImage: .08, audio: 10, cachedAudio: .3, audioOutput: 20 },
};
const count = v => Number.isFinite(v) && v >= 0 ? v : 0;
function price(provider, model, usage) {
  if (provider === 'ollama') return 0;
  const r = provider.startsWith('openai') && RATES[model];
  if (!r || !usage || !Number.isFinite(usage.input_tokens ?? usage.prompt_tokens) || !Number.isFinite(usage.output_tokens ?? usage.completion_tokens)) return null;
  const input = count(usage.input_tokens ?? usage.prompt_tokens), output = count(usage.output_tokens ?? usage.completion_tokens);
  const d = usage.input_token_details || usage.input_tokens_details || usage.prompt_tokens_details || {};
  const cached = Math.min(input, count(d.cached_tokens));
  if (provider !== 'openai-realtime') return ((input - cached) * r.input + cached * r.cached + output * r.output) / 1e6;
  // Never price unknown modality breakdown as cheap text.
  if (!Number.isFinite(d.text_tokens)) return null;
  const c = d.cached_tokens_details || {};
  if (cached && !Number.isFinite(c.text_tokens)) return null;
  const image = count(d.image_tokens), audio = count(d.audio_tokens);
  if (count(d.text_tokens) + image + audio !== input) return null;
  const ci = Math.min(image, count(c.image_tokens)), ca = Math.min(audio, count(c.audio_tokens));
  const ct = Math.max(0, cached - ci - ca), text = Math.max(0, input - image - audio);
  const ao = count(usage.output_token_details?.audio_tokens);
  return ((text - ct) * r.input + ct * r.cached + (image - ci) * r.image + ci * r.cachedImage + (audio - ca) * r.audio + ca * r.cachedAudio + (output - ao) * r.output + ao * r.audioOutput) / 1e6;
}
class UsageLedger {
  constructor(dir, {background=false,onError=()=>{}}={}) {
    this.background=background;this.onError=onError;this.queue=Promise.resolve();this.error=null;
    this.file = path.join(dir, 'usage.json'); this.rows = []; this.startedAt = Date.now();
    try { const x = JSON.parse(fs.readFileSync(this.file));if(!Array.isArray(x))throw Error('Invalid ledger');this.rows=x.slice(-10000).filter(r=>Number.isFinite(r.at)&&typeof r.provider==='string'&&typeof r.model==='string'&&(r.usd===null||Number.isFinite(r.usd))); } catch(e) {if(e.code!=='ENOENT'){this.error='Usage history could not be read. Paid AI is paused until the ledger is repaired.';this.onError(this.error);}}
  }
  record({ provider, model, kind = 'chat', usage, status = 'completed' }) {
    const row = { at: Date.now(), provider, model, kind, status, input: usage?.input_tokens ?? usage?.prompt_tokens ?? null, output: usage?.output_tokens ?? usage?.completion_tokens ?? null, cached: usage?.input_tokens_details?.cached_tokens ?? usage?.input_token_details?.cached_tokens ?? 0, usd: price(provider, model, usage), rateDate: '2026-10-31' };
    this.rows.push(row); this.rows = this.rows.slice(-10000);
    const payload=JSON.stringify(this.rows);
    const failed=()=>{this.error='Usage history could not be saved. Paid AI is paused; check disk space and folder permissions.';this.onError(this.error);};
    if(this.background)this.queue=this.queue.then(async()=>{await fs.promises.writeFile(this.file+'.tmp',payload);await fs.promises.rename(this.file+'.tmp',this.file);}).catch(failed);
    else try{fs.writeFileSync(this.file+'.tmp',payload);fs.renameSync(this.file+'.tmp',this.file);}catch{failed();}
    return row;
  }
  summary() {
    const today = new Date().toDateString();
    const total = rows => ({ usd: rows.reduce((n, r) => n + (r.usd || 0), 0), requests: rows.length, unpriced: rows.filter(r => r.usd === null).length });
    return { session: total(this.rows.filter(r => r.at >= this.startedAt)), today: total(this.rows.filter(r => new Date(r.at).toDateString() === today)), retained: total(this.rows), recent: this.rows.slice(-30).reverse(), rateDate: '2026-10-31' };
  }
  flush(){return this.queue;}
}
module.exports = { UsageLedger, price, RATES };
