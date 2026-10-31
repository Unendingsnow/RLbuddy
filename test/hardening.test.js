'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {LiveBanter}=require('../src/personality/live-banter');
const {ReactionEngine}=require('../src/personality/engine');
const {validateReaction}=require('../src/personality/quality');
const {AiGate}=require('../src/ai-gate');
const {MatchMemory}=require('../src/coaching/memory');
const {LocalModels}=require('../src/local-models');
const {readJson}=require('../src/http');
const pack=require('../personalities/jackshaft.json');
const frame={dataUrl:'data:image/png;base64,YQ==',capturedAt:100000};
function scheduler(engine,options={}) {
  const shown=[],settings={ai:{enabled:true,dynamicReactions:true},vision:{enabled:false}};
  const live=new LiveBanter({getEngine:()=>engine,getSettings:()=>settings,getSnapshot:()=>({}),canSpeak:()=>true,publish:r=>{if(r)shown.push(r);},now:()=>100000,schedule:()=>0,...options});
  return {live,shown,settings};
}
test('a goal supersedes an in-flight shot; older AI output never reaches the bubble',async()=>{
  let resolve;const requests=[];const engine={react:async event=>{requests.push(event.type);if(event.type==='shot')return new Promise(r=>{resolve=r;});return {text:'GOAL',eventType:'goal'};},cancel(){}};
  const {live,shown}=scheduler(engine);const pending=live.event({type:'shot'});await live.event({type:'goal'});resolve({text:'old shot',eventType:'shot'});await pending;await live.flush();
  assert.deepEqual(requests,['shot','goal']);assert.deepEqual(shown.map(r=>r.eventType),['goal']);
});
test('reading a bubble suppresses speech, not game memory; delayed priority play speaks once',async t=>{
  let reading=true;const settings={personalityId:pack.id,spice:2,ai:{enabled:false}};
  const engine=new ReactionEngine({getSettings:()=>settings,getPersonality:()=>pack});t.after(()=>engine.dispose());
  const {live,shown}=scheduler(engine,{canSpeak:()=>!reading});
  await live.event({type:'goal',source:'stats',id:'one'});await live.event({type:'goal',source:'stats',id:'two'});
  assert.equal(engine.matchMemory.get('game').goalStreak,2);assert.equal(shown.length,0);
  reading=false;await live.flush();await live.flush();assert.equal(shown.length,1);assert.equal(engine.matchMemory.get('game').goalStreak,2);
});
test('a confirmed goal after a silent frame falls back locally when the AI rate limit skips it',async t=>{
  let now=100000;const settings={personalityId:pack.id,spice:2,ai:{enabled:true,dynamicReactions:true,provider:'ollama',model:'fixture'},vision:{enabled:true,intervalSeconds:3}};
  const engine=new ReactionEngine({getSettings:()=>settings,getPersonality:()=>pack,now:()=>now,fetch:async()=>({ok:true,json:async()=>({message:{content:'...'}})})});t.after(()=>engine.dispose());
  const {live,shown}=scheduler(engine,{getSettings:()=>settings,now:()=>now});await live.observe(frame);now+=1000;await live.event({type:'goal',source:'stats',id:'goal'});
  assert.equal(shown.length,1);assert.equal(shown[0].source,'local');assert.equal(shown[0].eventType,'goal');
});
test('queued minor plays expire and new matches erase the queue',async()=>{
  let now=100000,reading=true;const {live,shown}=scheduler({react:async()=>({text:'late'})},{now:()=>now,canSpeak:()=>!reading});
  await live.event({type:'shot'});now+=6000;reading=false;await live.flush();assert.equal(shown.length,0);
  reading=true;await live.event({type:'goal'});live.reset();reading=false;await live.flush();assert.equal(shown.length,0);
});
test('quality checks reject fabricated blame, test references, profanity in Chill, and repeated wording',()=>{
  const cases=[
    ['That goal just scared the bolts off my pumpkin.','goal',2,true],
    ['What a save. The net owes you rent.','save',2,true],
    ['Fuck yes, that net had a family.','goal',2,true],
    ['You whiffed again, idiot.','conceded',2,false],
    ['You should rotate back post.','observation',2,false],
    ['Victory secured!','goal',2,false],
    ['That synthetic goal was cool.','goal',2,false],
    ['Fuck yes!','goal',0,false],
    ['...','observation',2,false],
    ['x'.repeat(181),'goal',2,false],
  ];for(const [text,event,spice,ok] of cases)assert.equal(validateReaction(text,{event,spice}).ok,ok,text);
  assert.equal(validateReaction('THAT net is haunted!',{history:['That net is haunted.']}).reason,'repeated');
});
test('global AI gate enforces concurrency, persistent rate limits, and estimated budget admission',()=>{
  let now=100000,usd=0;const settings={budget:{enabled:true,sessionUsd:.2,dailyUsd:1}};
  const gate=new AiGate({getSettings:()=>settings,now:()=>now,ledger:{summary:()=>({session:{usd,unpriced:0},today:{usd,unpriced:0}})}});
  const args={provider:'openai',model:'gpt-4.1-mini'};const ticket=gate.acquire(args);assert.throws(()=>gate.acquire({...args,kind:'coaching'}),/Another/);
  ticket.account({});ticket.release();assert.throws(()=>gate.acquire(args),/request limit/);
  now+=2100;usd=.15;assert.throws(()=>gate.acquire(args),/budget/);
  usd=0;assert.throws(()=>gate.acquire({provider:'compatible',model:'unknown'}),/known price/);
  settings.budget.enabled=false;const unknown=gate.acquire({provider:'compatible',model:'unknown'});unknown.account({});unknown.release();
});
test('failed AI requests back off; intentional cancellation does not back off; unpriced usage consumes a reserve',()=>{
  let now=100000,unpriced=0;const gate=new AiGate({getSettings:()=>({budget:{sessionUsd:.1,dailyUsd:1}}),now:()=>now,ledger:{summary:()=>({session:{usd:0,unpriced},today:{usd:0,unpriced}})}});
  const local={provider:'ollama',model:'fixture'};gate.acquire(local).release();now+=2100;assert.throws(()=>gate.acquire(local),/cooling down/);
  now+=60000;gate.acquire(local).release({cancelled:true});now+=2100;gate.acquire(local).release({cancelled:true});
  now+=2100;unpriced=1;assert.throws(()=>gate.acquire({provider:'openai',model:'gpt-4.1-mini'}),/budget/);
});
function memoryFixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rlbuddy-hardening-')),errors=[];const memory=new MatchMemory(dir,()=>100000,{background:true,onError:e=>errors.push(e)});t.after(async()=>{await memory.flush();assert.ok(dir.startsWith(path.join(os.tmpdir(),'rlbuddy-hardening-')));fs.rmSync(dir,{recursive:true,force:true});});return {dir,memory,errors};}
test('background memory writes images separately, survives reopening, and never resurrects deleted pending data',async t=>{
  const {dir,memory}=memoryFixture(t);memory.event({type:'match_start',source:'stats'},true);memory.frame({...frame,dataUrl:'data:image/jpeg;base64,YQ=='});memory.finish('win');await memory.flush();
  const id=memory.list()[0].id,raw=JSON.parse(fs.readFileSync(memory.file(id)));assert.equal(raw.schemaVersion,3);assert.equal(raw.frames[0].dataUrl,undefined);
  assert.equal(new MatchMemory(dir).get(id).frames[0].dataUrl,'data:image/jpeg;base64,YQ==');
  memory.review(id,'review');memory.delete(id);await memory.flush();assert.equal(fs.readdirSync(memory.dir).length,0);
});
test('disk failure reports a bounded warning while in-memory match tracking continues',async t=>{
  const {memory,errors}=memoryFixture(t);fs.rmdirSync(memory.dir);fs.writeFileSync(memory.dir,'not a directory');
  memory.event({type:'match_start',source:'stats'},true);await memory.flush();memory.event({type:'goal',source:'stats'},true);await memory.flush();
  assert.equal(memory.current.events.length,2);assert.ok(errors.length);assert.doesNotMatch(errors[0],/rlbuddy-hardening/);
});
test('HTTP replies without Content-Length are still bounded',async()=>{
  const response=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(100));c.close();}}));await assert.rejects(readJson(response,30),/size limit/);
});
test('model downloads report streaming progress and require a success marker',async()=>{
  const states=[];const models=new LocalModels({onStatus:s=>states.push(s),fetch:async()=>new Response('{"status":"pulling","total":100,"completed":50}\n{"status":"success"}\n')});
  assert.equal((await models.pull('qwen3.5:2b')).ok,true);assert.equal(states.at(-1).phase,'ready');assert.ok(states.some(s=>s.completed===50));
  models.fetch=async()=>new Response('{"status":"pulling"}\n');await assert.rejects(models.pull('qwen3.5:2b'),/before confirmation/);
});
