'use strict';
const PRIORITY = { win:100,loss:100,match_end:95,goal:80,conceded:80,team_goal:80,overtime:75,epic_save:70,save:60,assist:60,demo:40,demolished:40,shot:20,match_start:10 };
const priority = event => PRIORITY[event?.type] || 0;
class LiveBanter {
  constructor({ getEngine, getSettings, getSnapshot, canSpeak, publish, now = Date.now, onObservation = () => {}, schedule = setTimeout, unschedule = clearTimeout }) {
    Object.assign(this,{getEngine,getSettings,getSnapshot,canSpeak,publish,now,onObservation,schedule,unschedule});
    this.generation=0; this.reset();
  }
  reset() { this.generation++; this.unschedule(this.timer); this.timer=null; this.busy=false; this.frame=null; this.recentEvent=null; this.pending=null; this.activeEvent=null; this.obsolete=false;this.nextVisionAt=0; }
  ready() { return !this.busy && !this.getEngine().active && this.canSpeak(); }
  wake() {
    if(this.timer || !this.pending)return;
    this.timer=this.schedule(()=>{this.timer=null;this.flush().catch(()=>{});},500);this.timer?.unref?.();
  }
  async event(event) {
    this.getEngine().recordEvent?.(event);
    this.recentEvent={...event,receivedAt:this.now()};
    if(this.busy && priority(event)<priority(this.activeEvent))return;
    if(this.busy && priority(event)>=priority(this.activeEvent)) { this.obsolete=true; this.getEngine().cancel?.(); }
    if(!this.pending || priority(event)>=priority(this.pending.event))this.pending={event,at:this.now()};
    return this.flush();
  }
  async flush() {
    if(!this.pending)return;
    const ttl=priority(this.pending.event)>=60?22000:5000;
    if(this.now()-this.pending.at>ttl){this.pending=null;return;}
    if(!this.ready()){this.wake();return;}
    const {event}=this.pending;this.pending=null;
    const s=this.getSettings();
    const frame=s.ai.enabled && s.vision.enabled && this.frame && this.now()-this.frame.capturedAt<2000?this.frame:null;
    return this.run(event,frame,!s.ai.dynamicReactions);
  }
  async observe(frame) {
    this.frame=frame;
    if(this.pending)return this.flush();
    const s=this.getSettings();
    if(!s.ai.enabled || !s.vision.enabled || this.now()-frame.capturedAt>2000 || this.now()<this.nextVisionAt || !this.ready())return;
    const snap=this.getSnapshot();
    const context=snap.connected && snap.matchActive?{...snap,player:snap.playerName}:{};
    return this.run(context,frame,false);
  }
  async run(context,frame,localOnly) {
    const engine=this.getEngine(),generation=this.generation,started=this.now();
    this.busy=true;this.activeEvent=context;this.obsolete=false;
    try {
      let reaction=frame?await engine.observe({dataUrl:frame.dataUrl,context},{force:Boolean(context.type)}):await engine.react(context,{localOnly,force:priority(context)>=60});
      const current=()=>generation===this.generation && engine===this.getEngine() && !this.obsolete;
      if(frame && !reaction && context.type && current() && (engine.observationError || ['skipped','rejected'].includes(engine.observationOutcome)))reaction=await engine.react(context,{localOnly:true,force:true});
      if(!current())return;
      if(frame){const latencyMs=this.now()-started;const effectiveIntervalMs=Math.min(30000,Math.max((this.getSettings().vision.intervalSeconds||3)*1000,latencyMs*1.5));this.nextVisionAt=this.now()+effectiveIntervalMs;this.onObservation({capturedAt:frame.capturedAt,latencyMs,effectiveIntervalMs});}
      if(this.now()-started<=16000 && this.canSpeak())this.publish(reaction);
    } finally {
      if(generation===this.generation){this.busy=false;this.activeEvent=null;this.wake();}
    }
  }
}
module.exports={LiveBanter,priority};
