"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { GameTracker } = require("../src/game/stats-client");
const { ReactionEngine } = require("../src/personality/engine");
const { PersonalityRegistry, EVENT_TYPES } = require("../src/personality/registry");

test("game goal produces one immediate local reaction while AI is enabled", async (t) => {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "rlbuddy-integration-"));
  t.after(() => fs.rmSync(userDir, { recursive: true, force: true }));
  const registry = new PersonalityRegistry({ builtinDir: path.join(__dirname, "../personalities"), userDir });
  let now = 100000;
  let calls = 0;
  const settings = { personalityId: "octane", spice: 1, chattiness: "balanced", ai: { enabled: true, provider: "openai-realtime", model: "test", apiKey: "test-key" } };
  const engine = new ReactionEngine({
    getSettings: () => settings, getPersonality: (id) => registry.get(id), now: () => now,
    fetch: async () => { calls += 1; throw new Error("Local events must not call a provider"); },
    realtime: { request: async () => { calls += 1; throw new Error("Local events must not call a provider"); }, dispose() {} },
  });
  t.after(() => engine.dispose());
  const tracker = new GameTracker({ playerName: "Tester", now: () => now });
  const promises = [];
  tracker.on("event", (event) => { assert.ok(EVENT_TYPES.includes(event.type)); promises.push(engine.react(event, { localOnly: true })); });
  tracker.handleMessage({ Event: "UpdateState", Data: { MatchGuid: "integration", Players: [{ Name: "Tester", TeamNum: 1 }], Game: { TimeSeconds: 250, Teams: [{ TeamNum: 0, Score: 0 }, { TeamNum: 1, Score: 0 }] } } });
  now += 10000;
  tracker.handleMessage({ Event: "GoalScored", Data: { Scorer: { Name: "Tester", TeamNum: 1 } } });
  tracker.handleMessage({ Event: "StatfeedEvent", Data: { EventName: "Goal", MainTarget: { Name: "Tester", TeamNum: 1 } } });
  tracker.handleMessage({ Event: "StatfeedEvent", Data: { EventName: "AerialGoal", MainTarget: { Name: "Tester", TeamNum: 1 } } });
  const reactions = (await Promise.all(promises)).filter(Boolean);
  assert.equal(calls, 0);
  assert.equal(reactions.filter((reaction) => reaction.eventType === "goal").length, 1);
  assert.equal(reactions.find((reaction) => reaction.eventType === "goal").source, "local");
  now += 10000;
  tracker.handleMessage({ Event: "GoalScored", Data: { Scorer: { Name: "Rival", TeamNum: 0 } } });
  const conceded = await promises.at(-1);
  assert.equal(conceded.eventType, "conceded");
  assert.equal(conceded.source, "local");
  assert.equal(calls, 0);
});
