"use strict";

const net = require("node:net");
const { EventEmitter } = require("node:events");
const { TeamContext } = require('./team-context');

/** Frames the concatenated JSON objects sent by the official Stats API. */
class JsonFrameBuffer {
  constructor(maxBytes = 1024 * 1024) { this.maxBytes = maxBytes; this.reset(); }
  reset() { this.frame = ""; this.depth = 0; this.quoted = false; this.escaped = false; }
  push(chunk) {
    const frames = [];
    for (const char of String(chunk)) {
      if (this.depth === 0 && char !== "{") continue;
      this.frame += char;
      if (this.frame.length > this.maxBytes) { this.reset(); continue; }
      if (this.quoted) {
        if (this.escaped) this.escaped = false;
        else if (char === "\\") this.escaped = true;
        else if (char === '"') this.quoted = false;
      } else if (char === '"') this.quoted = true;
      else if (char === "{") this.depth += 1;
      else if (char === "}") {
        this.depth -= 1;
        if (this.depth === 0) { frames.push(this.frame); this.reset(); }
      }
    }
    return frames;
  }
}

const teamNumber = (value) => value !== null && value !== undefined && value !== "" && [0, 1].includes(Number(value)) ? Number(value) : null;
const number = (value, fallback = 0) => Number.isFinite(Number(value)) && value !== null ? Number(value) : fallback;
const nameOf = (player) => String(player?.Name || "").trim();

class GameTracker extends EventEmitter {
  constructor({ playerName = "", now = Date.now } = {}) {
    super();
    this.playerName = String(playerName).trim();
    this.now = now;
    this.sequence = 0;
    this.connected = false;
    this.reset();
  }
  reset(guid = null) {
    this.guid = guid || null;
    this.detectedPlayerName = "";
    this.ambiguousLocal = false;
    this.ended = false;
    this.recent = new Map();
    this.teamContext = new TeamContext({now:this.now,isLocal:p=>this.isLocal(p),onEvent:event=>this.emit('team-event',{...event,roster:this.teamContext.snapshot()})});
    this.state = { connected: this.connected, matchActive: false, matchEnded: false, blueScore: 0, orangeScore: 0, clock: 300, overtime: false, playerName: this.playerName, team: null, goals: 0, saves: 0, shots: 0, assists: 0 };
  }
  snapshot() { return { ...this.state, connected: this.connected, roster:this.teamContext.snapshot() }; }
  publish() { this.emit("snapshot", this.snapshot()); }
  setConnected(connected) { this.connected = Boolean(connected); if (!connected) { this.state.matchActive = false; this.state.matchEnded = false; } this.publish(); }
  isLocal(player) {
    if(this.ambiguousLocal)return false;
    if (!player || typeof player !== "object") return false;
    if (this.playerName) return nameOf(player).toLocaleLowerCase() === this.playerName.toLocaleLowerCase();
    if (this.detectedPlayerName && nameOf(player).toLocaleLowerCase() === this.detectedPlayerName.toLocaleLowerCase()) return true;
    return player.bIsLocalPlayer === true || player.IsLocalPlayer === true;
  }
  identify(player) {
    if (!this.isLocal(player)) return;
    const team = teamNumber(player.TeamNum);
    if (team !== null) this.state.team = team;
    if (!this.playerName && nameOf(player)) { this.state.playerName = nameOf(player); this.detectedPlayerName = nameOf(player); }
  }
  event(type, extra = {}, dedupeKey = null, windowMs = 1800) {
    const at = this.now();
    if (dedupeKey && this.recent.has(dedupeKey) && at - this.recent.get(dedupeKey) < windowMs) return;
    if (dedupeKey) this.recent.set(dedupeKey, at);
    for (const [key, time] of this.recent) if (at - time > 15000) this.recent.delete(key);
    this.emit("event", { id: `${this.guid || "local"}:${++this.sequence}`, type, at: new Date(at).toISOString(), source: "stats", player: this.state.playerName || null, team: this.state.team, blueScore: this.state.blueScore, orangeScore: this.state.orangeScore, clock: this.state.clock, overtime: this.state.overtime, ...extra });
  }
  startMatch(guid, partialCapture = false) {
    if (this.state.matchActive && !this.ended && (!guid || !this.guid || this.guid === guid)) {
      if (guid) this.guid = guid;
      return;
    }
    this.reset(guid);
    this.state.matchActive = true;
    this.state.partialCapture = partialCapture;
    this.event("match_start");
    this.publish();
  }
  overtime(value) {
    if (value && !this.state.overtime) { this.state.overtime = true; this.event("overtime"); }
  }
  endMatch(winner) {
    if (this.ended || !this.state.matchActive) return;
    this.ended = true;
    this.state.matchActive = false;
    this.state.matchEnded = true;
    const winnerTeam = teamNumber(winner);
    const type = winnerTeam === null || this.state.team === null ? "match_end" : winnerTeam === this.state.team ? "win" : "loss";
    this.event(type, { winnerTeam });
    this.publish();
  }
  goal(scorer, data = {}) {
    this.identify(scorer);
    const scorerTeam = teamNumber(scorer?.TeamNum);
    const mine = this.isLocal(scorer);
    let type = mine ? "goal" : null;
    if (!mine && this.state.team !== null && scorerTeam !== null) type = scorerTeam === this.state.team ? "team_goal" : "conceded";
    if (!type) return; // A spectator or unknown player must not be assigned a team.
    this.event(type, { scorer: nameOf(scorer), scoringTeam: scorerTeam, goalSpeed: number(data.GoalSpeed, null) }, `goal:${nameOf(scorer).toLocaleLowerCase()}`, 2500);
  }
  handleMessage(message) {
    if (!message || typeof message !== "object") return;
    const event = message.Event || message.event;
    let data = message.Data ?? message.data ?? {};
    if (typeof data === "string") { try { data = JSON.parse(data); } catch { return; } }
    if (!data || typeof data !== "object") return;
    const guid = data.MatchGuid || null;
    if (event === "MatchCreated" || event === "MatchInitialized") { this.startMatch(guid); return; }
    if (event === "UpdateState") {
      if (guid && this.guid && guid !== this.guid) this.startMatch(guid, true);
      else if (!this.state.matchActive && !this.ended) this.startMatch(guid, true);
      if (guid && !this.guid) this.guid = guid;
      const game = data.Game || {};
      if (!game.bReplay) {
        if (Number.isInteger(game.PlaylistId) && game.PlaylistId >= 0) this.state.playlistId = game.PlaylistId;
        if (typeof game.Arena === 'string') this.state.arena = game.Arena.replace(/[\u0000-\u001f]/g, '').slice(0, 100);
      }
      const teams = Array.isArray(game.Teams) ? game.Teams : Array.isArray(data.Teams) ? data.Teams : [];
      for (let i = 0; i < teams.length; i += 1) {
        const team = teamNumber(teams[i].TeamNum ?? i);
        if (team !== null) this.state[team === 0 ? "blueScore" : "orangeScore"] = number(teams[i].Score);
      }
      this.state.clock = number(game.TimeSeconds, this.state.clock);
      this.overtime(game.bOvertime || game.bOverTime || game.IsOT);
      const players = Array.isArray(data.Players) ? data.Players : [];
      this.ambiguousLocal=false;
      const localCandidates=players.filter(player=>this.isLocal(player));
      this.ambiguousLocal=localCandidates.length>1;
      if(this.ambiguousLocal){this.state.team=null;for(const key of ['goals','shots','saves','assists','score','touches','cartouches','demos'])this.state[key]=null;}
      // Empty post-match packets must not erase an already identified driver.
      if (!(this.ended && players.length === 0)) this.teamContext.update(Array.isArray(data.Players) ? data.Players : null,game);
      const mine = localCandidates.length===1?localCandidates[0]:null;
      if (mine && !game.bReplay) {
        this.identify(mine);
        for (const stat of ["Goals", "Saves", "Shots", "Assists", "Score", "Touches", "CarTouches", "Demos"]) this.state[stat.toLowerCase()] = typeof mine[stat] === 'number' && Number.isFinite(mine[stat]) && mine[stat] >= 0 ? mine[stat] : null;
      }
      this.publish();
      if (game.bHasWinner) {
        const winner = teams.find((team) => team.Name === game.Winner);
        this.endMatch(winner?.TeamNum ?? (/^blue$/i.test(game.Winner) ? 0 : /^orange$/i.test(game.Winner) ? 1 : null));
      }
      return;
    }
    if (event === "ClockUpdatedSeconds") {
      this.state.clock = number(data.TimeSeconds ?? data.Seconds ?? data.Time, this.state.clock);
      this.overtime(data.bOvertime || data.bOverTime || data.IsOT);
      this.publish();
      return;
    }
    if (event === "MatchEnded") { this.endMatch(data.WinnerTeamNum); return; }
    if (event === "PodiumStart") {
      const { blueScore, orangeScore } = this.state;
      this.endMatch(blueScore === orangeScore ? null : blueScore > orangeScore ? 0 : 1);
      return;
    }
    if (event === "MatchDestroyed") {
      this.endMatch(null); // Leaving early is not proof of a win or loss.
      return;
    }
    if (this.ended) return;
    if(this.state.matchActive)this.teamContext.handle(event,data,this.state);
    if (event === "GoalScored") { this.goal(data.Scorer, data); return; }
    if (event !== "StatfeedEvent") return;
    const subject = data.MainTarget;
    const victim = data.SecondaryTarget;
    this.identify(subject); this.identify(victim);
    const stat = String(data.EventName || data.Type || "").replace(/[^a-z]/gi, "").toLowerCase();
    if (stat.endsWith("goal") && stat !== "shotongoal") { this.goal(subject, data); return; }
    const mine = this.isLocal(subject);
    const victimIsMe = this.isLocal(victim);
    let type;
    if (/demolish|demolition/.test(stat)) type = mine ? "demo" : victimIsMe ? "demolished" : null;
    else if (mine) type = stat === "epicsave" ? "epic_save" : stat === "save" ? "save" : stat === "assist" ? "assist" : /^(shot|shotongoal)$/.test(stat) ? "shot" : null;
    if (type) this.event(type, { subject: nameOf(subject), victim: nameOf(victim) || null }, `${type}:${nameOf(subject)}:${nameOf(victim)}:${this.state.clock}`, 900);
  }
}

class StatsClient extends EventEmitter {
  constructor({ playerName = "", port = 49123, reconnectMs = 3000 } = {}) {
    super();
    if (!Number.isInteger(Number(port)) || port < 1 || port > 65535) throw new Error("Stats API port must be between 1 and 65535.");
    this.port = Number(port);
    this.reconnectMs = Math.max(20, reconnectMs);
    this.tracker = new GameTracker({ playerName });
    this.tracker.on("event", (event) => this.emit("event", event));
    this.tracker.on('team-event', event => this.emit('team-event',event));
    this.tracker.on("snapshot", (state) => this.emit("snapshot", state));
    this.stopped = true;
    this.socket = null;
    this.timer = null;
  }
  start() { if (!this.stopped) return; this.stopped = false; this.connect(); }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer); this.timer = null;
    const socket = this.socket; this.socket = null;
    if (socket) socket.destroy();
    this.tracker.setConnected(false);
    this.emit("status", { connected: false, text: "Game connection paused" });
  }
  connect() {
    if (this.stopped) return;
    const frames = new JsonFrameBuffer();
    const socket = net.createConnection({ host: "127.0.0.1", port: this.port });
    this.socket = socket;
    socket.setEncoding("utf8");
    socket.setTimeout(8000);
    this.emit("status", { connected: false, text: "Waiting for Rocket League" });
    socket.once("connect", () => {
      if (this.stopped || this.socket !== socket) return;
      socket.setTimeout(0); // Menus legitimately produce no game packets.
      this.tracker.setConnected(true);
      this.emit("status", { connected: true, text: "Connected to Rocket League" });
    });
    socket.on("data", (chunk) => {
      if (this.stopped || this.socket !== socket) return;
      for (const frame of frames.push(chunk)) { try { this.tracker.handleMessage(JSON.parse(frame)); } catch (error) { this.emit("diagnostic", { text: `Ignored malformed game packet: ${error.message}` }); } }
    });
    socket.on("timeout", () => socket.destroy());
    socket.on("error", (error) => { if (error.code !== "ECONNREFUSED") this.emit("diagnostic", { text: error.message }); });
    socket.once("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.tracker.setConnected(false);
      if (!this.stopped) {
        this.emit("status", { connected: false, text: "Waiting for Rocket League" });
        this.timer = setTimeout(() => this.connect(), this.reconnectMs);
        this.timer.unref?.();
      }
    });
  }
}

module.exports = { StatsClient, JsonFrameBuffer, GameTracker };
