'use strict';

const api = window.buddy;
let bubbleTimer;
let moodTimer;

function update(state) {
  const settings = state.settings || {};
  document.documentElement.classList.toggle('reduced-motion',settings.reducedMotion);
  const indicator=document.getElementById('overlay-capture');indicator.hidden=!state.visionStatus?.active && !settings.paused;indicator.textContent=settings.paused?'PAUSED':settings.vision?.enabled?'CAPTURE / '+settings.ai.provider:'CAPTURE / LOCAL MEMORY';
  const personality = state.personalities?.find((pack) => pack.id === settings.personalityId);
  document.body.classList.toggle('unlocked', settings.overlayLocked === false);
  if (personality) {
    document.getElementById('overlay-name').textContent = personality.name.toUpperCase();
    document.getElementById('overlay-scene').style.setProperty('--buddy-color', window.BuddyVisual.color(personality.color));
  }
}

function react(reaction) {
  if (!reaction?.text) return;
  const bubble = document.getElementById('overlay-bubble');
  document.getElementById('overlay-text').textContent = reaction.text;
  document.getElementById('overlay-character').dataset.mood = window.BuddyVisual.mood(reaction);
  bubble.classList.remove('hidden');
  clearTimeout(bubbleTimer);
  clearTimeout(moodTimer);
  const duration = Number.isFinite(reaction.durationMs) && reaction.durationMs > 0
    ? reaction.durationMs
    : Math.max(6500, Math.min(14000, reaction.text.length * 65));
  bubbleTimer = setTimeout(() => bubble.classList.add('hidden'), duration);
  moodTimer = setTimeout(() => { document.getElementById('overlay-character').dataset.mood = 'idle'; }, 5500);
}

if (api) {
  api.onClear?.(() => { document.getElementById('overlay-bubble').classList.add('hidden'); clearTimeout(bubbleTimer); });
  api.onState(update);
  api.onReaction(react);
  api.onPartial?.((partial) => {
    if (!partial?.text || partial.eventType !== 'chat') return;
    document.getElementById('overlay-text').textContent = partial.text;
    document.getElementById('overlay-bubble').classList.remove('hidden');
    document.getElementById('overlay-character').dataset.mood = 'thinking';
    clearTimeout(bubbleTimer);
    clearTimeout(moodTimer);
    bubbleTimer = setTimeout(() => document.getElementById('overlay-bubble').classList.add('hidden'), 14000);
    moodTimer = setTimeout(() => { document.getElementById('overlay-character').dataset.mood = 'idle'; }, 12000);
  });
  api.onMoment?.((event) => {
    document.getElementById('overlay-character').dataset.mood = window.BuddyVisual.mood({ eventType: event.type });
    clearTimeout(moodTimer);
    moodTimer = setTimeout(() => { document.getElementById('overlay-character').dataset.mood = 'idle'; }, 5500);
  });
  api.getState().then((state) => {
    update(state);
    const latest = [...(state.history || [])].sort((a, b) => new Date(b.at) - new Date(a.at))[0];
    if (latest && Date.now() - new Date(latest.at).getTime() < 12000) react(latest);
    else bubbleTimer = setTimeout(() => document.getElementById('overlay-bubble').classList.add('hidden'), 6000);
  }).catch(() => {});
}
