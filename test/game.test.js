"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { JsonFrameBuffer, GameTracker, StatsClient } = require("../src/game/stats-client");
const { patchIni, readIniValue, isStatsApiEnabledText, patchOne } = require("../src/game/setup");
const me = { Name: "Player One", TeamNum: 0 };
const foe = { Name: "Opponent", TeamNum: 1 };
const mate = { Name: "Teammate", TeamNum: 0 };
const packet = (Event, Data) => ({ Event, Data });
function tracker(options = {}) {
  const game = new GameTracker({ playerName: me.Name, ...options });
  const events = [];
  game.on("event", (event) => events.push(event));
  return { game, events };
}
function tick(game, extra = {}) {
  game.handleMessage(packet("UpdateState", { MatchGuid: "match-a", Players: [{ ...me, Goals: 1, Assists: 2, Saves: 3, Shots: 4 }, foe, mate], Game: { TimeSeconds: 123, Teams: [{ TeamNum: 0, Score: 1 }, { TeamNum: 1, Score: 2 }] }, ...extra }));
}

test("JSON framing survives arbitrary splits, quoted braces, UTF-8 and escaped quotes", () => {
  const parser = new JsonFrameBuffer();
  const objects = [{ Event: "x", Data: { Name: 'name } \\" { é' } }, { Event: "y", Data: "{}" }];
  const stream = objects.map(JSON.stringify).join("");
  const frames = [];
  for (const char of stream) frames.push(...parser.push(char));
  assert.deepEqual(frames.map(JSON.parse), objects);
});
test("framing ignores separators and bounds unfinished packets", () => {
  const parser = new JsonFrameBuffer(30);
  assert.deepEqual(parser.push('junk\n{"x":1}\0{"y":2}'), ['{"x":1}', '{"y":2}']);
  parser.push('{"large":"' + "x".repeat(100));
  assert.deepEqual(parser.push('{"ok":true}'), ['{"ok":true}']);
});
test("official nested teams, player stats and zero clock are normalized", () => {
  const { game } = tracker();
  tick(game);
  assert.equal(game.snapshot().orangeScore, 2);
  assert.equal(game.snapshot().goals, 1);
  assert.equal(game.snapshot().saves, 3);
  assert.equal(game.snapshot().team, 0);
  game.handleMessage(packet("ClockUpdatedSeconds", { TimeSeconds: 0 }));
  assert.equal(game.snapshot().clock, 0);
});
test("unknown local player never adopts the viewed spectator target", () => {
  const { game, events } = tracker({ playerName: "" });
  tick(game, { Game: { Target: me, Teams: [{ Score: 2 }, { Score: 0 }] } });
  game.handleMessage(packet("GoalScored", { Scorer: me }));
  game.handleMessage(packet("MatchEnded", { WinnerTeamNum: 0 }));
  assert.equal(game.snapshot().team, null);
  assert.deepEqual(events.map((event) => event.type), ["match_start", "match_end"]);
});
test("configured player has precedence over a conflicting local marker", () => {
  const { game } = tracker();
  tick(game, { Players: [{ ...foe, bIsLocalPlayer: true }] });
  assert.equal(game.snapshot().team, null);
});
test("explicit local marker can identify an unnamed local player", () => {
  const { game, events } = tracker({ playerName: "" });
  tick(game, { Players: [{ ...me, IsLocalPlayer: true }] });
  assert.equal(game.snapshot().team, 0);
  assert.equal(game.snapshot().playerName, me.Name);
  game.handleMessage(packet("GoalScored", { Scorer: me }));
  assert.equal(events.at(-1).type, "goal");
});
test("paired match creation packets don't reset a match", () => {
  const { game, events } = tracker();
  game.handleMessage(packet("MatchCreated", { MatchGuid: "match-a" }));
  tick(game);
  game.handleMessage(packet("MatchInitialized", { MatchGuid: "match-a" }));
  assert.equal(game.snapshot().goals, 1);
  assert.equal(events.filter((event) => event.type === "match_start").length, 1);
});
test("GoalScored and statfeed goal awards collapse into one reaction in either order", () => {
  for (const reverse of [false, true]) {
    const { game, events } = tracker();
    tick(game);
    const packets = [packet("GoalScored", { Scorer: me }), packet("StatfeedEvent", { EventName: "Goal", MainTarget: me }), packet("StatfeedEvent", { EventName: "AerialGoal", MainTarget: me })];
    for (const message of reverse ? packets.reverse() : packets) game.handleMessage(message);
    assert.equal(events.filter((event) => event.type === "goal").length, 1);
  }
});
test("team goals and conceded goals are attributed from observed team", () => {
  const { game, events } = tracker();
  tick(game);
  game.handleMessage(packet("GoalScored", { Scorer: mate }));
  game.handleMessage(packet("GoalScored", { Scorer: foe }));
  assert.deepEqual(events.slice(-2).map((event) => event.type), ["team_goal", "conceded"]);
});
test("saves and demolitions react only when local player is involved", () => {
  const { game, events } = tracker();
  tick(game);
  for (const [EventName, MainTarget, SecondaryTarget] of [["Save", foe], ["EpicSave", me], ["Demolish", foe, me], ["Demolish", me, foe]]) game.handleMessage(packet("StatfeedEvent", { EventName, MainTarget, SecondaryTarget }));
  assert.deepEqual(events.slice(1).map((event) => event.type), ["epic_save", "demolished", "demo"]);
});
test("a shot on goal is never reported as a scored goal", () => {
  const { game, events } = tracker();
  tick(game);
  game.handleMessage(packet("StatfeedEvent", { EventName: "ShotOnGoal", MainTarget: me }));
  assert.equal(events.at(-1).type, "shot");
});
test("overtime fires once, string Data is accepted, malformed packets are ignored", () => {
  const { game, events } = tracker();
  tick(game);
  game.handleMessage(packet("ClockUpdatedSeconds", JSON.stringify({ TimeSeconds: 1, bOvertime: true })));
  game.handleMessage(packet("ClockUpdatedSeconds", { TimeSeconds: 2, bOvertime: true }));
  game.handleMessage(packet("UpdateState", "broken"));
  game.handleMessage(packet("UpdateState", null));
  assert.equal(events.filter((event) => event.type === "overtime").length, 1);
});
test("result finalizes once and a new match resets all transient state", () => {
  const { game, events } = tracker();
  tick(game);
  game.handleMessage(packet("MatchEnded", { WinnerTeamNum: 1 }));
  game.handleMessage(packet("PodiumStart", {}));
  game.handleMessage(packet("MatchDestroyed", {}));
  assert.equal(events.filter((event) => event.type === "loss").length, 1);
  game.handleMessage(packet("MatchCreated", { MatchGuid: "match-b" }));
  assert.equal(game.snapshot().goals, 0);
  assert.equal(game.snapshot().team, null);
  assert.equal(game.snapshot().matchActive, true);
});
test("leaving early doesn't fabricate a victory or defeat", () => {
  const { game, events } = tracker();
  tick(game);
  game.handleMessage(packet("MatchDestroyed", {}));
  assert.equal(events.at(-1).type, "match_end");
});
test("INI patch preserves other sections, comments and WebPort; adds missing keys", () => {
  const input = '; keep\n[Other]\nPort=12\n[TAGame.MatchStatsExporter_TA]\nPort=0\nWebPort=49124\n; important\n[Last]\nThing=yes\n';
  const output = patchIni(input, { Port: 49123, PacketSendRate: 10 });
  assert.equal(readIniValue(output, "Port"), "49123");
  assert.equal(readIniValue(output, "WebPort"), "49124");
  assert.match(output, /\[Other\]\r\nPort=12/);
  assert.match(output, /; important/);
  assert.match(output, /\[Last\]\r\nThing=yes/);
  assert.equal(isStatsApiEnabledText(output), true);
});
test("game config has a recoverable backup and enabling twice is idempotent", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rlbuddy-ini-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, "TAStatsAPI.ini");
  const original = "[TAGame.MatchStatsExporter_TA]\nPort=0\nPacketSendRate=0\n";
  fs.writeFileSync(filename, original);
  assert.equal(patchOne(filename, 49123, 10).changed, true);
  assert.equal(fs.readFileSync(`${filename}.bak`, "utf8"), original);
  assert.equal(patchOne(filename, 49123, 10).alreadyEnabled, true);
});
test("UTF-16 game config and backup preserve encoding", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rlbuddy-ini-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, "TAStatsAPI.ini");
  const original = Buffer.from("\ufeff[TAGame.MatchStatsExporter_TA]\r\nPort=0\r\nPacketSendRate=0\r\n; café\r\n", "utf16le");
  fs.writeFileSync(filename, original);
  assert.equal(patchOne(filename, 49123, 10).ok, true);
  assert.deepEqual(fs.readFileSync(`${filename}.bak`), original);
  assert.equal(isStatsApiEnabledText(fs.readFileSync(filename).toString("utf16le")), true);
});
test("TCP and websocket port collisions are rejected without changing the config", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rlbuddy-ini-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, "TAStatsAPI.ini");
  const original = "[TAGame.MatchStatsExporter_TA]\nPort=0\nWebPort=49123\nPacketSendRate=10\n";
  fs.writeFileSync(filename, original);
  assert.equal(patchOne(filename, 49123, 10).ok, false);
  assert.equal(fs.readFileSync(filename, "utf8"), original);
});
test("real TCP client handles fragmented packets and stop prevents reconnect", async (t) => {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket); socket.on("close", () => sockets.delete(socket));
    const raw = JSON.stringify(packet("UpdateState", { MatchGuid: "socket-test", Players: [me], Game: { TimeSeconds: 42, Teams: [{ Score: 3 }, { Score: 2 }] } }));
    socket.write(raw.slice(0, 17));
    setTimeout(() => { if (!socket.destroyed) socket.write(raw.slice(17)); }, 10);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const client = new StatsClient({ playerName: me.Name, port: server.address().port, reconnectMs: 20 });
  t.after(() => { client.stop(); for (const socket of sockets) socket.destroy(); server.close(); });
  const gotState = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("No snapshot from socket")), 2000);
    client.on("snapshot", (state) => { if (state.clock === 42) { clearTimeout(timeout); resolve(state); } });
  });
  client.start();
  const state = await gotState;
  assert.equal(state.blueScore, 3);
  assert.equal(state.connected, true);
  client.stop();
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(client.socket, null);
  assert.equal(client.timer, null);
});
