'use strict';
// Run on a disposable Windows CI runner; avoid touching an existing user's install.
if(process.platform!=='win32' || process.env.CI!=='true')throw Error('Installer verification requires a disposable Windows CI runner.');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const version=require('../package.json').version;
const target=fs.mkdtempSync(path.join(os.tmpdir(),'rlbuddy-install-check-'));
const installer=path.resolve(__dirname,`../dist/RL-Buddy-Setup-v${version}.exe`);
execFileSync(installer,['/S',`/D=${target}`],{windowsHide:true,timeout:120000,stdio:'inherit'});
const app=path.join(target,'RL Buddy.exe');if(!fs.existsSync(app))throw Error('Installer did not create the application.');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
execFileSync(app,['--verify-build'],{env,windowsHide:true,timeout:90000,stdio:'inherit'});
// Install over the same version to exercise the replacement path without changing data.
execFileSync(installer,['/S',`/D=${target}`],{windowsHide:true,timeout:120000,stdio:'inherit'});
execFileSync(app,['--verify-build'],{env,windowsHide:true,timeout:90000,stdio:'inherit'});
execFileSync(path.join(target,'Uninstall RL Buddy.exe'),['/S'],{windowsHide:true,timeout:90000,stdio:'inherit'});
console.log('INSTALLER CHECK PASSED: install, packaged launch, reinstall and uninstall commands completed.');
