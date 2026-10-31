# Personality packs

A personality is a portable, versioned JSON file. It controls the buddy's voice, color, event reactions, expression, and bubble timing. Import a file from the app's personality library. Built-in packs cannot be overwritten; use a unique id for your own. Reimporting your own id updates that installed pack.

The default is **Ratchet**, the orange junkyard possum with brutal, profane, terminally online gameplay banter at maximum spice. Amp is the acid-yellow hype alternative; Moss is the calm green alternative. Ratchet keeps the stable pack id `octane` so existing selections keep working. Lower spice settings use its separate plain/gentle lines.

The game-event path needs no AI account: a confirmed goal, save, assist, demolition, overtime, or result selects a local line immediately. The same pack can optionally guide AI chat and vision. Imported packs are data only: no JavaScript, HTML, executable plugins, paths, URLs, or downloaded assets run from a pack.

## Minimal pack

```json
{
  "schemaVersion": 1,
  "id": "tiny-rival",
  "name": "Tiny Rival",
  "tagline": "Competitive, but on your side.",
  "description": "A cheeky passenger for your next match.",
  "author": "Your name",
  "version": "1.0.0",
  "color": "#e8a85d",
  "systemPrompt": "You are a tiny, cheeky Rocket League companion. Keep replies short. Celebrate the player and make affectionate jokes about observed gameplay.",
  "lines": {
    "greeting": ["I brought the confidence. You brought the car."],
    "idle": ["Still small. Still competitive."],
    "chat": ["You have my tiny but undivided attention."],
    "goal": ["{player}, you menace. Beautiful.", "That net had plans today."],
    "conceded": ["A plot twist. We can work with that."],
    "win": ["Excellent. I shall be unbearable about this."],
    "loss": ["Next chapter. I'm still riding with you."]
  },
  "reactionStyles": {
    "goal": { "mood": "hype", "bubbleMs": 7000, "cooldownMs": 1200, "weights": [3, 1] },
    "loss": { "mood": "sad", "bubbleMs": 8000 }
  }
}
```

## Schema version 1

Files must be regular `.json` files under 128 KiB. Unknown fields and event names are rejected. `id` uses 2–48 lowercase letters, digits, or hyphens and starts with a letter. `version` is `major.minor.patch`. `color` is a six-digit hex color. Names are limited to 40 characters, taglines 90, descriptions 600, authors 80, and the AI prompt 4,000.

`lines` maps an event to 1–30 strings, at most 220 characters each. `greeting`, `idle`, and `chat` are required. Missing event lines fall back to `idle`. Add plenty of lines to keep a pack fresh. `gentleLines` and `spicyLines` optionally override selected events for spice levels 0 and 2; otherwise the normal lines are used. Creators should keep normal/gentle lines profanity-free. Spice level 1 uses the normal set.

Supported events: `match_start`, `goal`, `conceded`, `team_goal`, `save`, `epic_save`, `assist`, `shot`, `demo`, `demolished`, `overtime`, `win`, `loss`, `match_end`, `idle`, `greeting`, `chat`. `goal` is the watched player's goal; `team_goal` is a teammate's goal; `conceded` is a goal for the other team. Visual observations are optional AI output, not a guaranteed game event or a pack event trigger.

`reactionStyles` optionally maps those events to:

| Field | Values | Purpose |
| --- | --- | --- |
| `mood` | `idle`, `happy`, `hype`, `sad`, `smug`, `surprised`, `thinking` | Character expression/animation |
| `bubbleMs` | Integer 2,000–20,000 | Bubble duration; default 6,500 |
| `cooldownMs` | Integer 300–60,000 | Minimum spacing; the user's quieter pacing still takes precedence |
| `weights` | One integer 1–100 per normal event line | Relative selection probability among eligible lines |

The engine avoids the last three lines when the pool is large enough; smaller pools avoid as much repetition as possible. Gentle/spicy overrides use equal weights. A one-line event always remains usable.

Known template tokens are `{player}`, `{blueScore}`, `{orangeScore}`, `{clock}`, `{goalStreak}`, `{saveStreak}`, and `{concededStreak}`. Missing player names become `you`; unavailable scores/clock become `?`. Unknown tokens remain literal. Templates never run expressions. Streaks count observed events only, reset on `match_start`, and keep demo events separate from game events. A conceded goal resets goal/save streaks; a player goal resets the conceded streak. These are not career statistics, and reconnecting midway through a match cannot reconstruct earlier events.

## Optional AI

AI starts disabled. Local reactions continue when no model/key is configured or the AI connection fails. The app supports OpenAI Realtime, OpenAI Responses, a locally installed Ollama model, or an HTTPS OpenAI-compatible server. An API key and model access are separate from a ChatGPT subscription. Ollama needs an installed model; vision additionally needs an image-capable model.

OpenAI Realtime uses a persistent WebSocket with text output. It sends each selected image as isolated response input (`conversation: "none"`), so screenshots do not build up in the default conversation. Replies stream internally and the completed bubble appears after the model finishes. Realtime defaults to `gpt-realtime-2.1`; the model is editable. The Responses fallback defaults to `gpt-4.1-mini` when its model is blank.

Live capture is a continuous local video stream, but AI receives **sampled still frames**, normally one every three seconds (configurable minimum two seconds). This is not native continuous video understanding or guaranteed camera-conversation latency. Busy analysis skips/backpressures frames; network/model processing adds delay. Live game telemetry supplies the exact events for immediate local reactions. Vision alone cannot reliably distinguish every goal, save, whiff, or player from a still image and is prompted to stay silent when uncertain.

There are at most 30 AI requests/minute for Realtime and 20/minute for HTTP providers, shared with chat/event requests. Network calls time out and stale responses are cancelled. Sampling continues only while AI and vision are both enabled and a source has been selected. Captures are not saved locally or retained in the engine's bubble history; a configured cloud provider receives frames while watching is on. No microphone audio is sent. Local game events do not need a cloud model.

Protocol references: [OpenAI Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations), [OpenAI WebSockets](https://developers.openai.com/api/docs/guides/voice-websockets), [OpenAI text generation](https://developers.openai.com/api/docs/guides/text), [Ollama chat](https://docs.ollama.com/api/chat).

This format is a foundation for distributing packs. A hosted marketplace, purchases, creator verification, account syncing, and custom character art are not implemented in this app.
