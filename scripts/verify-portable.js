'use strict';
const {execFileSync}=require('node:child_process');
const path=require('node:path');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
for(const file of ['dist/win-unpacked/RL Buddy.exe',`dist/RL-Buddy-v${require('../package.json').version}.exe`]) {
  execFileSync(path.resolve(__dirname,'..',file),['--verify-build'],{env,windowsHide:true,timeout:90000,stdio:'inherit'});
  console.log('PACKAGED CHECK PASSED:',file);
}
