"use strict";
// Local demonstration exporter. It never launches or controls Rocket League.
const net = require("node:net");
const port = Number(process.env.STATS_API_PORT || 49123);
const name = process.env.PLAYER_NAME || "Player";
const me = { Name: name, TeamNum: 0, Goals: 0, Saves: 0, Assists: 0, Shots: 0 };
const foe = { Name: "DefinitelyNotSmurfing", TeamNum: 1 };
const server = net.createServer((socket) => {
  console.log(`Buddy connected. Simulating a match for ${name}.`);
  const guid = `demo-${Date.now()}`;
  let blue = 0; let orange = 0; let clock = 300; let tick = 0;
  const player = { ...me };
  const send = (Event, Data) => { if (!socket.destroyed) socket.write(JSON.stringify({ Event, Data: { MatchGuid: guid, ...Data } })); };
  send("MatchCreated", {});
  const timer = setInterval(() => {
    tick += 1; clock -= 5;
    if (tick === 3 || tick === 12) { blue += 1; player.Goals += 1; player.Shots += 1; send("GoalScored", { Scorer: player, GoalSpeed: 87.3 }); send("StatfeedEvent", { EventName: "Goal", MainTarget: player }); }
    if (tick === 6) { player.Saves += 1; send("StatfeedEvent", { EventName: "EpicSave", MainTarget: player }); }
    if (tick === 9) { orange += 1; send("GoalScored", { Scorer: foe }); }
    send("UpdateState", { Players: [player, foe], Game: { TimeSeconds: clock, bOvertime: false, Teams: [{ TeamNum: 0, Name: "Blue", Score: blue }, { TeamNum: 1, Name: "Orange", Score: orange }] } });
    if (tick === 15) { send("MatchEnded", { WinnerTeamNum: 0 }); clearInterval(timer); console.log("Demo match finished. Restart the mock to play another."); }
  }, 2000);
  socket.on("close", () => clearInterval(timer));
  socket.on("error", () => {});
});
server.on("error", (error) => { console.error(`Cannot start mock exporter: ${error.message}`); process.exitCode = 1; });
server.listen(port, "127.0.0.1", () => console.log(`Mock game listening on 127.0.0.1:${port}. Set buddy's player name to "${name}" and connect its game feed. PLAYER_NAME and STATS_API_PORT override these defaults.`));
