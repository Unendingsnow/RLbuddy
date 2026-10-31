"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PersonalityRegistry, validatePack } = require("../src/personality/registry");
const { ReactionEngine, endpointFor } = require("../src/personality/engine");
const builtinDir = path.resolve(__dirname, "../personalities");
const octane = JSON.parse(fs.readFileSync(path.join(builtinDir, "octane.json"), "utf8"));
const image = "data:image/png;base64,aGVsbG8=";

function fixture(overrides = {}) {
  const settings = { personalityId: "octane", spice: 1, chattiness: "balanced", ai: { enabled: false }, ...overrides.settings };
  const status = [];
  let time = 100000;
  const engine = new ReactionEngine({
    getSettings: () => settings,
    getPersonality: () => octane,
    onStatus: (value) => status.push(value),
    random: () => 0,
    now: () => time,
    fetch: overrides.fetch || (() => { throw new Error("Unexpected network request"); }),
    realtime: overrides.realtime,
  });
  return { engine, settings, status, advance: (value) => { time += value; } };
}

test("all built-ins validate; imports cannot replace a built-in or execute code", (t) => {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "buddy-packs-"));
  t.after(() => fs.rmSync(userDir, { recursive: true, force: true }));
  const registry = new PersonalityRegistry({ builtinDir, userDir });
  assert.equal(registry.list().length, 6);
  assert.equal(registry.errors.length, 0);
  assert.throws(() => registry.importFile(path.join(builtinDir, "octane.json")), /cannot be replaced/);
  assert.throws(() => validatePack({ ...octane, script: "require('node:fs')" }), /unsupported field/);
  assert.throws(() => validatePack({ ...octane, id: "../../escape" }), /id must/);
  assert.throws(() => validatePack({ ...octane, color: "url(evil)" }), /color must/);
  const imported = { ...octane, id: "custom-buddy", name: "Custom Buddy" };
  const source = path.join(userDir, "source.tmp.json");
  fs.writeFileSync(source, JSON.stringify(imported));
  assert.equal(registry.importFile(source).id, "custom-buddy");
  fs.unlinkSync(source);
  registry.reload();
  assert.equal(registry.get("custom-buddy").builtin, false);
  assert.equal(registry.get("missing").id, "octane");
  const copy = registry.get("octane");
  copy.lines.goal[0] = "tampered";
  assert.notEqual(registry.get("octane").lines.goal[0], "tampered");
});

test("bad JSON and oversized packs are rejected without disturbing installed packs", (t) => {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "buddy-invalid-"));
  t.after(() => fs.rmSync(userDir, { recursive: true, force: true }));
  const registry = new PersonalityRegistry({ builtinDir, userDir });
  const source = path.join(userDir, "bad.json");
  fs.writeFileSync(source, "{ broken");
  assert.throws(() => registry.importFile(source), /not valid JSON/);
  fs.writeFileSync(source, " ".repeat(128 * 1024 + 1));
  assert.throws(() => registry.importFile(source), /smaller than/);
  assert.equal(registry.list().length, 6);
});

test("local personality works offline, avoids immediate repeats, deduplicates events", async () => {
  const { engine, advance } = fixture();
  const first = await engine.react({ id: "goal-1", type: "goal" });
  assert.equal(first.source, "local");
  assert.equal(first.mood, "hype");
  assert.equal(await engine.react({ id: "goal-1", type: "goal" }, { force: true }), null);
  advance(2000);
  const second = await engine.react({ id: "goal-2", type: "goal" });
  assert.notEqual(first.text, second.text);
  engine.dispose();
});

test("quiet mode suppresses shots but big events interrupt cooldown; gentle spice changes tone", async () => {
  const { engine, settings, advance } = fixture({ settings: { chattiness: "quiet", spice: 0 } });
  assert.equal(await engine.react({ type: "shot" }), null);
  const goal = await engine.react({ type: "goal" });
  assert.ok(octane.gentleLines.goal.includes(goal.text));
  advance(1300);
  assert.ok(await engine.react({ type: "conceded" }));
  settings.spice = 2;
  const spicy = await engine.react({ type: "goal" }, { force: true });
  assert.ok(octane.spicyLines.goal.includes(spicy.text));
  engine.dispose();
});

test("OpenAI request uses Responses schema and never persists remote conversation state", async () => {
  let request;
  const { engine } = fixture({ settings: { ai: { enabled: true, provider: "openai", apiKey: "test-key", model: "chosen-model" } },
    fetch: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return { ok: true, json: async () => ({ output: [{ type: "message", content: [{ type: "output_text", text: "A fresh comeback." }] }] }) };
    },
  });
  const reply = await engine.react({ type: "goal", player: "Driver", blueScore: 1 });
  assert.equal(reply.source, "ai");
  assert.equal(request.url, "https://api.openai.com/v1/responses");
  assert.equal(request.body.model, "chosen-model");
  assert.equal(request.body.store, false);
  assert.equal(request.options.redirect, "error");
  assert.match(request.body.input, /Player/);
  assert.doesNotMatch(request.body.input, /Driver/);
  engine.dispose();
});

test("network errors fall back locally without exposing secrets", async () => {
  const { engine, status } = fixture({ settings: { ai: { enabled: true, provider: "openai", apiKey: "secret" } },
    fetch: async () => { throw new Error("connection failed https://secret@host/path"); },
  });
  assert.equal((await engine.react({ type: "goal" })).source, "local");
  assert.ok(status.some((entry) => entry.state === "error"));
  assert.ok(!JSON.stringify(status).includes("secret"));
  engine.dispose();
});

test("new events cancel stale AI replies; localOnly is immediate even with AI enabled", async () => {
  let abortSeen = false;
  const { engine, advance } = fixture({ settings: { ai: { enabled: true, provider: "openai", apiKey: "test" } },
    fetch: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => {
      abortSeen = true; reject(new Error("cancelled"));
    }, { once: true })),
  });
  const pending = engine.react({ type: "shot" });
  advance(2000);
  const immediate = await engine.react({ type: "goal" }, { localOnly: true });
  assert.equal(immediate.source, "local");
  assert.equal(await pending, null);
  assert.equal(abortSeen, true);
  engine.dispose();
});

test("custom endpoints require TLS except loopback and reject embedded credentials", () => {
  assert.equal(endpointFor({ provider: "ollama" }), "http://127.0.0.1:11434/api/chat");
  assert.equal(endpointFor({ provider: "compatible", baseUrl: "https://example.com" }), "https://example.com/v1/chat/completions");
  assert.equal(endpointFor({ provider: "compatible", baseUrl: "http://localhost:1234/v1" }), "http://localhost:1234/v1/chat/completions");
  assert.throws(() => endpointFor({ provider: "compatible", baseUrl: "http://example.com" }), /require HTTPS/);
  assert.throws(() => endpointFor({ provider: "compatible", baseUrl: "https://secret@example.com" }), /require HTTPS/);
});

test("vision requires both switches and sends only selected image in provider schema", async () => {
  const requests = [];
  const { engine, settings } = fixture({ settings: { ai: { enabled: true, provider: "ollama", model: "vision-model" } },
    fetch: async (_url, options) => { requests.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ message: { content: "A very dramatic scoreboard." } }) }; },
  });
  assert.equal(await engine.observe({ dataUrl: image }), null);
  assert.equal(requests.length, 0);
  settings.vision = { enabled: true, intervalSeconds: 3 };
  const result = await engine.observe({ dataUrl: image, context: { blueScore: 2, privateData: "do not send" } });
  assert.equal(result.eventType, "observation");
  assert.equal(result.source, "ai");
  assert.deepEqual(requests[0].messages[1].images, ["aGVsbG8="]);
  assert.ok(!JSON.stringify(requests[0]).includes("do not send"));
  assert.ok(!JSON.stringify(engine.history).includes("aGVsbG8="));
  engine.dispose();
});

test("vision silence stays silent and configured interval applies", async () => {
  let calls = 0;
  const { engine, advance } = fixture({ settings: { vision: { enabled: true, intervalSeconds: 3 }, ai: { enabled: true, provider: "openai", apiKey: "test" } },
    fetch: async () => { calls++; return { ok: true, json: async () => ({ output: [{ type: "message", content: [{ type: "output_text", text: "..." }] }] }) }; },
  });
  assert.equal(await engine.observe({ dataUrl: image }), null);
  advance(2500);
  assert.equal(await engine.observe({ dataUrl: image }), null);
  assert.equal(calls, 1);
  advance(500);
  await engine.observe({ dataUrl: image });
  assert.equal(calls, 2);
  engine.dispose();
});

test("Realtime provider is shared by chat and vision; partial text remains transient", async () => {
  const requests = [];
  const realtime = { dispose() {}, request: async (request) => { requests.push(request); request.onPartial("Good"); return request.dataUrl ? "Good save on screen." : "Good company."; } };
  const { engine, status, advance } = fixture({ settings: { vision: { enabled: true }, ai: { enabled: true, provider: "openai-realtime", apiKey: "test" } }, realtime });
  assert.equal((await engine.chat("hello")).source, "ai");
  advance(3000);
  assert.equal((await engine.observe({ dataUrl: image })).source, "ai");
  assert.equal(requests.length, 2);
  assert.equal(requests[0].dataUrl, undefined);
  assert.equal(requests[1].dataUrl, image);
  assert.ok(status.some((entry) => entry.state === "streaming" && entry.partialText === "Good"));
  engine.dispose();
});

test("data-driven reaction styles, weights, tokens and per-match streaks produce actual outcomes", async () => {
  const pack = validatePack({ ...octane, lines: { ...octane.lines, goal: ["{player}: {blueScore}-{orangeScore}. Goal streak {goalStreak}."] },
    reactionStyles: { goal: { mood: "smug", bubbleMs: 9000, weights: [5] } } });
  const settings = { personalityId: "octane", spice: 1, ai: { enabled: false } };
  const engine = new ReactionEngine({ getSettings: () => settings, getPersonality: () => pack });
  await engine.react({ type: "match_start", source: "stats" }, { force: true });
  const first = await engine.react({ type: "goal", player: "Driver", blueScore: 1, orangeScore: 0, source: "stats" }, { force: true });
  assert.equal(first.text, "Driver: 1-0. Goal streak 1.");
  assert.equal(first.mood, "smug");
  assert.equal(first.durationMs, 9000);
  const second = await engine.react({ type: "goal", player: "Driver", blueScore: 2, orangeScore: 0, source: "stats" }, { force: true });
  assert.match(second.text, /Goal streak 2/);
  await engine.react({ type: "goal", source: "demo" }, { force: true });
  await engine.react({ type: "conceded", source: "stats" }, { force: true });
  const reset = await engine.react({ type: "goal", source: "stats" }, { force: true });
  assert.equal(reset.text, "you: ?-?. Goal streak 1.");
  assert.throws(() => validatePack({ ...octane, reactionStyles: { goal: { mood: "run-code" } } }), /unsupported mood/);
  assert.throws(() => validatePack({ ...octane, reactionStyles: { goal: { bubbleMs: 999999 } } }), /bubbleMs/);
  engine.dispose();
});

test("a four-line reaction pool does not repeat any of the last three lines", async () => {
  const { engine } = fixture();
  const lines = [];
  for (let i = 0; i < 4; i++) lines.push((await engine.react({ type: "goal" }, { force: true })).text);
  assert.equal(new Set(lines).size, 4);
  assert.equal((await engine.react({ type: "goal" }, { force: true })).text, lines[0]);
  engine.dispose();
});

test("stopping vision cancels pending observation without interrupting future local reactions", async () => {
  let aborted = false;
  const { engine } = fixture({ settings: { ai: { enabled: true, provider: "openai", apiKey: "test" }, vision: { enabled: true } },
    fetch: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => { aborted = true; reject(new Error("cancelled")); }, { once: true })),
  });
  const observing = engine.observe({ dataUrl: image });
  engine.cancelObservation();
  assert.equal(await observing, null);
  assert.equal(aborted, true);
  assert.equal((await engine.react({ type: "goal" }, { localOnly: true, force: true })).source, "local");
  engine.dispose();
});
