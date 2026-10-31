'use strict';
(() => {
  const image = new Image(); image.src = 'assets/jackshaft-sheet.png';
  const characters = [...document.querySelectorAll('.buddy-character')].map(el => {
    const canvas = document.createElement('canvas'); canvas.className='jackshaft-art'; canvas.width=384; canvas.height=512; canvas.setAttribute('aria-label','Jackshaft, animated pumpkin mechanic'); el.append(canvas);
    const smoke = document.createElement('span'); smoke.className='exhaust-puff'; el.append(smoke);
    return {el,canvas,ctx:canvas.getContext('2d'),last:-1};
  });
  let premium=true, talkingUntil=0, reduced=false;
  function state(s) { reduced=s.settings?.reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches; premium=s.settings?.character !== 'classic'; document.documentElement.classList.toggle('jackshaft-mode',premium); }
  window.buddy?.onState(state); window.buddy?.getState().then(state);
  window.buddy?.onReaction(r=>{talkingUntil=Date.now()+Math.min(6500,Math.max(2000,r.text.length*30));});
  setInterval(()=>{
    if (!image.complete || !image.naturalWidth || !premium) return;
    const time=Date.now(), blink=!reduced && time%5100>4880;
    for(const c of characters) {
      const mood=c.el.dataset.mood || 'idle';
      let frame={celebrate:4,shocked:5,sad:6,thinking:7,smug:3}[mood] ?? 0;
      if (['idle','smug'].includes(mood)) frame=!reduced && time<talkingUntil && Math.floor(time/180)%2 ? 2 : blink ? 1 : frame;
      if(frame===c.last) continue; c.last=frame;
      const w=image.naturalWidth/4,h=image.naturalHeight/2;
      c.ctx.clearRect(0,0,384,512); c.ctx.drawImage(image,(frame%4)*w,Math.floor(frame/4)*h,w,h,0,0,384,512);
    }
  },100);
})();
