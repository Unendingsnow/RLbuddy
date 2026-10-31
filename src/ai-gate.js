'use strict';
const {RATES}=require('./usage');
class AiGate {
  constructor({getSettings,ledger,now=Date.now,onChange=()=>{}}) { Object.assign(this,{getSettings,ledger,now,onChange});this.times=[];this.active=null;this.blockedUntil=0;this.failures=0; }
  status() { return {busy:Boolean(this.active),kind:this.active?.kind || null,reason:this.reason || null,backoffSeconds:Math.max(0,Math.ceil((this.blockedUntil-this.now())/1000))}; }
  acquire({provider,model,kind='reaction'}) {
    const now=this.now(),s=this.getSettings(),limits=s.budget || {};
    const deny=message=>{this.reason=message;this.onChange();throw new Error(message);};
    if(provider!=='ollama' && this.ledger.error)deny(this.ledger.error);
    if(s.paused)deny('AI is paused.');
    if(this.active)deny('Another AI task is running.');
    if(now<this.blockedUntil)deny('AI is cooling down after connection failures.');
    this.times=this.times.filter(t=>now-t<60000);
    if(this.times.length>=12 || (this.times.length && now-this.times.at(-1)<2000))deny('AI request limit reached. Try again shortly.');
    if(provider!=='ollama' && limits.enabled!==false) {
      if(!provider.startsWith('openai') || !RATES[model])deny('This model has no known price. Disable the budget guard explicitly to use it.');
      const totals=this.ledger.summary();
      for(const [key,limit] of [['session',limits.sessionUsd??1],['today',limits.dailyUsd??3]]) {
        const total=totals[key];
        if(total.usd+total.unpriced*.10+.10>limit)deny('Estimated AI budget reached. Local banter is still available.');
      }
    }
    this.reason=null;const ticket={provider,model,kind,accounted:false,failed:false};this.active=ticket;this.times.push(now);this.onChange();
    return {
      account:row=>{ticket.accounted=true;ticket.failed=row.status==='usage unavailable';},
      release:({cancelled=false}={})=>{
        if(!ticket.accounted)ticket.failed=true;
        if(ticket.failed && !cancelled){this.failures++;this.blockedUntil=this.now()+Math.min(60000,2000*2**Math.min(this.failures,5));}
        else {this.failures=0;this.blockedUntil=0;}
        if(this.active===ticket)this.active=null;this.onChange();
      },
    };
  }
}
module.exports={AiGate};
