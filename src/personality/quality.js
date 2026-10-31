'use strict';
// Conservative checks, not a claim of complete factual validation.
function validateReaction(raw,{event='observation',spice=2,history=[]}={}) {
  if(typeof raw!=='string')return {ok:false,reason:'empty'};
  const text=raw.replace(/<think>[\s\S]*?<\/think>/gi,'').replace(/[\u0000-\u001f]/g,' ').replace(/\s+/g,' ').replace(/^["']|["']$/g,'').trim();
  if(!text || /^[.\s…]+$/.test(text) || /^(silence|none|no comment)$/i.test(text))return {ok:false,reason:'silent'};
  if(text.length>180 || text.split(/\s+/).length>32)return {ok:false,reason:'too-long'};
  if(['goal','conceded','team_goal','save','epic_save'].includes(event) && /\b(?:blue|orange)\b/i.test(text))return {ok:false,reason:'team-color-guess'};
  if(/synthetic|\bsynth test\b|test (?:image|dummy|setup)|as an ai|system prompt|api key|https?:\/\//i.test(text))return {ok:false,reason:'out-of-character'};
  if(event!=='chat' && /\b(?:rotate|rotation|back[ -]post|double commit|shadow defend|challenge now|go for boost|cheat up|whiff\w*|missed the ball|you (?:missed|threw)|your fault|you should|you need to)\b/i.test(text))return {ok:false,reason:'unsupported-advice'};
  if(!['win','loss','match_end','chat'].includes(event) && /\b(?:you won|you lost|match is over|victory secured)\b/i.test(text))return {ok:false,reason:'unsupported-result'};
  if(spice<2 && /\b(?:fuck\w*|shit\w*|asshole|bastard|bitch\w*)\b/i.test(text))return {ok:false,reason:'tone'};
  const normalize=s=>s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  if(history.some(line=>normalize(line)===normalize(text)))return {ok:false,reason:'repeated'};
  return {ok:true,text};
}
module.exports={validateReaction};
