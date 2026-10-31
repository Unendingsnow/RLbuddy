# RL Buddy

A standalone Windows desktop companion for Rocket League. Jackshaft, a foul-mouthed pumpkin pit-crew mechanic, hangs out over your desktop and game. The original Ratchet artwork remains selectable. Six personality packs include Jackshaft, Pit Boss, Afterburn, Ratchet, Amp and Moss.

## New in 0.6.0 - the driver dossier

**Player profile** turns retained, completed match memory into a local driver history: reported score, goals, shots, assists, saves, ball touches, car contacts and demolitions; win rate, goal/shot ratio, goal involvement, recent form, personal bests and confirmed teammate scorer-assister combinations. Filter by driver display name, date window and game-reported playlist ID. Open a match to inspect both teams, a scoreboard timeline, recorded events, up to twelve saved frames and any existing coaching report.

New acquisition retains playlist/arena context and up to 180 scoreboard samples, normally five seconds apart. A final-score update can replace the latest sample. Feed connections that first discover an ongoing match are marked partial. Empty post-match packets no longer erase an identified driver. Existing records contribute whatever facts they already contain; missing fields and old timelines are never invented. Statistical denominators use only matches reporting the relevant fields.

Set your exact in-game name in **Connection & AI**, enable match memory before playing, and finish a match. Profiles are available between matches or with Rocket League closed. They follow the same retention/deletion settings as match memory and do not make AI requests. They are not account-wide lifetime stats, ranks, inferred positioning or boost analytics. Display-name groups are not verified account identities. Vision frames and saved coaching interpretations remain separate from confirmed numeric totals. See [profile metrics and limits](docs/PLAYER-PROFILE.md).

## New in 0.5.2 - desktop stream visibility

Removed Windows capture exclusion from the companion overlay so desktop screen shares can include the character and bubbles. For Discord, share the monitor containing the game and buddy; capturing only the Rocket League application can omit separate overlay windows. Select the Rocket League window as RL Buddy's own AI vision source to avoid feeding the buddy's bubbles back into its vision. This changes screen-share visibility, not capture consent or AI settings. End-to-end Discord streaming still needs verification on the user's machine.

## New in 0.5.1 - the illustrated midnight garage

Original generated workshop scenery and a new Jackshaft portrait now give the app a cinematic Halloween hot-rod garage: illuminated work bay, collectible pit pass, personality portrait, copper controls and subtle embers. Existing character animations remain intact. Artwork is bundled locally and does not require an AI subscription to display. [Asset paths and final prompts](docs/ART-DIRECTION.md).

Emergency pause now stops capture and AI before saving settings, so a disk failure cannot prevent the stop. Individual capture-off switches also stop immediately, keeping event/chat AI available. Failed writes and stale enable operations cannot undo these stops, and resuming keeps capture off. Capture privacy copy now distinguishes local memory from separately enabled live AI vision. See the [audit and feature roadmap](docs/AUDIT-2026-10-31.md) for remaining issues and Rocket League compatibility limits.

## New in 0.5.0 - the midnight garage beta

The entire desktop app now has a Halloween garage theme: pumpkin badge, copper and candlelight controls, haunted workshop stage, dark coaching screens, matching overlay bubbles, and reduced-motion support.

- **Reliable reactions:** all events update personality memory, major plays replace obsolete pending responses, and at most one relevant play waits while a bubble is being read. Confirmed events fall back locally when vision is throttled. Old queued plays expire.
- **Reply checks:** excessively long, repeated, out-of-character and selected unsupported-claim patterns are rejected. Confirmed-play replies avoid guessing team colors. Sample tests label built-in fallbacks honestly. These conservative checks are not complete factual verification; local model quality varies.
- **Shared AI controls:** one inference task across chat, vision, reviews and benchmarks, a shared request limit and failure backoff, plus configurable estimated session/day spending guards. The guard reserves $0.10 per paid request and counts unpriced calls conservatively; it is not a guaranteed provider billing cap. Unknown prices require explicitly disabling the guard. Slow vision analysis automatically increases the delay before another background observation.
- **Resilient memory:** production writes are asynchronous. New match files store metadata separately from JPEGs, and disk errors surface a warning without stopping the character. Existing match files remain readable. Queued writes flush on normal exit, and deletion is serialized to avoid resurrecting files.
- **Consumer controls:** visible capture status, Ctrl+Shift+P pause, optional player-name anonymization in structured AI data, a hardware check, progress/cancellation for model downloads, and diagnostic exports without keys, images, names or messages. Anonymization does not redact screenshot text or typed messages.
- **Distribution:** portable EXE plus assisted per-user installer, Electron hardening fuses, GitHub Windows CI and manual GitHub release checks. Builds remain unsigned; automatic updates and public-launch certification are not included.

See [privacy behavior](docs/PRIVACY.md), [release instructions](docs/RELEASING.md), and [third-party notices](docs/THIRD-PARTY-NOTICES.txt). The source repository is https://github.com/Unendingsnow/RLbuddy. CI artifacts are available from successful Windows workflow runs; published downloads belong under GitHub Releases.

## New in 0.4.0 - dynamic character reactions

**AI event banter** opts into fresh reactions to reported plays through the saved provider. **Watch this source** enables image-based entertainment during matches, with recent confirmed events providing context. Requests wait while a bubble is being read; there is no accumulating queue of old plays. Coaching stays between matches.

**Give Jackshaft a screen test** sends either a synthetic play image or one image from the explicitly selected window, then shows the AI reply in the character bubble with provider, model and measured latency. Tests do not start continuous capture. The local integration test exercises actual Ollama inference and the overlay; paid-provider paths use fixtures unless credentials are configured. Small local models can still make inaccurate or awkward remarks; synthetic test latency does not establish live-game accuracy or FPS impact.

## New in 0.3.0 — team-aware coaching

New matches record the observed roster and scoreboard stats for both teams, plus attributed goals, explicit scorer–assister pairs, shots, saves, demos and ball-touch sequences. The post-match evidence table shows teammates and opponents, and marks unreported stats as unknown. Platform account IDs are only used transiently for matching; they are not persisted or sent to the model. Display names and scoreboard stats are included when an AI review is requested.

Coaching now considers shared attacking contributions, confirmed assist combinations, opponent patterns and nearby events around goals. Reports ask for a communication cue, a measurable team/duo drill and a solo alternative. Consecutive touches are explicitly **not confirmed passes**, and temporal proximity is **not proof of causation**. This feed does not establish car positioning, spacing, boost use, double commits, rotations or teammate fault. Limited saved visual evidence may support further observations, but uncertainty must be stated. No spectator-only fields are collected. Duplicate names with unresolved identities are not assigned to the user.

Team context is available only for newly recorded matches. Existing saves remain readable but cannot be backfilled. Team events are bounded to 1,200 per match; dropped-event counts are included. AI context uses both teams' stats and bounded scoring windows/highlights, rather than sending an unlimited event log. Local Ollama reviews include up to four sampled frames; cloud reviews up to eight. Coaching remains paused during live/uncertain game states.

## New in 0.2.0

- **Memory & coaching:** local match timelines and scoreboard stats, free event debriefs, optional AI reviews, and history totals across launches. AI receives the selected completed match, up to eight saved frames, and the last ten completed match summaries. Reports cite elapsed timestamps and include a measurable Free Play drill.
- **Capture consent:** separately enable saving selected-window frames each launch. Choose the source in Connection & AI. At most one changed frame per ten seconds, 90 frames / 12 MB per match. This is sampled visual memory, not full video recording or replay-file parsing. Audio is not captured.
- **Privacy controls:** turn memory off, delete individual matches, delete all memory, or retain 7/30/90 days. Retention also limits completed history to 100 matches / approximately 500 MB. Records live in `%APPDATA%/rlbuddy/matches` and remain local until an AI review is requested.
- **Coaching gate:** live matches and unknown game modes block review and freeform AI chat. Version 0.4 enables separately opted-in entertainment observations during matches. Confirmed post-match state or a closed Rocket League process permits desktop review. Starting another match cancels pending coaching and hides the report. Goal-replay flags are not treated as offline mode. Reliable automatic Free Play identification is unavailable from the documented feed, so live Free Play coaching is not enabled; use the saved drill after reviewing.
- **Usage meter:** each provider-reported token usage is priced against the bundled standard USD rates, with session/day/retained totals and recent requests. These are estimates, not invoice totals. Unknown models and cancellations without reported usage remain unpriced. No API credit balance or account-wide costs are inferred. Ollama has zero API fees, excluding hardware/electricity. Rate source: https://developers.openai.com/api/docs/pricing (verified 2026-10-31).
- **Detailed AI reviews:** OpenAI Realtime users use `gpt-4.1-mini` through Responses for reports, with their existing OpenAI key. Standard OpenAI, Ollama and compatible endpoints use the configured model. No automatic paid fallback from local AI.
- **Local AI workshop:** click **Set up Ollama** to detect/reuse an installation or download and install the official Windows release. Download progress, cancellation, size checks and SHA-256 verification are built in. No terminal or manual installer hunt is required. Allow at least 7 GB free for runtime setup; the current installer is approximately 1.6 GB. Then download a Qwen vision model, select it and run the synthetic scoreboard benchmark. Models are separate optional multi-GB downloads. Runtime/game FPS and gameplay accuracy must be benchmarked on the user's hardware; the synthetic test is not a gameplay-quality guarantee. Installation uses the official per-user Windows installer: https://docs.ollama.com/windows .
- **Jackshaft:** eight sculpted pose assets with blink, talking, celebration, shock, smug, sad and thinking motion plus exhaust effects. The sprite sheet is generated artwork; motion between poses is procedural, not full skeletal animation. Drag and resize controls remain available. Bubble pacing now reserves 10–18 seconds plus a reading pause; manual demo buttons can interrupt.

Existing settings and personality selections are retained. Choose **Jackshaft** in Personalities for the new voice, and select his art in Desktop mode. Degenerate spice enables the new profane event-specific lines; Chill remains profanity-free.

No claim of Epic approval or zero ban risk is made. The app uses a read-only official Stats API connection and OS capture, without injection, game memory access or automated inputs.

### Character asset provenance

Built-in image-generation tool; saved asset: `app/renderer/assets/jackshaft-sheet.png`. Prompt: premium 3D Halloween pumpkin mechanic, burgundy/petrol-green racing overalls, tire boots, exhaust backpack; transparent 4×2 sprite sheet with idle, blink, talking, smug, cheering, shocked, extinguished/sad and lid-open thinking poses. No text or background. Original Ratchet art is preserved.

## Run the app

Double-click **`dist/RL-Buddy-v0.6.0.exe`**. This portable build includes its runtime; Node and the original `rl` app are not needed. Closing the dashboard keeps the buddy in the system tray. Use the tray's **Quit RL Buddy** command to exit.

For development:

```powershell
cd E:\Dev\bots\rlbuddy
npm install
npm start
```

Try the **Take a test drive** buttons immediately. They work without a game, account, key, or network connection.

## Connect Rocket League

1. In **Connection & AI**, save your exact scoreboard name.
2. Click **Enable game events**. The app detects your installation or asks you to select it, preserves the existing configuration, and creates `.bak` backups before enabling the local Stats API.
3. Restart Rocket League after changing its configuration.
4. Use **Borderless** or **Windowed** mode so Windows can display the buddy above the game. Exclusive fullscreen may cover desktop overlays.

The app reads the local TCP feed at `127.0.0.1:49123`. It does not inject into the game. Goals, conceded goals, teammate goals, saves, epic saves, assists, shots, demolitions, overtime, and results are normalized into events. Duplicate stat awards are suppressed. Your name determines which player it reacts to; it does not guess your identity from the spectator camera.

Game reactions use the personality pack locally, even when optional AI is enabled:

```text
Rocket League event -> personality + tone + recent reactions -> animation + bubble
```

This is the primary real-time path. Game telemetry is not computer vision: it knows the events the game reports, and does not claim to see missed rotations or whiffs. Future detectors can emit the same event contract without changing personality packs.

## Make it yours

- **Ratchet:** a feral junkyard possum with brutal, profane gameplay roasts. Degenerate mode is the default; turn the tone down whenever you like.
- **Amp:** big celebrations and teammate energy.
- **Moss:** dry humor and a calmer presence.

Choose a personality, trash-talk level, and chatter frequency. Imported versioned JSON packs can customize voice, line variety, moods, timing, and color. See [the personality pack format](docs/PERSONALITY-PACKS.md). Packs are data, never executable plugins. This is the pack/import foundation for a future marketplace; no storefront or payments are included.

Turn **Click through buddy** off to drag the character, then turn it back on to keep mouse input going to your game. **Ctrl+Shift+B** toggles visibility; **Ctrl+Shift+L** toggles click-through. Overlay size, display, and position are saved.

## Optional AI chat and live vision

Built-in reactions are the default. Enable **AI event banter** for dynamically generated reactions to confirmed plays, using the selected provider; failed event requests fall back to built-in lines. Add your own key/model under Connection & AI:

- **OpenAI Realtime:** persistent authenticated WebSocket with text output and image input; model name is editable.
- **OpenAI standard:** Responses API for chat and image observations.
- **Ollama:** your installed local model; vision requires an image-capable model.
- **Compatible endpoint:** HTTPS chat-completions service, or HTTP on localhost.

API keys are encrypted with Windows-backed Electron safe storage. They are not sent to renderer pages or bundled into the executable. Switching providers or endpoints clears the old key to prevent sending it to a different service. Your ChatGPT subscription is separate from API access and billing.

For optional vision, explicitly choose a window or display and turn on **Watch this source**. A continuous video stream is captured at a requested 15 fps. A local change detector samples fresh frames for AI at the selected 2–12 second minimum interval. Only the latest pending frame is retained; replies that become stale are discarded. A smaller request interval does **not** mean the model understands 15 frames per second. Model and network latency still apply, fast action between analyzed frames can be missed, and this is not a claim of parity with ChatGPT's camera mode. The UI shows measured request latency. Inference pauses while a bubble is being read, and only one live request runs at a time. Recent confirmed goals/saves supply context and animations; old events are not queued. Live vision is entertainment only; tactical coaching remains gated to post-match review.

Selected frames and match context go to the chosen AI provider while vision is enabled for entertainment reactions (including during matches), or when you explicitly request a saved-match AI review. With local Ollama they go to your local model. Optional match-frame saving is controlled separately in Memory & coaching; full video is not recorded. Both capture switches turn off every time the app restarts. A missing window never falls back to the full desktop. There is no microphone capture or spoken audio in this version; dialogue appears in text bubbles.

**Test it:** in Connection & AI, save your provider and model, then use **Give Jackshaft a screen test**. Select a synthetic play and click **React to sample image**, or select a capture window and click **Send selected window once**. These actions send one image to the saved provider and display the measured response time and AI reply. They do not enable continuous capture. API calls incur usage, including tests and replies discarded after cancellation; the ledger records measured tokens and estimated cost where pricing is known. No silent fallback to another provider occurs. A one-shot test allows up to two minutes for a cold local model; live replies have shorter timeouts. This is not a guarantee of that latency under game load.

Settings and imported packs live in `%APPDATA%\rlbuddy`, accessible with **Open settings folder**. Reaction history is bounded and held in memory for the current session.

## Verify and build

```powershell
npm test           # game framing, event attribution, packs, settings, AI transport, frame gating
npm run test:app   # isolated Electron profile, UI/IPC checks and screenshots in artifacts/
npm run build      # dist/RL-Buddy-v0.5.0.exe (Windows x64 portable)
```

The UI smoke test does not call AI services or change your real game settings. Unit tests and the UI image test use mocked AI transports. Run `node scripts/run.js --test-local-interaction` to explicitly test real Ollama image inference with `qwen3.5:4b` in an isolated profile, using synthetic plays only; it checks that distinct AI replies reach the overlay and writes latency/usage results to `artifacts/local-interaction.json`. Continuous desktop capture also has a separate local smoke test: `node src/vision/run-capture-smoke.js`; it briefly captures a desktop source in memory without sending it to a provider.

To exercise the actual local game connection without launching Rocket League, set the player name to **Player**, run `npm run mock` in a second terminal, and launch the app. The mock server occupies port 49123, so close it before using the real game.

The build is unsigned. Windows may display its usual unknown-publisher notice. Live-match validation and paid AI-provider validation require your game and provider credentials.

## Implementation references

- [Official Rocket League Stats API](https://www.rocketleague.com/developer/stats-api)
- [Electron desktop capture](https://www.electronjs.org/docs/latest/api/desktop-capturer)
- [OpenAI Realtime image inputs](https://developers.openai.com/api/docs/guides/realtime-conversations#image-inputs)
- [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)

This project is independent from the original sibling `rl` app and does not read or copy its credentials, Discord configuration, or player history.
