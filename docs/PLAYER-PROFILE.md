# Player profile

Open **Player profile** after a match or while Rocket League is closed. Set your exact player name in Connection & AI and enable match memory before playing. The page uses completed, identified local-player records only; interrupted games and unidentified legacy records do not enter the totals. Older records can contribute existing scoreboard facts, but new timelines and context cannot be backfilled.

## Confirmed acquisition

The [official Stats API](https://www.rocketleague.com/developer/stats-api?lang=en) reports scoreboard fields and match context. RL Buddy retains score, goals, shots, assists, saves, touches, car contacts and demolitions, plus playlist ID and arena when supplied. It adds a bounded scoreboard timeline for all observed players, normally at least five seconds between samples, keeping the newest 180 samples and allowing a final-score correction. Elapsed timestamps start when recording starts, not necessarily kickoff. Updates during goal replays are excluded from these samples. Connections discovering a match through UpdateState are conservatively marked partial.

No spectator-only boost/speed/position fields, platform account IDs, or game commands were added. Scoreboard events still run independently of optional vision. Opening a profile performs no model inference, provider request or account lookup.

## Metrics

| Metric | Calculation and limits |
| --- | --- |
| Totals / per-match averages / bests | Reported finite nonnegative values only; the reported-match denominator is displayed. Unknown is not zero. |
| Win rate | Wins / (wins + losses). Completed games with unknown results are displayed but excluded from this denominator. |
| Goals / shots | Sum goals / sum shots for records containing both fields. This is a scoreboard ratio, not a separately measured shooting-skill score. Zero shots leaves the ratio unknown. |
| Goal involvement | Sum (local goals + assists) / sum team goals on records with all fields and consistent contribution counts. Zero team goals leaves it unknown. |
| Recent form | Up to 20 chronological matches; a selectable metric, with averages from the newest five and preceding five records. Each average reports its actual field coverage. |
| Streak | Consecutive identical known outcomes at the end of the selected history. Unknown results interrupt a streak. |
| Teammate combinations | Recorded GoalScored events explicitly naming scorer and assister. Touch sequences are not counted as passes or assists. Event caps can make pair counts incomplete. |

Player and teammate history groups display names case-insensitively. Names may change or be shared by unrelated accounts; the app does not claim verified cross-match identity. Unresolved local identities do not receive a profile entry. Repeated teammate names within one team are not merged into a pair summary.

## Visual evidence and retention

The match inspector shows both-team scoreboards, timeline samples, recorded non-touch events, up to twelve saved frames, and any existing coaching report. Images are sampled context, not continuous video or confirmed measurements. AI interpretations never overwrite the numeric profile. Names in images remain visible. A new live/unknown game state hides the profile and cancels pending page results.

The profile follows the existing 7/30/90-day, 100-match and approximate 500 MB limits. Deleting or expiring match memory removes it from current profile calculations; no independent lifetime archive is created. The previously documented disk-deletion failure limitation still applies. Match records are read without loading separate JPEG files until the user opens a match.

Tests cover missing-value denominators, unknown outcomes, driver/date/playlist separation, explicit assist pairs, acquisition/replay bounds, persistence, deletion, empty post-match packets, and desktop navigation/gating. Desktop screenshot fixtures are synthetic test matches, not a claim of real-game accuracy validation.
