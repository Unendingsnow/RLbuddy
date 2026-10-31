'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const MAX_INSTALLER = 4 * 1024 ** 3;
function releaseAsset(release) {
  const a = release?.assets?.find(x => x.name === 'OllamaSetup.exe');
  if (!a || !/^https:\/\/github\.com\/ollama\/ollama\/releases\/download\/[^/]+\/OllamaSetup\.exe$/.test(a.browser_download_url) || !/^sha256:[a-f0-9]{64}$/.test(a.digest) || !Number.isSafeInteger(a.size) || a.size < 1 || a.size > MAX_INSTALLER) throw new Error('Official Ollama release metadata could not be verified. Try again later.');
  return a;
}
function executableCandidates(env = process.env) {
  return [env.LOCALAPPDATA && path.join(env.LOCALAPPDATA,'Programs','Ollama','ollama.exe'), ...(env.PATH || '').split(path.delimiter).filter(p => path.isAbsolute(p)).map(p => path.join(p,'ollama.exe'))].filter(Boolean);
}
class LocalRuntime {
  constructor({ dir, onStatus = () => {}, fetch: fetchImpl = globalThis.fetch, run: runImpl = run, spawn: spawnImpl = spawn, candidates = executableCandidates() }) {
    Object.assign(this,{dir,onStatus,fetch:fetchImpl,run:runImpl,spawn:spawnImpl,candidates}); this.controller=null; this.child=null; this.status={phase:'idle',text:'Check local AI setup to get started.'};
  }
  update(phase,text,extra={}) { this.status={phase,text,...extra};this.onStatus(this.status); }
  installed() { return this.candidates.find(p => {try{return fs.statSync(p).isFile();}catch{return false;}}) || null; }
  async running() {try{const r=await this.fetch('http://127.0.0.1:11434/api/version',{signal:AbortSignal.timeout(2000)});if(!r.ok)return false;return typeof (await r.json()).version === 'string';}catch{return false;}}
  async detect() {return {ok:true,running:await this.running(),installed:Boolean(this.installed()),status:this.status};}
  async start() {
    if(await this.running()) {this.update('ready','Ollama is ready. Choose and download a vision model.');return {ok:true};}
    const executable=this.installed();if(!executable)throw new Error('Ollama was not found after installation. Restart RL Buddy or check the installer.');
    this.update('starting','Starting local Ollama…');
    this.child=this.spawn(executable,['serve'],{windowsHide:true,stdio:'ignore',env:{...process.env,OLLAMA_HOST:'127.0.0.1:11434'}});
    const child=this.child; let failure=false; child.on('error',()=>{failure=true;}); child.on('exit',()=>{if(this.child===child)this.child=null;});
    for(let i=0;i<30;i++){if(await this.running()){this.update('ready','Ollama is ready. Choose and download a vision model.');return {ok:true};}if(failure)break;await new Promise(r=>setTimeout(r,500));}
    throw new Error('Ollama did not become ready. Check GPU drivers or start Ollama from the Windows Start menu.');
  }
  async setup() {
    if(this.controller)throw new Error('Ollama setup is already running.');
    const controller=new AbortController();this.controller=controller;let part,installer,handle;
    const timeout=setTimeout(()=>controller.abort(),30*60*1000);
    try {
      if(await this.running() || this.installed())return await this.start();
      this.update('checking','Finding the official Ollama Windows installer…');
      const meta=await this.fetch('https://api.github.com/repos/ollama/ollama/releases/latest',{headers:{Accept:'application/vnd.github+json','User-Agent':'RL-Buddy'},signal:controller.signal});
      if(!meta.ok)throw new Error('Cannot reach the official Ollama release service. Try again later.');
      const asset=releaseAsset(await meta.json());
      fs.mkdirSync(this.dir,{recursive:true});
      const disk=fs.statfsSync(this.dir);if(Number(disk.bavail)*Number(disk.bsize)<asset.size+5*1024**3)throw new Error('Free at least 7 GB on the app data drive for Ollama setup. Models need additional space.');
      part=path.join(this.dir,'OllamaSetup.exe.part');installer=path.join(this.dir,'OllamaSetup.exe');
      const response=await this.fetch(asset.browser_download_url,{signal:controller.signal,redirect:'follow'});
      if(!response.ok || !response.body)throw new Error('Official Ollama download failed.');
      const final=new URL(response.url || asset.browser_download_url);
      if(final.protocol!=='https:' || !['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(final.hostname))throw new Error('Unexpected installer download destination.');
      handle=await fs.promises.open(part,'w');let received=0,last=0;const hash=crypto.createHash('sha256');
      for await(const chunk of response.body){
        if(controller.signal.aborted)throw new Error('cancelled');
        received+=chunk.length;if(received>asset.size)throw new Error('Installer size did not match the release.');hash.update(chunk);await handle.writeFile(chunk);
        if(Date.now()-last>250){last=Date.now();this.update('downloading',`Downloading Ollama: ${Math.round(received/asset.size*100)}% · ${(received/1024**2).toFixed(0)} / ${(asset.size/1024**2).toFixed(0)} MB`,{received,total:asset.size});}
      }
      await handle.close();handle=null;
      if(received!==asset.size || hash.digest('hex')!==asset.digest.slice(7))throw new Error('Ollama download verification failed. The installer was not run.');
      if(controller.signal.aborted)throw new Error('cancelled');
      fs.renameSync(part,installer);
      this.update('installing','Installing Ollama for your Windows account… Do not close RL Buddy.');
      // Fixed official Inno Setup executable and arguments; never run a downloaded script.
      await this.run(installer,['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-'],{windowsHide:true,timeout:15*60*1000});
      return await this.start();
    } catch(error) {
      const message=controller.signal.aborted?'Ollama download cancelled. You can retry setup.':error.message.startsWith('Command failed')?'Ollama installer failed. Check free disk space and retry.':error.message;
      this.update('error',message);throw new Error(message);
    } finally {clearTimeout(timeout);await handle?.close().catch(()=>{});for(const file of [part,installer])if(file)try{fs.unlinkSync(file);}catch{}this.controller=null;}
  }
  cancel() {if(this.status.phase==='installing')throw new Error('Let the installer finish before closing setup.');this.controller?.abort();}
  dispose() {if(this.status.phase!=='installing')this.controller?.abort();this.child?.kill();}
}
module.exports={LocalRuntime,releaseAsset,executableCandidates};
