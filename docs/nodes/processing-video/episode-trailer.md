# Trailer

> Cut a 20–40 second trailer from a podcast or interview recording in one step and deliver it in each social format you choose, optionally after an intro card.

**Not yet enabled on nodaro.ai.** The node is built and documented, but it is hidden on nodaro.ai until it is switched on; until then it is not offered in the editor, in `GET /v1/nodes` or as an MCP tool, and its routes refuse a run.

**Needs nodaro.ai on a self-hosted install.** Its planning step runs on nodaro.ai. On a self-hosted install, connect your instance to nodaro.ai (Integrations → nodaro.ai, or paste an API key) and the node runs that step there. Without a connection the node is not listed among the available nodes (`GET /v1/nodes`), and a run is refused before anything starts: `503` with the code `nodaro_connection_required`, no job created. Transcribe uses the install's own ElevenLabs key, or the connection when there is none.

## Overview

Trailer takes one recording and returns its trailer in every format you chose. Inside, it runs the same steps you can wire by hand — [Transcribe](../ai-text/transcribe.md) (speakers labelled, word timings), [Edit Plan](./edit-plan.md) in Trailer mode, [Apply EDL](./apply-edl.md), [Combine Videos](./combine-videos.md) when an intro card is connected, and one [Social Media Format](./social-media-format.md) per format. Each step runs as its own job, so a long recording, a cancel or a failure behaves as it does in a hand-built workflow, with one difference: a format that fails never stops the other formats (see [If a run fails](#if-a-run-fails)).

- **The plan picks the length.** The trailer is 20–40 seconds of the recording's strongest moments, as [Edit Plan](./edit-plan.md) in Trailer mode chooses them. There is no length setting.
- **The moments are joined with the plan's own short crossfades.** There is no setting for the joins.
- **Every format is padded, never cropped.** Each format fits the whole picture into its shape, with bars where the shapes differ: a centre crop of a two-person shot would cut a speaker off.

The **Trailer + Formats** template in the template marketplace is the same chain built by hand, ready to fill (see [Edit Plan](./edit-plan.md)). Use it, or the individual nodes, when you need more control over a step.

## Inputs

| Handle | Type | Required | Description |
|---|---|---|---|
| Recording (`media`) | Video | Yes | The episode recording, up to 3 hours. It must have sound. An audio-only recording is refused (`media_needs_video`): every format is a video. |
| Intro card (`introCard`) | Video | No | A short video that plays before the trailer, 15 seconds at most. Make it the same size and shape as your recording, or one of the two is letterboxed. |

Refused before anything is charged: a longer recording (when its length can be read), one with no sound or no picture, an intro card that cannot be read as a video (`intro_card_unreadable`; a still image is refused too), and an intro card longer than 15 seconds (`intro_card_too_long`): "The intro card is too long. Use a card of 15 seconds or less."

With more than one recording wired into `media`, a run reads the first one the node's `mediaOrder` setting names (a list of the wired nodes' ids). The editor does not set `mediaOrder` yet; without it, a run reads the first recording wired in.

## Outputs

| Handle | Type | Description |
|---|---|---|
| Trailers (`media`) | Video (a list) | One trailer per chosen format, in the order 9:16, 1:1, 4:5, 16:9. On an **Each** wire (the default) the next node runs once per format; on a **Last** wire it reads the first chosen format that rendered. |
| Edit (EDL) (`json`) | EDL | The trailer's edit plan: the EDL the trailer was cut from, with your review edits applied. Wired into a text or prompt input, it lands there as its JSON text, in the editor as in a server run. It is JSON, not media: it does not connect to an input that takes only audio, video or images (wire **Trailers** there). |

The node shows one chip per format; click a chip to show that format's trailer.

## Configuration

| Setting | Options | Default | Notes |
|---|---|---|---|
| Formats | 9:16 Story / Reel, 1:1 Square, 4:5 Portrait, 16:9 Landscape | 9:16, 1:1 and 4:5 | At least one. 9:16, 1:1 and 4:5 are the Instagram story/reel, square feed and portrait feed sizes; 16:9 is a 1920×1080 landscape. Every format is padded, never cropped. |
| Review before render | On / Off | Off | On: the run stops at a quick preview of the trailer you can review and edit; **Render final** then makes every format. See [Review before render](#review-before-render). |
| Editing quality | Economy / Standard / Premium | Standard | The Edit Plan tier. |
| Instructions, Style guide | Text (up to 4,000 characters each) | — | Passed to the plan ("open on the funniest moment"). |

## Review before render

With **Review before render** on, a run stops at a preview of the trailer: the render is a Preview (Apply EDL's lower preview rate), and the intro card and the formats are not made yet. Review the cut and edit it in the review inspector, then press **Render final** on the node: it renders the trailer at full quality with your edit, adds the intro card and makes every format, once, with no fee.

- **Render final uses the settings the preview was made with.** To change a setting (the formats, say), run the node again.
- **Render final again (in the editor, or `POST /v1/episode-trailer/continue`).** Once a Render final has finished, you can edit the cut again and render it final again: the render and the steps after it run and are charged again, with no fee. Rendering the same edit a second time is refused, and one Render final runs at a time.
- **In a published app.** A Trailer with Review before render on shows its preview on the app's page, with a **Render final** button, as an Apply EDL render does (see [App view modes](../../app-view-modes.md#render-final)). There, once a final has been made, another Render final of the same run is refused (`render_final_not_preview`).
- **What follows the node.** This follows the preview stop rule, as a render set to Preview does (`PREVIEW_STOP_RULE_ENABLED`, off by default and not yet on for Nodaro Cloud — see [Apply EDL](./apply-edl.md#a-run-stops-at-a-preview)). Where it is on, the nodes after the node wait for its Render final and are not charged in that run. Where it is off, the node still stops at its preview, but the nodes after it run on the preview, and are charged, and run again on the trailers at Render final.
- **Someone has to review.** In a workflow or app run with nobody to review it — started from the API, the SDK, MCP's `run_workflow` or a trigger rather than the editor or the app's own page, or run inside a component — a node with Review before render on cannot run, and you should turn Review before render off for those runs. Where the preview stop rule is on, such a run is refused before anything runs or is charged (`preview_review_required`; publishing or running a component that holds one, `preview_render_nested`), with a message telling you to turn Review before render off. A run refused once it has started records what held it: `preview_review_required_review_on` (`preview_render_nested_review_on` inside a sub-workflow or component), or `preview_review_required_mixed` (`preview_render_nested_mixed`) when an Apply EDL render set to Preview holds it too. Where the rule is off, the run is not refused up front: the nodes before the node run and are charged, and the node then fails with `preview_review_required` and the same message, with nothing charged for it. (MCP's own `make_trailer` and `continue_use_case` tools are reviewed by the agent that calls them, and can use Review before render.)

## If a run fails

- **A format that could not be rendered.** Every chosen format is tried, on the first run and at Render final: one that fails never stops the others. The run completes with the formats that rendered and keeps its fee; the node names the ones it could not render ("Could not render: 1:1"), and the API names them on `failedFormats`. A format that failed is not charged. The run completed, so it has no **Continue**. Two ways to get the missing format:
  - **The same trailer, no fee:** render the node's **Edit (EDL)** output yourself. Wire it into an [Apply EDL](./apply-edl.md) (the EDL names the recording), then (when you used an intro card) a [Combine Videos](./combine-videos.md) with the card first, then a [Social Media Format](./social-media-format.md) set to the missing format with **Resize Method** set to **pad**. Each step is charged at its own rate, with no per-run fee.
  - **A new run:** run the node again with only that format ticked. This is a whole new run: every step is charged again, including the per-run fee, and the new plan may pick different moments.
- **A run with no format rendered** fails, and its per-run fee is refunded. The steps that finished stay finished: their results (the transcript, the edit, the trailer render) are kept and they are not charged again. Press **Continue** on the node: only the step that failed and the ones after it run again.

## Not once per list item

A Trailer takes one recording, and its result is already a list (one trailer per format). A Trailer fed by a List is refused before any of its runs starts, whatever its Review before render setting, with nothing charged for it (`use_case_list_driven`): "Trailer takes one recording. Use a separate workflow run for each recording."

## Credit Cost

Trailer is charged **its steps at their own rates, plus a per-run fee of 11 credits**<!-- credits: use-case-fee:episode-trailer -->:

- Transcribe (`elevenlabs-stt`): 25 credits<!-- credits: elevenlabs-stt -->
- Edit Plan, Trailer mode: the Edit Plan rate for the recording's length and tier — standard: 22 credits<!-- credits-rate: edit-plan:trailer:standard:flat --> plus 4.4<!-- credits-rate: edit-plan:trailer:standard:per-minute --> credits per source minute (see [Edit Plan](./edit-plan.md#credit-cost) for the other tiers and how the minutes are counted)
- Apply EDL: 11 credits<!-- credits-rate: apply-edl --> per minute of the rendered trailer (a Preview: 1.1 credits<!-- credits-rate: apply-edl:proxy --> per minute) — a 20–40 second trailer is one minute; see [Apply EDL](./apply-edl.md#credit-cost)
- Combine Videos (when an intro card is connected): 11 credits<!-- credits-rate: combine-videos --> per started 5 seconds of the card and the trailer together — see [Combine Videos](./combine-videos.md#credit-cost)
- Social Media Format: 22 credits<!-- credits: social-media-format --> per chosen format
- **Plus the per-run fee of 11 credits<!-- credits: use-case-fee:episode-trailer -->.** A Render final after a review is not charged the fee again. A failed run's fee is refunded, and **Continue** holds it again, so a run is charged its fee once. A run that keeps some of its formats is charged the fee.

You are charged for the trailer's own length, not for the estimate.

### What the estimate shows before you run

The estimate prices a run at 40 seconds, the longest trailer the plan cuts: the render at one minute, and Combine Videos on those 40 seconds plus the intro card. After the preview, Render final is quoted on the trailer the run cut (with your review edits), plus the intro card: the length its steps are then charged on, whether your edits made it longer or shorter. A recording with no known length is estimated at Edit Plan's 180-minute ceiling.

| Recording | Settings | Estimate |
|---|---|---|
| 60-min video | three formats (the default) | 25<!-- credits: elevenlabs-stt --> + 286<!-- credits: edit-plan:trailer:standard:60m --> + 11<!-- credits: apply-edl@1 --> + 66<!-- credits: 3*social-media-format --> + 11<!-- credits: use-case-fee:episode-trailer --> = **399**<!-- credits: elevenlabs-stt + edit-plan:trailer:standard:60m + apply-edl@1 + 3*social-media-format + use-case-fee:episode-trailer --> |
| 60-min video | three formats, a 10-second intro card | 25<!-- credits: elevenlabs-stt --> + 286<!-- credits: edit-plan:trailer:standard:60m --> + 11<!-- credits: apply-edl@1 --> + 110<!-- credits: combine-videos@10 --> + 66<!-- credits: 3*social-media-format --> + 11<!-- credits: use-case-fee:episode-trailer --> = **509**<!-- credits: elevenlabs-stt + edit-plan:trailer:standard:60m + apply-edl@1 + combine-videos@10 + 3*social-media-format + use-case-fee:episode-trailer --> (Combine Videos on 40 + 10 seconds: 10 started 5-second blocks) |
| 60-min video | three formats, Review before render (the preview) | 25<!-- credits: elevenlabs-stt --> + 286<!-- credits: edit-plan:trailer:standard:60m --> + 2<!-- credits: apply-edl:proxy@1 --> + 11<!-- credits: use-case-fee:episode-trailer --> = **324**<!-- credits: elevenlabs-stt + edit-plan:trailer:standard:60m + apply-edl:proxy@1 + use-case-fee:episode-trailer -->; then Render final of the 35-second trailer the run cut, with no edits: 11<!-- credits: apply-edl@1 --> + 66<!-- credits: 3*social-media-format --> = **77**<!-- credits: apply-edl@1 + 3*social-media-format -->, no fee |
| 60-min video | three formats, Review before render, edits that make the trailer 90 seconds long | Render final of the edited 90 seconds: 22<!-- credits: apply-edl@2 --> + 66<!-- credits: 3*social-media-format --> = **88**<!-- credits: apply-edl@2 + 3*social-media-format -->, no fee |

### Steps after the node

A node wired to **Trailers** on an Each wire runs once per format and is charged once per format: an [Add Captions](./add-captions.md) after a three-format Trailer is charged three times. A step priced by the length of the video it is given ([Trim](./trim-video.md#credit-cost), [Loop](./loop-video.md#credit-cost), [Combine Videos](./combine-videos.md#credit-cost), [Video SFX](../ai-video/video-sfx.md#credit-cost)) is estimated at the trailer's 40 seconds plus the intro card (at Render final, at the length of the trailer the run cut, with your review edits), and charged at the length that was rendered.

## API

`POST /v1/episode-trailer` with `{ mediaUrls: [<recording URL>], introCardUrl?, formats?: ["9:16" | "1:1" | "4:5" | "16:9", …], reviewBeforeRender?, planTier?, instructions?, styleGuide? }` starts a run and answers `202 { jobId, executionId }`. An empty `formats` list is refused `400 validation_error` ("Choose at least one format") before anything is written; leave `formats` out for the default three. Poll the job (`GET /v1/jobs/:id/status`). Its `output_data` carries the trailers (`formats`: `[{ format, url }]`, in format order), the trailer of the first chosen format that rendered as `videoUrl` (`formats[0]`, what a single-value read gets), the formats that could not be rendered (`failedFormats`, only when there are some), the edit (`json`), the transcript (`transcript`) and `quality` (`proxy` for a review run's preview, `final` otherwise). A review run's preview has no formats yet: its `formats` is `[]` and `videoUrl` is the preview. A failed run keeps what completed and names the step that failed (`failedStep`); a run that completes without some of its formats names them on `failedFormats` only. An `Idempotency-Key` header makes a retry of the same request answer with the same `jobId` and `"deduped": true`, starting nothing. `POST /v1/episode-trailer/estimate` takes the same body and answers the estimate as `{ data: { totalCredits, stepsCredits, feeCredits, durationSec } }` without starting anything (the credit figures are 0 on an edition without credits).

`POST /v1/episode-trailer/continue` with `{ jobId, mode }` continues one of your runs: `"mode": "from-failed"` runs what a failed run did not complete, and `"mode": "render-final"` (with `editedEdl`, your edit of the plan, optional) renders a review run's final: the trailer at full quality, the intro card and every format. Its refusals are in [API integration](../../api-integration.md) (the continuation codes, including `continuation_not_failed`, `continuation_settling`, `continuation_superseded` and `already_running`); a Render final of a run that was not a preview is refused `render_final_not_preview`, and one of an edit that was already rendered `render_final_already_rendered`.

The [SDK](../../sdk-reference.md) (`client.edit.episodeTrailer`, `client.edit.estimateEpisodeTrailer`, `client.edit.continueUseCase`), the [CLI](../../cli.md) (`nodaro edit episode-trailer`, `nodaro edit continue-use-case`) and MCP (`make_trailer`, `continue_use_case`) call the same routes.

## Common Use Cases

- A teaser of a new episode for Instagram Reels, TikTok and YouTube Shorts, and a square and a portrait feed post, from one run.
- A landscape trailer (16:9) for X or a website, opening on the show's intro card.

## Tips

- Use **Instructions** to steer the moments ("open on the funniest moment", "no spoilers from the last ten minutes").
- Turn on **Review before render** to check the cut before every format is rendered.
- Wire **Trailers** into a publishing node on an Each wire: each format is posted once.
