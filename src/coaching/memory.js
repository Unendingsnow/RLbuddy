'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const {DiskStore}=require('./disk-store');
class MatchMemory {
  constructor(dir, now = Date.now, options = {}) {
    this.dir = path.join(dir, 'matches'); fs.mkdirSync(this.dir, { recursive: true }); this.now = now; this.current = null; this.index = new Map();
    this.disk=new DiskStore(this.dir,options);
    for (const name of fs.readdirSync(this.dir).filter(n => /^[a-f0-9-]{36}\.json$/.test(n))) {
      try { const m = JSON.parse(fs.readFileSync(path.join(this.dir,name),'utf8'));this.file(m.id);this.index.set(m.id, this.metadata(m)); } catch {}
    }
    // Recover interrupted matches without fabricating a result.
    for (const s of this.list()) if (!s.endedAt) { const m = this.get(s.id); m.endedAt = this.now(); m.result = 'interrupted'; this.write(m); }
  }
  file(id) { if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid match identifier.'); return path.join(this.dir, id + '.json'); }
  metadata(m) { return { id:m.id, startedAt:m.startedAt, endedAt:m.endedAt, result:m.result, stats:m.stats, events:m.events.length, frames:m.frames.length, players:m.roster?.players?.length || 0,teamEvents:m.teamEvents?.length || 0,reviewed:Boolean(m.review) }; }
  write(m) { this.file(m.id);this.disk.save(m);this.index.set(m.id,this.metadata(m)); }
  get(id) {this.file(id);return this.disk.read(id);}
  records() { return this.list().filter(m=>m.endedAt).flatMap(m=>{try{return [this.disk.record(m.id)];}catch{return [];}}); }
  flush() {return this.disk.flush();}
  list() {
    return [...this.index.values()].sort((a,b) => b.startedAt - a.startedAt);
  }
  event(e, enabled) {
    if (!enabled || e.source !== 'stats') return;
    if (e.type === 'match_start') { this.finish('interrupted'); this.lastFinished=null; this.current = { id: randomUUID(), schemaVersion:2, startedAt: this.now(), endedAt: null, result: 'recording', events: [], frames: [], stats: {}, roster:{players:[],localId:null}, teamEvents:[],teamEventsDropped:0 }; }
    if (!this.current) return;
    const { type, clock, overtime, blueScore, orangeScore } = e;
    this.current.events.push({ type, clock, overtime, blueScore, orangeScore, seconds: Math.round((this.now() - this.current.startedAt) / 1000) });
    this.current.events = this.current.events.slice(-600);
    if (['win','loss','match_end'].includes(e.type)) this.finish(e.type); else this.write(this.current);
  }
  snapshot(s) {
    const { goals, shots, saves, assists, score, touches, cartouches, demos, blueScore, orangeScore } = s;
    if(!this.current){
      if(!s.connected || !s.matchEnded || !this.lastFinished || !this.index.has(this.lastFinished.id))return;
      const stats={goals,shots,saves,assists,score,touches,cartouches,demos,blueScore,orangeScore};
      const signature=JSON.stringify({stats,roster:s.roster,context:[s.playlistId,s.arena]});
      if(signature===this.lastFinished.signature)return;
      const m=this.get(this.lastFinished.id);m.stats=stats;if(s.roster)m.roster=structuredClone(s.roster);
      this.detail(m,s,true);
      // Preserve an existing report but flag that its evidence has since changed.
      if(m.review)m.review.evidenceUpdated=true;
      this.write(m);this.lastFinished.signature=signature;return;
    }
    this.current.stats = { goals, shots, saves, assists, score, touches, cartouches, demos, blueScore, orangeScore };
    if(s.roster)this.current.roster=structuredClone(s.roster);
    this.detail(this.current,s);
  }
  detail(m,s,final=false) {
    m.context={...(m.context||{}),playlistId:s.playlistId??m.context?.playlistId??null,arena:s.arena??m.context?.arena??null,partialCapture:s.partialCapture??m.context?.partialCapture??null};
    if(s.roster?.replay || !s.roster?.players?.length)return;
    m.scoreboardTimeline ||= [];
    const previous=m.scoreboardTimeline.at(-1),at=this.now();
    if(!final && previous && at-previous.at<5000)return;
    const row={at,seconds:Math.max(0,Math.round((at-m.startedAt)/1000)),clock:s.clock,overtime:Boolean(s.overtime),blueScore:s.blueScore,orangeScore:s.orangeScore,localId:s.roster.localId,players:s.roster.players.map(p=>({id:p.id,stats:{...p.stats}}))};
    if(final && previous && at-previous.at<5000)m.scoreboardTimeline[m.scoreboardTimeline.length-1]=row;
    else m.scoreboardTimeline.push(row);
    if(m.scoreboardTimeline.length>180)m.scoreboardTimeline.splice(0,m.scoreboardTimeline.length-180);
  }
  teamEvent(e) {
    if(!this.current || e.source!=='stats')return;
    if(e.roster)this.current.roster=structuredClone(e.roster);
    const {type,clock,overtime,actor,actors,target,assister,lastTouch,evidence}=e;
    this.current.teamEvents.push({type,clock,overtime,actor,actors,target,assister,lastTouch,evidence,seconds:Math.max(0,Math.round((e.at-this.current.startedAt)/1000))});
    if(this.current.teamEvents.length>1200){this.current.teamEvents.shift();this.current.teamEventsDropped++;}
    // Flush event bursts at most once per second; match end always flushes final facts.
    if(!this.lastTeamWrite || this.now()-this.lastTeamWrite>=1000){this.write(this.current);this.lastTeamWrite=this.now();}
  }
  frame(frame) {
    const m = this.current;
    if (!m || m.frames.length >= 90 || frame.capturedAt - (m.frames.at(-1)?.at || 0) < 10000) return;
    if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(frame.dataUrl) || frame.dataUrl.length > 900000) return;
    if (m.frames.reduce((n,f) => n + f.dataUrl.length, 0) + frame.dataUrl.length > 12e6) return;
    m.frames.push({ at: frame.capturedAt, seconds: Math.round((frame.capturedAt - m.startedAt) / 1000), dataUrl: frame.dataUrl }); this.write(m);
  }
  finish(result = 'interrupted') { if (!this.current) return; this.current.endedAt = this.now(); this.current.result = result; this.write(this.current); this.lastFinished=['win','loss','match_end'].includes(result)?{id:this.current.id,signature:JSON.stringify({stats:this.current.stats,roster:this.current.roster})}:null;this.current = null; }
  review(id, text) { const m = this.get(id); m.review = { text, at: this.now() }; this.write(m); }
  delete(id) {this.file(id);if (this.current?.id === id) throw new Error('Stop saving before deleting the active match.');this.disk.delete(id);this.index.delete(id);}
  prune(days = 30) {
    const rows = this.list(); let bytes = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];try{const record=this.disk.cache.get(row.id)||JSON.parse(fs.readFileSync(this.file(row.id),'utf8'));bytes+=JSON.stringify(record).length+(record.frames||[]).reduce((n,f)=>n+(f.bytes||0),0);}catch{continue;}
      if (row.id !== this.current?.id && (i >= 100 || bytes > 500e6 || row.startedAt < this.now() - days * 864e5)) this.delete(row.id);
    }
  }
  progress() {
    const rows = this.list().filter(x => ['win','loss'].includes(x.result));
    return { matches: rows.length, wins: rows.filter(x => x.result === 'win').length, goals: rows.reduce((n,x) => n + (x.stats?.goals || 0),0), shots: rows.reduce((n,x) => n + (x.stats?.shots || 0),0), saves: rows.reduce((n,x) => n + (x.stats?.saves || 0),0) };
  }
}
module.exports = { MatchMemory };
