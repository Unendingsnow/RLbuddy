"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { RealtimeClient } = require("../src/personality/realtime");

class FakeSocket extends EventEmitter {
  static instances = [];
  constructor(url, options) {
    super(); this.url = url; this.options = options; this.readyState = 0; this.sent = [];
    FakeSocket.instances.push(this);
  }
  send(message) { this.sent.push(JSON.parse(message)); }
  terminate() { this.readyState = 3; this.emit("close"); }
  open() { this.readyState = 1; this.emit("open"); }
  receive(message) { this.emit("message", JSON.stringify(message)); }
}

async function ready(client) {
  const connecting = client.connect({ apiKey: "test", model: "gpt-realtime-2.1" });
  const socket = FakeSocket.instances.at(-1);
  socket.open();
  assert.equal(socket.sent[0].type, "session.update");
  assert.deepEqual(socket.sent[0].session.output_modalities, ["text"]);
  socket.receive({ type: "session.created" });
  assert.equal(client.ready, false);
  socket.receive({ type: "session.updated" });
  await connecting;
  return socket;
}

test("Realtime authenticates in headers, waits for session.updated, and reuses the connection", async () => {
  const client = new RealtimeClient({ WebSocket: FakeSocket });
  const socket = await ready(client);
  assert.ok(!socket.url.includes("test"));
  assert.equal(socket.options.headers.Authorization, "Bearer test");
  const count = FakeSocket.instances.length;
  await client.connect({ apiKey: "test", model: "gpt-realtime-2.1" });
  assert.equal(FakeSocket.instances.length, count);
  client.dispose();
});

test("Realtime images use isolated input; deltas and final response are correlated", async () => {
  const client = new RealtimeClient({ WebSocket: FakeSocket });
  const socket = await ready(client);
  const partials = [];
  const pending = client.request({ ai: { apiKey: "test", model: "gpt-realtime-2.1" }, instructions: "Be a buddy", prompt: "Watch", dataUrl: "data:image/png;base64,aGVsbG8=", onPartial: (value) => partials.push(value) });
  await new Promise(setImmediate);
  const sent = socket.sent.at(-1);
  assert.equal(sent.type, "response.create");
  assert.equal(sent.response.conversation, "none");
  assert.equal(sent.response.input[0].content[1].type, "input_image");
  assert.ok(!socket.sent.some((event) => event.type === "conversation.item.create"));
  socket.receive({ type: "response.created", response: { id: "r1", metadata: sent.response.metadata } });
  socket.receive({ type: "response.output_text.delta", response_id: "old", delta: "stale" });
  socket.receive({ type: "response.output_text.delta", response_id: "r1", delta: "Nice " });
  socket.receive({ type: "response.output_text.delta", response_id: "r1", delta: "one." });
  socket.receive({ type: "response.done", response: { id: "r1", status: "completed", output: [] } });
  assert.equal(await pending, "Nice one.");
  assert.deepEqual(partials, ["Nice ", "Nice one."]);
  assert.equal(client.pending, null);
  client.dispose();
});

test("aborting active Realtime response sends cancellation and rejects stale output", async () => {
  const client = new RealtimeClient({ WebSocket: FakeSocket });
  const socket = await ready(client);
  const controller = new AbortController();
  const pending = client.request({ ai: { apiKey: "test", model: "gpt-realtime-2.1" }, instructions: "Be brief", prompt: "Watch", signal: controller.signal });
  await new Promise(setImmediate);
  const sent = socket.sent.at(-1);
  socket.receive({ type: "response.created", response: { id: "cancel-me", metadata: sent.response.metadata } });
  controller.abort();
  await assert.rejects(pending, /cancelled/);
  assert.deepEqual(socket.sent.at(-1), { type: "response.cancel", response_id: "cancel-me" });
  assert.equal(client.ready, true);
  client.dispose();
});

test("Realtime provider error is sanitized and connection is released", async () => {
  const client = new RealtimeClient({ WebSocket: FakeSocket });
  const socket = await ready(client);
  const pending = client.request({ ai: { apiKey: "test", model: "gpt-realtime-2.1" }, instructions: "Be brief", prompt: "Watch" });
  await new Promise(setImmediate);
  socket.receive({ type: "error", error: { message: "provider echoed sk-secret" } });
  await assert.rejects(pending, (error) => !error.message.includes("sk-secret") && /Realtime rejected/.test(error.message));
  assert.equal(client.socket, null);
  client.dispose();
});
