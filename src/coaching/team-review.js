'use strict';
function teamReview(match) {
  const roster=match.roster || {players:[],localId:null};
  const local=roster.players.find(p=>p.id===roster.localId);
  const players=roster.players.slice(0,32).map(p=>({...p,role:p.id===roster.localId?'you':local?.team===0 || local?.team===1 ? p.team===local.team?'teammate':p.team===0 || p.team===1?'opponent':'unknown':'unknown'}));
  const events=match.teamEvents || [],pairMap=new Map(),touchMap=new Map();
  const goals=events.filter(e=>e.type==='goal');
  for(const g of goals){
    const a=g.assister,b=g.actor;
    if(!a || !b || a.id===b.id || ![0,1].includes(a.team) || a.team!==b.team)continue;
    const key=a.id+'>'+b.id;
    const p=pairMap.get(key)||{assister:a,scorer:b,goals:0,timestamps:[]};p.goals++;p.timestamps.push(g.seconds);pairMap.set(key,p);
  }
  let previous=null;
  for(const e of events){
    if(['round_start','goal'].includes(e.type)){previous=null;continue;}
    if(e.type!=='touch')continue;
    if(e.actors?.length!==1){previous=null;continue;}
    const actor=e.actors[0];
    if(previous && e.seconds>=previous.seconds && e.seconds-previous.seconds<=8 && actor.id!==previous.actor.id && [0,1].includes(actor.team) && actor.team===previous.actor.team){
      const key=previous.actor.id+'>'+actor.id;const p=touchMap.get(key)||{from:previous.actor,to:actor,sequences:0,timestamps:[]};p.sequences++;p.timestamps.push(e.seconds);touchMap.set(key,p);
    }
    previous={actor,seconds:e.seconds};
  }
  const teams=[0,1].map(team=>{
    const members=players.filter(p=>p.team===team),stats={};
    for(const key of ['goals','shots','assists','saves','touches','demos']){
      const known=members.filter(p=>Number.isFinite(p.stats?.[key]));stats[key]={total:known.reduce((n,p)=>n+p.stats[key],0),reportedPlayers:known.length,players:members.length};
    }
    return {team,label:team===0?'Blue':'Orange',stats};
  });
  const windows=goals.slice(-6).map(goal=>{
    const index=events.indexOf(goal);
    return {goal,preceding:events.slice(0,index).filter(e=>e.seconds>=goal.seconds-10 && ['shot','save','epic_save','demolition','touch'].includes(e.type)).slice(-4),interpretation:'Temporal proximity only; does not establish causation or an intentional pass.'};
  });
  return {available:players.length>0,localPlayerId:roster.localId,players,teams,
    confirmedAssistPairs:[...pairMap.values()].slice(0,20),sameTeamTouchSequences:[...touchMap.values()].sort((a,b)=>b.sequences-a.sequences).slice(0,12).map(p=>({...p,timestamps:p.timestamps.slice(-8)})),
    goalWindows:windows,otherHighlights:events.filter(e=>['demolition','save','epic_save','assist'].includes(e.type)).slice(-16),
    coverage:{recordedEvents:events.length,droppedEvents:match.teamEventsDropped || 0,unresolvedPlayers:roster.unresolvedPlayers || 0,goalsWithExplicitAssister:goals.filter(g=>g.assister).length},
    limits:'Scoreboard stats and visible event telemetry only. Missing stats are unknown. Touch chains are not confirmed passes or possession. Assist pairs are recorded goal contributions, not proof of stable chemistry. Team totals cover the observed roster; joins/leaves may limit comparisons. No car positions, rotations, boost paths, off-ball coverage or causation can be proven from this feed. Do not rank teammates by score or blame them for goals. Player IDs are match-scoped; never infer recurring teammates from matching names.'};
}
function teamText(match) {
  const t=teamReview(match);if(!t.available)return 'TEAM CONTEXT\nNo all-player data was recorded for this match. Older matches cannot be backfilled.';
  const rows=t.players.map(p=>`${p.name} (${p.role}, ${p.team===0?'Blue':p.team===1?'Orange':'unknown team'}${p.present?'':', left/absent'}): ${p.stats.goals??'?'} G / ${p.stats.shots??'?'} shots / ${p.stats.assists??'?'} A / ${p.stats.saves??'?'} saves / ${p.stats.demos??'?'} demos`);
  const pairs=t.confirmedAssistPairs.map(p=>`${p.assister.name} → ${p.scorer.name}: ${p.goals} assisted goal(s), at ${p.timestamps.map(s=>s+'s').join(', ')}`);
  const touches=t.sameTeamTouchSequences.map(p=>`${p.from.name} → ${p.to.name}: ${p.sequences} consecutive same-team touch sequence(s), not confirmed passes.`);
  return `TEAM CONTEXT\n${rows.join('\n')}\n\nCONFIRMED GOAL COMBINATIONS\n${pairs.join('\n') || 'No explicit scorer–assister pairs recorded.'}\n\nSHARED TOUCH SEQUENCES\n${touches.join('\n') || 'No linked same-team touch sequences recorded.'}\n\n${t.coverage.recordedEvents} team events captured; ${t.coverage.droppedEvents} older events dropped. ${t.limits}`;
}
module.exports={teamReview,teamText};
