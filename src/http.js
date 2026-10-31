'use strict';
async function readJson(response,limit=2*1024*1024) {
  if(Number(response.headers?.get?.('content-length')||0)>limit)throw new Error('Provider reply exceeded the size limit.');
  if(!response.body?.getReader)return response.json();
  const reader=response.body.getReader();let bytes=0;const chunks=[];
  try {
    while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>limit){await reader.cancel();throw new Error('Provider reply exceeded the size limit.');}chunks.push(Buffer.from(value));}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {reader.releaseLock();}
}
module.exports={readJson};
