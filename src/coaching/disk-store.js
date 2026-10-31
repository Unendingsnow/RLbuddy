'use strict';
const fs=require('node:fs'),path=require('node:path');
// All production writes use asynchronous I/O. Metadata is small; image bytes
// are separate and written only once. A queue serializes writes and deletion.
class DiskStore {
  constructor(dir,{background=false,onError=()=>{}}={}) {Object.assign(this,{dir,background,onError});this.queue=Promise.resolve();this.pending=new Map();this.blobs=new Map();this.cache=new Map();this.error=null;this.scheduled=false;}
  fail(error) {this.error=`Saving is unavailable (${['ENOSPC','EACCES','EPERM'].includes(error.code)?error.code:'disk error'}). Your buddy still works. Free space or check folder permissions, then restart.`;this.onError(this.error);}
  prepare(m) {
    const frames=m.frames.map((f,i)=>{
      if(!f.dataUrl)return {...f};
      const previous=this.cache.get(m.id)?.frames?.[i];
      if(previous?.file && previous.at===f.at)return {...previous};
      const file=`${m.id}-${i}.jpg`;const bytes=Buffer.from(f.dataUrl.split(',')[1]||'','base64');
      if(!this.blobs.has(file) && !fs.existsSync(path.join(this.dir,file)))this.blobs.set(file,bytes);
      return {at:f.at,seconds:f.seconds,file,bytes:bytes.length};
    });
    return structuredClone({...m,schemaVersion:3,frames});
  }
  save(m) {
    try {
      const record=this.prepare(m);this.cache.set(m.id,record);this.pending.set(m.id,record);
      if(this.background)this.schedule();else this.sync();
    } catch(error){this.fail(error);}
  }
  record(id) { return structuredClone(this.cache.get(id)||JSON.parse(fs.readFileSync(path.join(this.dir,id+'.json'),'utf8'))); }
  read(id) {
    const record=this.record(id);
    record.frames=(record.frames||[]).flatMap(f=>{
      if(f.dataUrl)return [f];
      if(!new RegExp(`^${id}-\\d{1,3}\\.jpg$`).test(f.file||''))return [];
      try {return [{at:f.at,seconds:f.seconds,dataUrl:'data:image/jpeg;base64,'+(this.blobs.get(f.file)||fs.readFileSync(path.join(this.dir,f.file))).toString('base64')}];}catch{return [];}
    });return record;
  }
  delete(id) {this.cache.delete(id);this.pending.set(id,null);if(this.background)this.schedule();else this.sync();}
  schedule() {if(this.scheduled)return;this.scheduled=true;queueMicrotask(()=>{this.scheduled=false;this.flush();});}
  sync() {
    for(const [id,record] of this.pending){this.pending.delete(id);try {
      const file=path.join(this.dir,id+'.json');
      if(!record){for(const n of fs.readdirSync(this.dir))if(n===id+'.json'||n===id+'.json.tmp'||new RegExp(`^${id}-\\d{1,3}\\.jpg$`).test(n)){fs.unlinkSync(path.join(this.dir,n));this.blobs.delete(n);}continue;}
      for(const f of record.frames){const bytes=this.blobs.get(f.file);if(bytes){fs.writeFileSync(path.join(this.dir,f.file),bytes);this.blobs.delete(f.file);}}
      fs.writeFileSync(file+'.tmp',JSON.stringify(record));fs.renameSync(file+'.tmp',file);
    }catch(e){this.fail(e);}}
  }
  flush() {
    const jobs=[...this.pending];this.pending.clear();
    this.queue=this.queue.then(async()=>{
      for(const [id,record] of jobs)try {
        const file=path.join(this.dir,id+'.json');
        if(!record){for(const n of await fs.promises.readdir(this.dir))if(n===id+'.json'||n===id+'.json.tmp'||new RegExp(`^${id}-\\d{1,3}\\.jpg$`).test(n)){await fs.promises.unlink(path.join(this.dir,n)).catch(e=>{if(e.code!=='ENOENT')throw e;});this.blobs.delete(n);}continue;}
        for(const f of record.frames){const bytes=this.blobs.get(f.file);if(bytes){await fs.promises.writeFile(path.join(this.dir,f.file),bytes);this.blobs.delete(f.file);}}
        await fs.promises.writeFile(file+'.tmp',JSON.stringify(record));await fs.promises.rename(file+'.tmp',file);
      }catch(e){this.fail(e);}
    });return this.queue;
  }
}
module.exports={DiskStore};
