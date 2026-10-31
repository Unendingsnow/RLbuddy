'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {buildProfile}=require('../src/coaching/profile');
const {GameTracker}=require('../src/game/stats-client');
const {MatchMemory}=require('../src/coaching/memory');
function match(id,stats={},extra={}){return {id,startedAt:1000,endedAt:2000,result:'win',stats:{blueScore:3,orangeScore:1},roster:{localId:'p1',players:[{id:'p1',name:'Driver',team:0,stats},{id:'p2',name:'Mate',team:0,stats:{}},{id:'p3',name:'Other',team:1,stats:{}}]},frames:[],teamEvents:[],...extra};}
test('profile uses reported stat denominators and never turns missing stats into zero',()=>{
  const p=buildProfile([match('a',{goals:2,shots:4,assists:1,saves:0}),match('b',{goals:1},{result:'loss'}),match('c',{}, {result:'interrupted'})]);
  assert.equal(p.matches,2);assert.equal(p.winRate,50);assert.equal(p.metrics.goals.total,3);assert.equal(p.metrics.shots.average,4);assert.equal(p.metrics.shots.matches,1);assert.equal(p.metrics.saves.total,0);assert.equal(p.metrics.touches.total,null);assert.equal(p.shooting.percent,50);assert.equal(p.involvement.percent,100);assert.equal(p.involvement.matches,1);
});
test('profiles separate local driver names, unknown identities, dates and playlists',()=>{
  const other=match('b',{goals:9},{startedAt:20*864e5,context:{playlistId:12}});other.roster.players[0].name='Different';
  const unknown=match('c',{goals:99});unknown.roster.localId=null;
  const rows=[match('a',{goals:2},{startedAt:20*864e5,context:{playlistId:11,partialCapture:true}}),other,unknown,match('old',{goals:50})];
  const p=buildProfile(rows,{player:'driver',days:7,playlist:11},21*864e5);
  assert.equal(p.matches,1);assert.equal(p.metrics.goals.total,2);assert.equal(p.coverage.partial,1);assert.equal(p.coverage.unidentified,1);assert.deepEqual(p.players,['Different','Driver']);
});
test('teammate combinations count only explicit assists and exclude opponents',()=>{
  const m=match('a',{goals:1});m.teamEvents=[{type:'goal',evidence:'GoalScored',actor:{id:'p1'},assister:{id:'p2'}},{type:'goal',evidence:'GoalScored',actor:{id:'p2'},assister:{id:'p1'}},{type:'touch',actors:[{id:'p1'},{id:'p2'}]},{type:'goal',actor:{id:'p1'},assister:{id:'p2'}}];
  const p=buildProfile([m]);assert.equal(p.teammates.length,1);assert.equal(p.teammates[0].assistedYou,1);assert.equal(p.teammates[0].youAssisted,1);
});
test('result unknown does not count as loss or extend a win streak; old records remain honest',()=>{
  const p=buildProfile([match('a',{goals:1}),match('b',{},{startedAt:3000,result:'match_end'}),{id:'legacy',startedAt:1,endedAt:2,result:'win',stats:{goals:50},events:[],frames:[]}]);
  assert.equal(p.matches,2);assert.equal(p.winRate,100);assert.equal(p.losses,0);assert.equal(p.unknownResults,1);assert.equal(p.streak.count,0);assert.equal(p.coverage.unidentified,1);assert.equal(p.coverage.timelineMatches,0);
});
test('new acquisition saves deeper stats, context and bounded timelines without spectator fields',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rlbuddy-profile-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let now=100000;
  const memory=new MatchMemory(dir,()=>now),tracker=new GameTracker({playerName:'Driver',now:()=>now});tracker.setConnected(true);
  tracker.on('event',e=>memory.event(e,true));tracker.on('snapshot',s=>memory.snapshot(s));tracker.on('team-event',e=>memory.teamEvent(e));
  tracker.handleMessage({Event:'MatchCreated',Data:{MatchGuid:'profile'}});
  const send=(score,replay=false)=>tracker.handleMessage({Event:'UpdateState',Data:{MatchGuid:'profile',Game:{TimeSeconds:120,PlaylistId:11,Arena:'Stadium_P',bReplay:replay,Teams:[{TeamNum:0,Score:3},{TeamNum:1,Score:1}]},Players:[{Name:'Driver',TeamNum:0,Score:score,Goals:2,Shots:4,Saves:1,Assists:1,Touches:21,CarTouches:3,Demos:2,Speed:900,Boost:100,PrimaryId:'private-id'}]}});
  send(500);now+=1000;send(501);assert.equal(memory.current.scoreboardTimeline.length,1);now+=5000;send(502);assert.equal(memory.current.scoreboardTimeline.length,2);now+=5000;send(1,true);assert.equal(memory.current.scoreboardTimeline.length,2);
  for(let i=0;i<190;i++){now+=5000;send(503+i);}assert.equal(memory.current.scoreboardTimeline.length,180);
  tracker.handleMessage({Event:'MatchEnded',Data:{WinnerTeamNum:0}});await memory.flush();const id=memory.list()[0].id;
  const record=memory.get(id);assert.equal(record.context.playlistId,11);assert.equal(record.context.partialCapture,false);assert.equal(record.stats.touches,21);assert.equal(record.stats.demos,2);assert.equal(record.roster.players[0].stats.score,692);
  const raw=JSON.stringify(record);assert.equal(raw.includes('private-id'),false);assert.equal(raw.includes('Boost'),false);assert.equal(raw.includes('Speed'),false);
  const reopened=new MatchMemory(dir);assert.equal(buildProfile(reopened.records()).metrics.touches.total,21);
  reopened.delete(id);assert.equal(buildProfile(reopened.records()).matches,0);
});
test('joining through UpdateState marks partial capture and empty final packets retain the driver',()=>{
  const t=new GameTracker({playerName:'Driver'});t.setConnected(true);
  t.handleMessage({Event:'UpdateState',Data:{Game:{TimeSeconds:120,PlaylistId:12},Players:[{Name:'Driver',TeamNum:0,Goals:1}]}});
  assert.equal(t.snapshot().partialCapture,true);assert.equal(t.snapshot().shots,null);assert.equal(t.snapshot().roster.players[0].stats.shots,undefined);
  t.handleMessage({Event:'MatchEnded',Data:{WinnerTeamNum:0}});
  t.handleMessage({Event:'UpdateState',Data:{Players:[],Game:{bHasWinner:true}}});
  assert.equal(t.snapshot().roster.localId,'p1');
});
