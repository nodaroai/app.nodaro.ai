# Chapters

> List a podcast or interview recording's chapters in one step: transcribe it and find its chapters, each with a title and a start time, ready to paste into show notes.

**Not yet enabled on nodaro.ai.** The node is built and documented, but it is hidden on nodaro.ai until it is switched on; until then it is not offered in the editor, in `GET /v1/nodes` or as an MCP tool, and its routes refuse a run.

**Needs nodaro.ai on a self-hosted install.** Its planning step runs on nodaro.ai. On a self-hosted install, connect your instance to nodaro.ai (Integrations → nodaro.ai, or paste an API key) and the node runs that step there. Without a connection the node is not listed among the available nodes (`GET /v1/nodes`), and a run is refused before anything starts: `503` with the code `nodaro_connection_required`, no job created. Transcribe uses the install's own ElevenLabs key, or the connection when there is none.

## Overview

Chapters takes one recording and returns its chapters. Inside, it runs the same steps you can wire by hand — [Transcribe](../ai-text/transcribe.md) (speakers labelled, word timings), then [Edit Plan](./edit-plan.md) in Chapters mode. Each step runs as its own job, so a long recording, a cancel or a failure behaves as it does in a hand-built workflow. Nothing is rendered: the result is text.

Use Edit Plan in Chapters mode yourself when you already have a transcript, or when you want the plan's raw `{ version, chapters }` object. To tighten the episode as well, see [Tighten Episode](./tighten-episode.md).

## Inputs

| Handle | Type | Required | Description |
|---|---|---|---|
| Recording (`media`) | Video or audio | Yes | The episode recording, up to 3 hours. It must have sound. |

A longer recording (when its length can be read) or one with no sound is refused before anything is charged.

With more than one recording wired into `media`, a run reads the first one the node's `mediaOrder` setting names (a list of the wired nodes' ids). The editor does not set `mediaOrder` yet; without it, a run reads the first recording wired in.

## Outputs

| Handle | Type | Description |
|---|---|---|
| Show notes (`text`) | Text | The chapter list as show notes: one line per chapter, `M:SS Title` (for example `0:00 Intro`, `12:47 Why we moved`). Once a chapter starts at 1:00:00 or later, every line is `H:MM:SS Title` (`0:00:00 Intro`, `1:04:10 Questions`); the episode's own length does not matter (a 70-minute episode whose last chapter starts at 58:00 stays `M:SS`). |
| Chapters (JSON) (`json`) | JSON | The chapter list itself: `[{ "startMs": <milliseconds>, "title": "<title>" }]`, the same rows the show notes list, in the same order; the first starts at 0. |

How the show notes are written:

- **The first chapter starts at 0:00**, where a listener's player starts, whatever start the plan gave it (its `startMs` in the list is 0 too).
- **The times only go up.** Two chapters that start in the same second keep the first; the others are left out. The same goes for a chapter that starts within the first second, after the first one at 0:00.
- **A title is one line.** Line breaks and runs of spaces inside a title become one space.

The node shows the list, with a button that copies it. In a published app, the show notes are shown as text.

## Configuration

| Setting | Options | Default | Notes |
|---|---|---|---|
| Planning quality | Economy / Standard / Premium | Economy | The Edit Plan tier. |
| Instructions, Style guide | Text (up to 4,000 characters each) | — | Passed to the plan ("5 to 8 chapters", "short titles"). |

## If a run fails

The steps that finished stay finished: their results (the transcript) are kept and they are not charged again. Press **Continue** on the node: only the step that failed and the ones after it run again. A node fed by a List runs once per item; it has no Continue — run it again.

A run whose plan finds no chapters fails with "The plan found no chapters in this recording.", and its per-run fee is refunded. Its steps (the transcript and the plan) ran, and are charged at their own rates.

## Credit Cost

Chapters is charged **its steps at their own rates, plus a per-run fee of 11 credits**<!-- credits: use-case-fee:episode-chapters -->:

- Transcribe (`elevenlabs-stt`): 25 credits<!-- credits: elevenlabs-stt -->
- Edit Plan, Chapters mode: the Edit Plan rate for the recording's length and tier — economy: 2.2<!-- credits-rate: edit-plan:chapters:economy:per-minute --> credits per source minute (see [Edit Plan](./edit-plan.md#credit-cost) for the other tiers and how the minutes are counted)
- **Plus the per-run fee of 11 credits<!-- credits: use-case-fee:episode-chapters -->.** A failed run's fee is refunded, and **Continue** holds it again, so a run is charged its fee once.

### What the estimate shows before you run

The estimate counts the recording's minutes the way [Edit Plan](./edit-plan.md#credit-cost) does. A recording with no known length is estimated at the 180-minute ceiling.

| Recording | Settings | Estimate |
|---|---|---|
| 45-min video | Economy | 25<!-- credits: elevenlabs-stt --> + 132<!-- credits: edit-plan:chapters:economy:60m --> + 11<!-- credits: use-case-fee:episode-chapters --> = **168**<!-- credits: elevenlabs-stt + edit-plan:chapters:economy:60m + use-case-fee:episode-chapters --> (Edit Plan at its 60-minute step; how the minutes are counted is on [Edit Plan](./edit-plan.md#credit-cost)) |
| Unknown length | Economy | 25<!-- credits: elevenlabs-stt --> + 396<!-- credits: edit-plan:chapters:economy:180m --> + 11<!-- credits: use-case-fee:episode-chapters --> = **432**<!-- credits: elevenlabs-stt + edit-plan:chapters:economy:180m + use-case-fee:episode-chapters --> |

## API

`POST /v1/episode-chapters` with `{ mediaUrls: [<recording URL>], planTier?, instructions?, styleGuide? }` starts a run and answers `202 { jobId, executionId }`. Poll the job (`GET /v1/jobs/:id/status`). Its `output_data` carries the show notes (`text`), the chapter list (`json`), the plan as Edit Plan made it (`plan`) and the transcript (`transcript`); a failed run keeps what completed and names the step that failed (`failedStep`). An `Idempotency-Key` header makes a retry of the same request answer with the same `jobId` and `"deduped": true`, starting nothing. `POST /v1/episode-chapters/estimate` takes the same body and answers the estimate as `{ data: { totalCredits, stepsCredits, feeCredits, durationSec } }` without starting anything (the credit figures are 0 on an edition without credits).

`POST /v1/episode-chapters/continue` with `{ jobId, "mode": "from-failed" }` runs what a failed run did not complete. Its refusals are in [API integration](../../api-integration.md) (the continuation codes, including `continuation_not_failed`, `continuation_settling`, `continuation_superseded` and `already_running`). Nothing is rendered, so there is no Render final: `"mode": "render-final"` is refused `render_final_not_preview`.

The [SDK](../../sdk-reference.md) (`client.edit.episodeChapters`, `client.edit.estimateEpisodeChapters`, `client.edit.continueUseCase`), the [CLI](../../cli.md) (`nodaro edit episode-chapters`, `nodaro edit continue-use-case`) and MCP (`make_chapters`, `continue_use_case`) call the same routes.

## Common Use Cases

- Chapter markers for a podcast episode's show notes or a video description.
- A table of contents for a long interview or lecture recording.
- The chapter list as JSON for a player, a website or a later step in the workflow.

## Tips

- Use **Instructions** for how many chapters you want and how to title them ("5 to 8 chapters", "titles under six words").
- Wire **Show notes** into a text node or a publishing step; wire **Chapters (JSON)** where you need the start times as numbers.
