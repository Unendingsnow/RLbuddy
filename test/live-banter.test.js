'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LiveBanter } = require('../src/personality/live-banter');
const { ReactionEngine } = require('../src/personality/engine');
const { normalizeSettings } = require('../src/settings');
const pack = require('../personalities/jackshaft.json');
const image = 'data:image/png;base64,aGVsbG8=';

function fixture() {
  let time = 100000, speaking = false;
  const settings = normalizeSettings({ ai: { enabled: true, dynamicReactions: true }, vision: { enabled: true } });
  const calls = [], published = [];
  const engine = { react: async (event, options) => { calls.push({event, options}); return {text:'event'}; },
    observe: async value => { calls.push(value); return {text:'image'}; } };
  const live = new LiveBanter({ getEngine: () => engine, getSettings: () => settings,
    getSnapshot: () => ({ connected: true, matchActive: true, blueScore: 2 }), canSpeak: () => !speaking,
    publish: value => { if(value) published.push(value); }, now: () => time });
  return { live, engine, settings, calls, published, advance: ms => {time += ms;}, reading: value => {speaking = value;}, frame: () => ({dataUrl:image,capturedAt:time}) };
}
test('live vision works during a match, skips requests while reading, and uses only fresh verified events', async () => {
  const f = fixture(); f.reading(true);
  await f.live.event({type:'goal',blueScore:2}); await f.live.observe(f.frame());
  assert.equal(f.calls.length,0);
  f.reading(false); await f.live.observe(f.frame());
  assert.equal(f.calls[0].context.type,'goal'); assert.equal(f.published.length,1);
  f.advance(6001); await f.live.observe(f.frame());
  assert.equal(f.calls[1].context.type,undefined); assert.equal(f.calls[1].context.blueScore,2);
});
test('AI event opt-in routes text without capture; disabled AI event banter stays local', async () => {
  const f = fixture(); f.settings.vision.enabled = false;
  await f.live.event({type:'save'}); assert.equal(f.calls[0].options.localOnly,false);
  f.settings.ai.dynamicReactions = false;
  await f.live.event({type:'goal'}); assert.equal(f.calls[1].options.localOnly,true);
  await f.live.observe(f.frame()); assert.equal(f.calls.length,2);
  assert.equal(normalizeSettings().ai.dynamicReactions,false);
});
test('fresh images accompany plays, stale images are never attached, and no backlog accumulates', async () => {
  const f = fixture(); f.reading(true); await f.live.observe(f.frame()); f.reading(false);
  let resolve; f.engine.observe = async value => { f.calls.push(value); return new Promise(r => {resolve=r;}); };
  const pending=f.live.event({type:'goal'});
  await f.live.event({type:'save'}); await f.live.observe(f.frame());
  assert.equal(f.calls.length,1); assert.equal(f.calls[0].context.type,'goal');
  f.live.reset(); resolve({text:'obsolete'}); await pending; assert.equal(f.published.length,0);
  f.advance(3000); await f.live.event({type:'conceded'});
  assert.equal(f.calls[1].event.type,'conceded');
});
test('vision failure falls back only for a confirmed play; intentional silence does not', async () => {
  const f=fixture(); f.engine.observe=async()=>null;
  await f.live.observe(f.frame()); assert.equal(f.calls.length,0);
  f.engine.observationError='Unavailable';
  await f.live.event({type:'goal'}); assert.equal(f.calls[0].options.localOnly,true);
  f.engine.observationError=null;
  await f.live.event({type:'save'}); assert.equal(f.calls.length,1);
});

for (const provider of ['ollama','openai','openai-realtime','compatible']) {
  test(`${provider}: explicit one-shot sends image + event, produces AI bubble and accounts usage with capture off`, async t => {
    const settings=normalizeSettings({ai:{enabled:true,provider,model:'test-model',baseUrl:'http://127.0.0.1:11434'}});
    settings.ai.apiKey='fixture-key'; const calls=[],usage=[];
    const responseText='That goal just repossessed their dignity.';
    const engine=new ReactionEngine({getSettings:()=>settings,getPersonality:()=>pack,onUsage:row=>usage.push(row),
      fetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)}); return {ok:true,json:async()=>({usage:{input_tokens:12,output_tokens:9},prompt_eval_count:12,eval_count:9,message:{content:responseText},choices:[{message:{content:responseText}}],output:[{type:'message',content:[{type:'output_text',text:responseText}]}]})};},
      realtime:{dispose(){},request:async args=>{calls.push(args);args.onUsage({input_tokens:12,output_tokens:9});return responseText;}}});
    t.after(()=>engine.dispose());
    assert.equal(await engine.observe({dataUrl:image}),null); assert.equal(calls.length,0);
    const reply=await engine.observe({dataUrl:image,context:{type:'goal',blueScore:2}}, {once:true,force:true});
    assert.equal(reply.source,'ai'); assert.equal(reply.eventType,'goal'); assert.equal(reply.mood,'hype');
    assert.equal(reply.text,responseText); assert.equal(usage.length,1); assert.equal(usage[0].provider,provider);
    const request=JSON.stringify(calls[0]); assert.match(request,/hGV|aGVsbG8=/); assert.match(request,/goal/); assert.match(request,/Entertainment only/);
    if(provider==='openai') {assert.equal(calls[0].url,'https://api.openai.com/v1/responses');assert.equal(calls[0].body.store,false);}
    if(provider==='ollama') assert.equal(calls[0].body.think,false);
    assert.equal(settings.vision.enabled,false);
  });
}
test('one-shot never sends with AI disabled and drops a reply after provider change', async t => {
  const settings=normalizeSettings(); let resolve,calls=0;
  const engine=new ReactionEngine({getSettings:()=>settings,getPersonality:()=>pack,fetch:()=>{calls++;return new Promise(r=>{resolve=r;});}});
  t.after(()=>engine.dispose());
  assert.equal(await engine.observe({dataUrl:image},{once:true}),null);assert.equal(calls,0);
  settings.ai={enabled:true,provider:'ollama',model:'test'};
  const pending=engine.observe({dataUrl:image},{once:true});settings.ai.provider='openai';
  resolve({ok:true,json:async()=>({message:{content:'stale'}})});
  assert.equal(await pending,null);
});

test('repeated image commentary stays silent but the consumed request is still accounted', async t => {
  const settings=normalizeSettings({ai:{enabled:true,provider:'ollama',model:'fixture'},vision:{enabled:true}});
  let now=10000; const usage=[];
  const engine=new ReactionEngine({getSettings:()=>settings,getPersonality:()=>pack,now:()=>now,onUsage:row=>usage.push(row),
    fetch:async()=>({ok:true,json:async()=>({message:{content:'That net just got haunted.'},prompt_eval_count:20,eval_count:8})})});
  t.after(()=>engine.dispose());
  assert.equal((await engine.observe({dataUrl:image})).source,'ai');
  now+=20000; assert.equal(await engine.observe({dataUrl:image}),null);
  assert.equal(engine.observationOutcome,'silent'); assert.equal(usage.length,2);
});
