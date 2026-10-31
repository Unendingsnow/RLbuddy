"use strict";
const { spawn } = require("node:child_process");
const path = require("node:path");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const binary = process.env.RLBUDDY_TEST_ELECTRON || require("electron");
const child = spawn(binary, [path.join(__dirname, "capture-smoke.js")], { env, stdio: "inherit", windowsHide: true });
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
