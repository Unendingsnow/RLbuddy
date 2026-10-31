# Windows beta releases

The source and release destination are https://github.com/Unendingsnow/RLbuddy. GitHub hosts downloads; the app's publisher identity remains separate.

## Build and verify

Use Node 22 or newer on Windows. Run `npm ci`, `npm test`, `npm run test:app`, `npm run build`, and `node scripts/verify-portable.js`. The build produces a portable EXE and an assisted per-user NSIS installer. It never publishes automatically. The GitHub Windows workflow performs those checks and uploads build artifacts; download them from the successful workflow run.

The normal desktop smoke test uses synthetic data and local API fixtures, not paid services. `node scripts/run.js --test-local-interaction` explicitly runs real local inference with qwen3.5:4b. This does not measure FPS or accuracy during real matches. Live paid-provider validation needs the tester's own API credentials.

Before public release, test installation, upgrade, uninstall, monitor changes, DPI scaling, windowed/borderless game modes, capture loss, network loss, disk full, and long sessions on clean Windows machines and multiple GPU vendors. Include cold and warm model latency, game frame-time impact, relevant-reaction rate and incorrect-claim rate in release evidence. The automated suite is not a substitute for that matrix.

## GitHub download release

Create a draft GitHub release from the tested commit with a version tag matching package.json. Attach both EXEs, SHA256SUMS.txt, and release notes. Mark the current build as a prerelease and explicitly disclose that it is unsigned. Review the exact artifacts before publishing. Never commit API keys, signing keys, user-data directories or local screenshots. The app's Check GitHub release button checks stable releases; prereleases remain accessible through Open downloads.

## Signing later

A Windows Authenticode signing identity is separate from GitHub hosting. Obtain a signing service/certificate appropriate to your publisher and region, for example through a certificate authority or Microsoft's signing service. Do not commit certificates or credentials. Configure the provider's supported CI signing integration in GitHub secrets, enable executable signing and forceCodeSigning, and verify installer signatures in CI. A signature identifies the publisher but does not guarantee that SmartScreen will suppress all warnings.

## Updates later

This beta uses manual downloads. Before enabling automatic updates, configure the repository's update feed, signed binaries and metadata validation, test upgrade/rollback on installed builds, and stage releases. Never disable signature verification to make a broken updater work. No GitHub write token belongs in a distributed executable.

## Known release work

The dependency audit still reports moderate advisories in the build-tool dependency graph. The production npm dependency audit is separate from the embedded Electron runtime's security. Review the exact advisory reachability on each release, maintain the toolchain, and avoid `npm audit fix --force` downgrades. Public legal terms, trademark/asset permissions and marketplace policies require an owner decision before a commercial launch.
