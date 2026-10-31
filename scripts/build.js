'use strict';
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
delete env.ELECTRON_RUN_AS_NODE;
execFileSync(require('electron'), [path.join(__dirname, 'make-icon.js')], { stdio: 'inherit', env, windowsHide: true });
execFileSync(process.execPath, [require.resolve('electron-builder/cli.js'), '--win', '--config', 'electron-builder.yml', '--publish', 'never'], { cwd: path.resolve(__dirname, '..'), stdio: 'inherit', env, windowsHide: true });
