'use strict';
const clean = x => typeof x === 'string' ? x.replace(/[\u0000-\u001f]/g,' ').trim().slice(0,80) : '';
const team = x => x !== null && x !== undefined && x !== '' && [0,1].includes(Number(x)) ? Number(x) : null;
const stat = x => typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null;
/** Scoreboard-visible facts only. Platform identifiers are transient lookup keys. */
class TeamContext {
  constructor({now=Date.now,isLocal=()=>false,onEvent=()=>{}}={}) {Object.assign(this,{now,isLocal,onEvent});this.players=new Map();this.keys=new Map();this.owners=new Map();this.slots=new Map();this.sequence=0;this.recent=new Map();this.replay=false;this.localId=null;this.unresolved=0;}
  player(p, create=true) {
    if(!p || !clean(p.Name))return null;
    const name=clean(p.Name), t=team(p.TeamNum), primary=clean(p.PrimaryId);
    const shortcut=Number.isInteger(p.Shortcut) && p.Shortcut>0 ? `${p.Shortcut}:${name}` : null;
    let id=primary && this.keys.get('id:'+primary);
    if(!id && shortcut){const candidate=this.keys.get('slot:'+shortcut);if(candidate && (!primary || !this.owners.get(candidate) || this.owners.get(candidate)===primary))id=candidate;}
    if(!id){const candidates=[...this.players.values()].filter(x=>x.name===name && x.team===t && (!primary || !this.owners.get(x.id) || this.owners.get(x.id)===primary) && (!shortcut || !this.slots.get(x.id) || this.slots.get(x.id)===shortcut));if(candidates.length===1)id=candidates[0].id;else if(candidates.length>1)return null;}
    if(!id && !create)return null;
    if(!id){if(this.players.size>=32)return null;id=`p${++this.sequence}`;this.players.set(id,{id,name,team:t,present:true,stats:{}});}
    const row=this.players.get(id);row.name=name;if(t!==null)row.team=t;
    if(primary){this.keys.set('id:'+primary,id);this.owners.set(id,primary);}if(shortcut){this.keys.set('slot:'+shortcut,id);this.slots.set(id,shortcut);}
    return {id:row.id,name:row.name,team:row.team};
  }
  update(rows, game={}) {
    this.replay=game.bReplay===true;
    if(this.replay)return;
    if(!Array.isArray(rows))return;
    for(const row of this.players.values())row.present=false;
    this.localId=null;this.unresolved=0;
    const locals=rows.filter(x=>this.isLocal(x));
    const duplicates=new Map();for(const p of rows){const k=clean(p.Name)+':'+team(p.TeamNum);duplicates.set(k,(duplicates.get(k)||0)+1);}
    for(const p of rows.slice(0,32)) {
      if(duplicates.get(clean(p.Name)+':'+team(p.TeamNum))>1 && !clean(p.PrimaryId) && !(Number.isInteger(p.Shortcut)&&p.Shortcut>0)){this.unresolved++;continue;}
      const ref=this.player(p);if(!ref){this.unresolved++;continue;}const row=this.players.get(ref.id);row.present=true;
      for(const key of ['Score','Goals','Shots','Saves','Assists','Touches','CarTouches','Demos']){const value=stat(p[key]);if(value!==null)row.stats[key.toLowerCase()]=value;}
      if(locals.length===1 && p===locals[0])this.localId=ref.id;
    }
  }
  emit(type, data, context, key, windowMs=900) {
    const now=this.now();for(const [k,t] of this.recent)if(now-t>15000)this.recent.delete(k);
    if(key && this.recent.has(key) && now-this.recent.get(key)<windowMs)return;
    if(key)this.recent.set(key,now);
    this.onEvent({type,source:'stats',at:now,clock:context.clock,overtime:context.overtime,...data});
  }
  handle(event,data,context) {
    if(event==='GoalReplayStart'){this.replay=true;return;}
    if(['GoalReplayEnd','RoundStarted'].includes(event)){this.replay=false;if(event==='RoundStarted')this.emit('round_start',{},context);return;}
    if(this.replay || data.bReplay===true)return;
    if(event==='GoalScored') {
      const scorer=this.player(data.Scorer),assister=this.player(data.Assister),lastTouch=this.player(data.BallLastTouch?.Player);
      if(!scorer)return;
      this.emit('goal',{actor:scorer,assister,lastTouch,evidence:'GoalScored'},context,`goal:${scorer.id}:${context.clock}`,2500);return;
    }
    if(event==='BallHit') {
      const actors=(Array.isArray(data.Players)?data.Players:[]).slice(0,8).map(p=>this.player(p)).filter(Boolean);
      if(actors.length)this.emit('touch',{actors},context,`touch:${actors.map(p=>p.id).sort().join(',')}:${context.clock}`,120);return;
    }
    if(event==='StatfeedEvent') {
      const value=String(data.EventName || data.Type || '').replace(/[^a-z]/gi,'').toLowerCase();
      const type=/demolish|demolition/.test(value)?'demolition':value==='epicsave'?'epic_save':value==='save'?'save':value==='assist'?'assist':/^(shot|shotongoal)$/.test(value)?'shot':null;
      if(!type)return;const actor=this.player(data.MainTarget),target=this.player(data.SecondaryTarget);if(!actor)return;
      this.emit(type,{actor,target,evidence:'StatfeedEvent'},context,`${type}:${actor.id}:${target?.id}:${context.clock}`);
    }
  }
  snapshot() {return {players:[...this.players.values()].map(x=>({...x,stats:{...x.stats}})),localId:this.localId,unresolvedPlayers:this.unresolved,replay:this.replay};}
}
module.exports={TeamContext};
