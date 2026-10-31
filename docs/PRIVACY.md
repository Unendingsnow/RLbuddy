# RL Buddy beta privacy information

RL Buddy runs on your Windows computer. This build has no analytics, account service, or automatic crash uploads.

## Gameplay and capture

The game connection reads Rocket League's local Stats API. Match memory stores observed events, scoreboard stats and player display names in your Windows account's app-data folder. Platform account IDs used for matching are not persisted. Memory can be disabled, deleted, or retained for 7, 30 or 90 days, subject to count and size limits.

Player profiles are calculated locally from that retained history. New matches also record playlist/arena context and up to 180 scoreboard samples, normally five seconds apart, with a final-score update. Score, goals, shots, assists, saves, touches, car contacts and demolitions are retained only when reported. Profiles and teammate summaries group display names, not verified accounts; identically named accounts cannot be reliably distinguished across matches. Opening the profile makes no AI or external account lookup requests. Optional saved images and existing reviews can be opened alongside a completed match. Deleting or expiring its memory removes its contribution to the profile; profiles are not a separate lifetime database.

Screen capture is optional and resets off on each launch. Select the source yourself. Local frame saving and AI vision have separate switches. A one-shot test sends just the selected test image or selected-window image. No microphone recording or full-video recording is included. Ctrl+Shift+P stops capture and pauses AI; resuming does not restart capture.

## AI services

Built-in personality lines require no AI service. Enabled AI sends event context and/or selected images to the provider configured in Connection & AI. AI chat sends your typed message. A requested match review sends selected stored evidence and recent historical summaries. The app never silently changes to a paid provider.

Player-name anonymization applies to structured event/review data. It does not redact names, messages, or other information within screenshots, or information you type yourself. Choose the game window instead of the whole desktop when possible. Provider retention and processing depend on that provider's terms. Ollama uses the server URL you configure; a remote Ollama server is not the same as on-device processing.

API keys are encrypted using Windows-backed Electron safe storage and are not exposed to renderer pages. Usage records contain provider/model, token counts, timestamps and estimated costs. They do not contain prompts, keys or images. Estimates are not invoices or guaranteed billing limits.

## Downloads, updates and support

Checking releases contacts GitHub. Opening downloads opens the project's GitHub Releases page in your browser. The Ollama setup action contacts GitHub for its official installer; model downloads use the local Ollama service, which contacts its registry. No automatic RL Buddy update download or installation occurs in this beta.

Private diagnostic exports omit screenshots, keys, player names, chat, capture titles, server URLs and filesystem paths. They include application version, general system capacity, connection states and aggregate usage. Exports stay local until you choose to share them. Review anything before posting publicly to GitHub.

## Deletion

Use Memory & coaching to delete saved matches, Connection & AI to remove the API key, or Open settings folder to locate all local data. The installer preserves app data on uninstall so upgrades do not erase history; you can remove that folder separately after quitting. Ollama and its downloaded models are separate installations and are not removed by uninstalling RL Buddy.

This describes the beta's implemented behavior. It does not represent approval by Epic Games or replace your selected AI provider's terms.
