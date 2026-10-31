'use strict';
const METRICS = ['score','goals','shots','assists','saves','touches','cartouches','demos'];
const finite = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const key = name => String(name || '').trim().toLocaleLowerCase();
function self(m) { return m.roster?.players?.find(p=>p.id===m.roster.localId); }
function metric(rows, name) {
  const values=rows.map(r=>r.stats[name]).filter(finite);
  return {total:values.length?values.reduce((a,b)=>a+b,0):null,average:values.length?values.reduce((a,b)=>a+b,0)/values.length:null,best:values.length?Math.max(...values):null,matches:values.length};
}
function buildProfile(records, options={}, now=Date.now()) {
  const completed=records.filter(m=>m.endedAt && ['win','loss','match_end'].includes(m.result));
  const known=completed.filter(m=>self(m)?.name);
  const players=[...new Map(known.map(m=>[key(self(m).name),self(m).name])).values()].sort((a,b)=>a.localeCompare(b));
  const player=players.find(n=>key(n)===key(options.player)) || (options.player ? String(options.player).slice(0,80) : players[0] || '');
  const days=[7,30,90].includes(Number(options.days))?Number(options.days):0;
  const playlist=Number.isInteger(options.playlist)&&options.playlist>=0?options.playlist:null;
  const own=known.filter(m=>key(self(m).name)===key(player));
  const playlists=[...new Set(own.map(m=>m.context?.playlistId).filter(Number.isInteger))].sort((a,b)=>a-b);
  const matches=own.filter(m=>(!days||m.startedAt>=now-days*864e5)&&(playlist===null||m.context?.playlistId===playlist)).sort((a,b)=>a.startedAt-b.startedAt);
  const rows=matches.map(m=>{
    const p=self(m),stats=Object.fromEntries(METRICS.map(k=>[k,finite(p.stats?.[k])?p.stats[k]:null]));
    const teamGoals=[0,1].includes(p.team)?m.stats?.[p.team===0?'blueScore':'orangeScore']:null;
    return {id:m.id,at:m.startedAt,result:m.result,stats,playlistId:m.context?.playlistId??null,arena:m.context?.arena??null,partial:m.context?.partialCapture??null,frames:m.frames?.length||0,timeline:m.scoreboardTimeline?.length||0,reviewed:Boolean(m.review),teamGoals:finite(teamGoals)?teamGoals:null};
  });
  const metrics=Object.fromEntries(METRICS.map(k=>[k,metric(rows,k)]));
  const decisions=rows.filter(r=>['win','loss'].includes(r.result)),wins=decisions.filter(r=>r.result==='win').length;
  const shooting=rows.filter(r=>finite(r.stats.goals)&&finite(r.stats.shots));
  const shotTotal=shooting.reduce((n,r)=>n+r.stats.shots,0);
  const involvement=rows.filter(r=>finite(r.teamGoals)&&finite(r.stats.goals)&&finite(r.stats.assists)&&r.stats.goals+r.stats.assists<=r.teamGoals);
  const teamTotal=involvement.reduce((n,r)=>n+r.teamGoals,0);
  const mates=new Map();
  matches.forEach(m=>{
    const p=self(m);if(![0,1].includes(p.team))return;
    const teammates=m.roster.players.filter(t=>t.id!==p.id&&t.team===p.team);
    for(const t of teammates){
      if(teammates.filter(x=>key(x.name)===key(t.name)).length!==1)continue;
      const k=key(t.name),r=mates.get(k)||{name:t.name,matches:0,wins:0,decisions:0,assistedYou:0,youAssisted:0};
      r.matches++;if(['win','loss'].includes(m.result))r.decisions++;if(m.result==='win')r.wins++;
      for(const e of m.teamEvents||[])if(e.type==='goal'&&e.evidence==='GoalScored'){
        if(e.actor?.id===p.id&&e.assister?.id===t.id)r.assistedYou++;
        if(e.actor?.id===t.id&&e.assister?.id===p.id)r.youAssisted++;
      }
      mates.set(k,r);
    }
  });
  let streak=0;const last=rows.at(-1)?.result;
  if(['win','loss'].includes(last))for(const row of [...rows].reverse()){if(row.result!==last)break;streak++;}
  const recent=rows.slice(-5),previous=rows.slice(-10,-5);
  const trends=Object.fromEntries(METRICS.map(k=>[k,{recent:metric(recent,k),previous:metric(previous,k)}]));
  return {player,players,playlists,filters:{days,playlist},matches:rows.length,wins,losses:decisions.length-wins,unknownResults:rows.length-decisions.length,winRate:decisions.length?wins/decisions.length*100:null,streak:{result:last||null,count:streak},metrics,trends,
    shooting:{percent:shotTotal?shooting.reduce((n,r)=>n+r.stats.goals,0)/shotTotal*100:null,matches:shooting.length},
    involvement:{percent:teamTotal?involvement.reduce((n,r)=>n+r.stats.goals+r.stats.assists,0)/teamTotal*100:null,matches:involvement.length},
    teammates:[...mates.values()].sort((a,b)=>b.matches-a.matches).slice(0,20),recent:rows.slice(-100).reverse(),
    coverage:{unidentified:completed.length-known.length,partial:rows.filter(r=>r.partial===true).length,unknownStart:rows.filter(r=>r.partial===null).length,frames:rows.reduce((n,r)=>n+r.frames,0),timelineMatches:rows.filter(r=>r.timeline>0).length,droppedEvents:matches.reduce((n,m)=>n+(m.teamEventsDropped||0),0)},
    source:'Local retained match history / confirmed Stats API scoreboards',generatedAt:now};
}
module.exports={buildProfile,METRICS};
