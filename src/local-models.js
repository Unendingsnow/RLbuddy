'use strict';
const os=require('node:os');
const {execFile}=require('node:child_process');
class LocalModels {
  constructor({onStatus=()=>{},fetch:fetchImpl=globalThis.fetch}={}) {this.fetch=fetchImpl;this.onStatus=onStatus;this.controller=null;this.status={phase:'idle'};}
  update(value){this.status=value;this.onStatus(value);}
  cancel(){this.controller?.abort();}
  async pull(model) {
    if(this.controller)throw new Error('A model download is already running.');
    if(!['qwen3.5:4b','qwen3-vl:4b','qwen3.5:2b'].includes(model))throw new Error('Unsupported model.');
    const controller=new AbortController();this.controller=controller;
    const timeout=setTimeout(()=>controller.abort(),1800000);
    try {
      this.update({phase:'downloading',model,text:'Connecting to Ollama...'});
      const response=await this.fetch('http://127.0.0.1:11434/api/pull',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,stream:true}),signal:controller.signal});
      if(!response.ok || !response.body)throw new Error('Ollama model download failed.');
      let pending='',last=0,success=false;const decoder=new TextDecoder();
      const consume=line=>{if(!line.trim())return;const row=JSON.parse(line);if(row.error)throw new Error('Ollama could not download this model. Check free disk space and connection.');if(row.status==='success')success=true;if(Date.now()-last>200 || success){last=Date.now();this.update({phase:'downloading',model,text:String(row.status||'Downloading').slice(0,120),completed:Number(row.completed)||0,total:Number(row.total)||0});}};
      for await(const bytes of response.body){pending+=decoder.decode(bytes,{stream:true});let i;while((i=pending.indexOf('\n'))>=0){consume(pending.slice(0,i));pending=pending.slice(i+1);}if(pending.length>65536)throw Error('Unexpected model download response.');}
      pending+=decoder.decode();consume(pending);if(!success)throw Error('Download ended before confirmation. Retry to resume.');
      this.update({phase:'ready',model,text:'Model downloaded. Select it with Use local AI.'});return {ok:true};
    }catch(error){const message=controller.signal.aborted?'Download cancelled. Ollama can resume it later.':error.message;this.update({phase:'error',text:message});throw Error(message);}
    finally{clearTimeout(timeout);this.controller=null;}
  }
}
async function hardware() {
  const gpu=await new Promise(resolve=>execFile('nvidia-smi',['--query-gpu=name,memory.total','--format=csv,noheader,nounits'],{windowsHide:true,timeout:3000},(error,out)=>{
    if(error)return resolve(null);const parts=out.trim().split('\n')[0].split(',');resolve({name:parts[0].trim().slice(0,100),vramMiB:Number(parts[1])||null});
  }));
  const ramGiB=Math.round(os.totalmem()/1024**3),model=ramGiB>=16 && gpu?.vramMiB>=6000?'qwen3.5:4b':'qwen3.5:2b';
  return {ok:true,ramGiB,cpuThreads:os.availableParallelism(),gpu,suggestedModel:model,note:'Starting suggestion only. Run a benchmark and compare game FPS. Unknown GPU memory does not mean no GPU is installed.'};
}
module.exports={LocalModels,hardware};
