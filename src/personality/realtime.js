"use strict";

const { createHash, randomUUID } = require("node:crypto");

/** A persistent, text-only Realtime session. Each response has isolated input;
 * screenshots never accumulate in the server's default conversation. */
class RealtimeClient {
  constructor({ WebSocket: SocketClass, onStatus = () => {} } = {}) {
    this.SocketClass = SocketClass;
    this.onStatus = onStatus;
    this.socket = null;
    this.ready = false;
    this.connecting = null;
    this.pending = null;
    this.fingerprint = null;
    this.disposed = false;
  }

  connect(ai) {
    if (this.disposed) return Promise.reject(new Error("Realtime closed."));
    const key = String(ai.apiKey || "").trim();
    const model = String(ai.model || "gpt-realtime-2.1").trim();
    if (!key || !model || model.length > 120) return Promise.reject(new Error("Realtime requires an API key and model."));
    const fingerprint = createHash("sha256").update(`${model}\0${key}`).digest("hex");
    if (fingerprint !== this.fingerprint) this.close();
    this.fingerprint = fingerprint;
    if (this.ready && this.socket?.readyState === 1) return Promise.resolve();
    if (this.connecting) return this.connecting.promise;
    const Socket = this.SocketClass || require("ws");
    let resolveReady;
    let rejectReady;
    const promise = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const timer = setTimeout(() => this.close(new Error("Realtime connection timed out.")), 10000);
    this.connecting = { promise, resolve: resolveReady, reject: rejectReady, timer };
    try {
      const socket = new Socket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`, {
        headers: { Authorization: `Bearer ${key}` },
        handshakeTimeout: 8000,
        maxPayload: 1024 * 1024,
        followRedirects: false,
      });
      this.socket = socket;
      socket.on("open", () => {
        if (this.socket !== socket || this.disposed) return;
        socket.send(JSON.stringify({ type: "session.update", session: {
          type: "realtime", output_modalities: ["text"], max_output_tokens: 120,
        } }));
      });
      socket.on("message", (raw) => {
        if (this.socket !== socket) return;
        let event;
        try { event = JSON.parse(String(raw)); } catch { return; }
        this.handle(event);
      });
      socket.on("error", () => {
        if (this.socket === socket) this.close(new Error("Realtime connection failed."));
      });
      socket.on("close", () => {
        if (this.socket === socket) this.close(new Error("Realtime connection closed."));
      });
    } catch {
      this.close(new Error("Realtime connection failed."));
    }
    return promise;
  }

  handle(event) {
    if (event.type === "session.updated" && this.connecting) {
      const connecting = this.connecting;
      this.connecting = null;
      clearTimeout(connecting.timer);
      this.ready = true;
      connecting.resolve();
      return;
    }
    if (event.type === "error") {
      // Provider errors can contain user input. Never expose their raw text.
      this.close(new Error("Realtime rejected the request. Check the model and API access."));
      return;
    }
    const pending = this.pending;
    if (!pending) return;
    if (event.type === "response.created" && event.response?.metadata?.buddy_request === pending.id) {
      pending.responseId = event.response.id;
      return;
    }
    if (event.type === "response.output_text.delta" && event.response_id === pending.responseId) {
      pending.text = (pending.text + String(event.delta || "")).slice(0, 2000);
      pending.onPartial?.(pending.text);
      return;
    }
    if (event.type === "response.done" && (event.response?.id === pending.responseId
      || event.response?.metadata?.buddy_request === pending.id)) {
      pending.onUsage?.(event.response.usage);
      if (event.response.status !== "completed") {
        this.finish(new Error("Realtime could not finish the response."));
        return;
      }
      const text = event.response.output?.filter((item) => item.type === "message")
        .flatMap((item) => item.content || []).filter((part) => part.type === "output_text")
        .map((part) => part.text).join(" ") || pending.text;
      this.finish(null, text);
    }
  }

  async request({ ai, instructions, prompt, dataUrl, signal, onPartial, onUsage }) {
    if (signal?.aborted) throw new Error("Realtime request cancelled.");
    await this.connect(ai);
    if (signal?.aborted || this.disposed) throw new Error("Realtime request cancelled.");
    if (this.pending) throw new Error("Realtime is busy.");
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const content = [{ type: "input_text", text: prompt }];
      if (dataUrl) content.push({ type: "input_image", image_url: dataUrl, detail: "low" });
      const onAbort = () => {
        if (this.pending?.id !== id) return;
        if (this.pending.responseId && this.socket?.readyState === 1) {
          try { this.socket.send(JSON.stringify({ type: "response.cancel", response_id: this.pending.responseId })); } catch {}
          this.finish(new Error("Realtime request cancelled."));
        } else {
          // Until the response id arrives, close to ensure the orphan is cancelled.
          this.close(new Error("Realtime request cancelled."));
        }
      };
      this.pending = { id, resolve, reject, onPartial, onUsage, text: "", responseId: null, signal, onAbort };
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) { onAbort(); return; }
      try {
        this.socket.send(JSON.stringify({ type: "response.create", response: {
          conversation: "none",
          output_modalities: ["text"],
          max_output_tokens: 120,
          instructions,
          metadata: { buddy_request: id },
          input: [{ type: "message", role: "user", content }],
        } }));
      } catch { this.close(new Error("Realtime connection failed.")); }
    });
  }

  finish(error, text) {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    pending.signal?.removeEventListener("abort", pending.onAbort);
    if (error) pending.reject(error);
    else pending.resolve(text);
  }

  close(error = new Error("Realtime connection closed.")) {
    this.ready = false;
    const connecting = this.connecting;
    this.connecting = null;
    if (connecting) { clearTimeout(connecting.timer); connecting.reject(error); }
    this.finish(error);
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try { socket.terminate ? socket.terminate() : socket.close(); } catch {}
    }
  }

  dispose() { this.disposed = true; this.close(); }
}

module.exports = { RealtimeClient };
