# Clip Pack

> Cut a podcast or interview recording into a pack of short clips in one step: find the best moments, render each as its own clip, framed for social and captioned.

**Not yet enabled on nodaro.ai.** The node is built and documented, but it is hidden on nodaro.ai until it is switched on; until then it is not offered in the editor, in `GET /v1/nodes` or as an MCP tool, and its routes refuse a run.

**Needs nodaro.ai on a self-hosted install.** Its planning step (and, with framing, its render) runs on nodaro.ai. On a self-hosted install, connect your instance to nodaro.ai (Integrations → nodaro.ai, or paste an API key) and the node runs those steps there. Without a connection the node is not listed among the available nodes (`GET /v1/nodes`), and a run is refused before anything starts: `503` with the code `nodaro_connection_required`, no job created. Transcribe uses the install's own ElevenLabs key, or the connection when there is none.

## Overview

Clip Pack takes one recording (or, with [several cameras](#several-cameras), the cameras of one conversation) and returns a pack of short clips. Inside, it runs the same steps you can wire by hand — [Transcribe](../ai-text/transcribe.md) (speakers labelled, word timings), [Edit Plan](./edit-plan.md) in Clips mode, then once per clip a render ([Speaker View](./speaker-view.md) with framing, [Apply EDL](./apply-edl.md) without) and [Add Captions](./add-captions.md) when captions are on. Each step runs as its own job, so a long recording, a cancel or a failure behaves as it does in a hand-built workflow.

- **The plan picks the moments.** Edit Plan finds up to **Clips** moments of about **Target length** each, and gives each a title and a hook. It may find fewer than you asked for: the pack holds the clips it found, and is charged for those renders only.
- **Every clip is tried.** A clip that cannot be rendered is skipped, and the pack keeps the others (see [If a run fails](#if-a-run-fails)).
- **Each clip is captioned on its own transcription**, so the captions follow the clip's own words.

The **Clip Pack** template in the template marketplace is the same chain built by hand, without framing, ready to fill (see [Edit Plan](./edit-plan.md)). Use it, or the individual nodes, when you need more control over a step. The **Clip Pack in One Node** template is this node instead, wired to a recording with [Review before render](#review-before-render) on, 8 clips of about 60 seconds framed 9:16 Stacked and karaoke captions: a run stops at a preview of each clip, and **Render final** renders the clips you keep at full quality.

## Inputs

| Handle | Type | Required | Description |
|---|---|---|---|
| Recordings (`media`) | Video or audio | Yes | The episode recording, up to 3 hours. It must have sound. An audio recording makes audio clips, with no framing and no captions. With [several cameras](#several-cameras), each camera's recording. |
| Master audio (`masterAudio`) | Audio | No | [Several cameras](#several-cameras): the mixer or recorder track, the pack's sound. |

A longer recording (when its length can be read), or one with no sound, is refused before anything is charged.

With more than one recording wired into `media`, the recordings are taken in the order the node's `mediaOrder` setting names (a list of the wired nodes' ids), else in the order they were wired: the first is Camera 1. Where Speaker Map is available to you, each clip cuts between all of them (see [Several cameras](#several-cameras)). Where it is not — on nodaro.ai today — a run reads the first recording only and ignores the others and any Master audio, exactly as before: the same run, the same estimate, nothing refused. The settings panel then says so; where Speaker Map is available, it shows a **Cameras** section instead. An audio recording first and a camera after it make video clips for a run that reads both, and audio clips for one that reads the first alone.

## Outputs

| Handle | Type | Description |
|---|---|---|
| Clips (`clips`) | Video or audio (a list) | One clip per clip the plan found, in the plan's order, each its own result. On an **Each** wire (the default) the next node runs once per clip; on a **Last** wire it reads the first clip. Audio clips for an audio recording. |
| Clip set (EDLs) (`json`) | EDL | The plan's clip set: one EDL per kept clip, each with its title and hook, with your review edits applied. |

The node shows one chip per clip, with its thumbnail and its title (the hook shows when you hover it). A clip whose captions could not be added is marked **No captions**.

## Configuration

| Setting | Options | Default | Notes |
|---|---|---|---|
| Clips | 1–50 | 8 | How many clips to find. The plan may find fewer. |
| Target length (seconds) | 5–180 | 60 | Each clip's target length. |
| Framing | None — the recording's shape, or a shape (16:9, 9:16, 1:1, 4:5) + a layout, a switch and an emphasis | 9:16, Stacked, Pan, Scale | Video recordings. Renders each clip with [Speaker View](./speaker-view.md) on automatic boxes, and every clip is boxed alike, over the episode's speakers: the speakers the transcript names who talk for at least 10 seconds, or for at least 5% of the episode's talk time, regardless of who is on screen in that clip. It needs 2–6 such speakers in the episode, on one camera; otherwise the clips show the camera full frame (see Speaker View's **Split the camera by speaker**). Only the layouts Speaker View draws at the chosen shape are offered. **Switch** is what happens at each speaker change; **Emphasis** (Scale, Border, Dim, any together, or none) marks who is talking. Through the API a framing without a layout is Stacked. **None** renders each clip with Apply EDL at the recording's shape. |
| Framing source | Automatic (follow faces) / Even split / Follow faces | Automatic on a new node; Even split on a node saved without one | Shown with a framing chosen. See [Following faces](#following-faces). |
| Captions | On / Off, with a caption style | On, Karaoke (kinetic) | Video recordings only. Each clip is captioned on its own transcription. |
| Review before render | On / Off | Off | On: the run stops at quick previews of the clips you can review and edit; **Render final** then makes the full-quality clips. See [Review before render](#review-before-render). |
| Editing quality | Economy / Standard / Premium | Standard | The Edit Plan tier. |
| Instructions, Style guide | Text (up to 4,000 characters each) | — | Passed to the plan ("the funniest moments"). |

## Following faces

With a framing chosen, **Framing source** says where the speakers' boxes come from:

- **Even split** — the automatic boxes above: each speaker on screen gets an even share of the frame, the same boxes on every clip. A node saved before the setting existed has none and runs the even split, as it always did.
- **Follow faces** — [Speaker Frames](./speaker-frames.md) tracks each face once, over the whole pack (one run over every clip the plan cut, never one per clip, charged per started block of 1,000 sampled frames), and every clip's Speaker View follows it. Faces aren't named after a speaker yet: a camera that shows one person is followed; a camera shared by several speakers is framed by the even split.
- **Automatic** — a new node's default: follows faces while Speaker Frames is available to you, else the even split, with no refusal and nothing extra charged. Its estimate follows the same rule, and so does a published app's or template's listed price (priced as any user would run it, whoever published it).

Speaker Frames needs nodaro.ai on a self-hosted install, as Speaker View does. Where Speaker Frames is not available to you, the panel offers no framing source (Automatic is then the even split); a node set to **Follow faces** shows a note instead, and a run of it is refused before anything is charged: `403 node_not_available`, naming Speaker Frames — as is a request over the API, the SDK, the CLI or MCP that sends `framingSource: "tracking"`.

With **Review before render** on, the tracks are made before the review, on the clips the plan cut: **Render final** reads them as they are and does not run Speaker Frames again. On [several cameras](#several-cameras), Speaker Frames samples every camera of the switched clips (not the Master audio).

## Several cameras

**Not yet enabled on nodaro.ai.** Several recordings and a Master audio need [Speaker Map](../processing-audio/speaker-map.md), which works out who is on which camera and is not yet available on nodaro.ai. Until it is, a run in the editor, an app or a workflow reads its first recording only (see [Inputs](#inputs)), a published app's or template's listed price is that of its first recording (a listing is priced as any user would run it, whoever published it), and a request over the API, the SDK, the CLI or MCP that sends several recordings or a Master audio is refused before anything is probed or charged: `403 node_not_available`.

Wire each camera's recording into **Recordings** and, when you have one, the mixer or recorder track into **Master audio**. The run then lines the recordings up, transcribes the sound, works out which camera each speaker is on and plans the clips over every recording; then, once per clip, [Camera Switch](./camera-switch.md) puts each moment of that clip on whoever is talking, and the clip renders and is captioned exactly as on one recording.

- **Recordings.** 1–6 recordings of one conversation, in order: Camera 1, Camera 2… Drag them in the panel's **Recordings** list to reorder (`mediaOrder`). One of them may be sound only (only one, and none beside a Master audio).
- **Master audio.** The pack's sound and the clock the recordings are lined up to. Up to 6 recordings in all, Master audio included. **Without Master audio** the sound is the wide camera's own sound (else Camera 1's), so the sound never jumps between camera microphones; two or more cameras then keep one place for it, so up to 5 cameras. One camera with a Master audio is lined up to it and cut on that one camera. A Master audio wired from the same node as one of the cameras is that camera's own sound: the node runs as without one.
- **Wide camera.** The camera that shows everyone. A speaker with no camera of their own is shown on it, and it is never a speaker's camera. None by default.
- **Recordings already in sync.** On when every recording already shares one clock: the run skips lining them up (no Audio Sync step).
- **Who is on which camera.** By default [Speaker Map](../processing-audio/speaker-map.md) decides it from the cameras' own microphones: the camera that hears a speaker loudest is theirs. A speaker no camera clearly leads for has **no clear camera** and is shown on the wide camera (else any camera that filmed them); the node then says so under its result, and so does the run's report. Set a speaker to a camera, or to the wide shot, to override the automatic map. **Speaker 1 is the first voice heard**, Speaker 2 the next, and so on.
- **The report.** The run's result names who was put on which camera (`output_data.cameras`: each speaker, the camera it got, `null` for the wide shot, and how far its camera led the next), with the line-up and map notes.
- **Every clip is tried.** Camera Switch runs once per clip, and a clip whose camera switch fails is skipped and not charged, like a clip that fails to render: the pack keeps the others and counts it on `failedClips`.
- **If a multicam step fails.** Audio Sync and Speaker Map come before every clip: when one fails, no clip is made and the run fails (its fee refunded); **Continue** runs the step that failed and the ones after it.
- **Review before render.** **Render final** of a reviewed pack on several cameras runs Camera Switch again on each clip you kept, then its render and its captions.

The run's own refusals (`400`), before anything is charged: two sound-only recordings, or one with a Master audio (`recordings_two_audio_only`); more recordings than above (`too_many_recordings`); a wide camera that is not one of the recordings with picture (`wide_camera_out_of_range`); Cameras settings that are not valid (`invalid_cameras`). Cameras settings on a run of one recording with no Master audio are ignored.

## Review before render

With **Review before render** on, a run stops at a preview of each clip: each render is a Preview (Speaker View's or Apply EDL's lower preview rate, private and 720p), and the captions are not added yet. Open the review inspector: it shows every clip as a card, where you keep or drop it and edit its hook. Then press **Render final**: it renders only the clips you kept, at full quality, and captions each, once, with no fee.

- **Keep at least one clip.** With every clip dropped, **Render final** is disabled ("Keep at least one clip to render."), and the API refuses such a Render final with `409` and the code `use_case_nothing_kept` ("Every clip was dropped in the review: keep at least one clip to render the final."), before anything is held or charged — through `POST /v1/clip-pack/continue`, and through an app run's Render final whose stored review drops every clip (a review written on the run through the API, `PATCH /v1/app/:slug/runs/:runId` — see [API integration](../../api-integration.md#render-final-of-an-app-run)).
- **Render final uses the settings the previews were made with.** To change a setting (the framing, say), run the node again.
- **Render final again (in the editor, or `POST /v1/clip-pack/continue`).** Once a Render final has finished, you can edit the review again and render it final again: the kept clips' renders and their captions run and are charged again, with no fee. Rendering the same edit a second time is refused, and one Render final runs at a time.
- **In a published app.** A Clip Pack with Review before render on shows its previews on the app's page, with a **Render final** button that renders every clip at full quality (an app's page has no review inspector, so the page itself drops no clip; only a review stored on the run through the API can), as an Apply EDL render does (see [App view modes](../../app-view-modes.md#render-final)). There, once a final has been made, another Render final of the same run is refused (`render_final_not_preview`).
- **What follows the node.** This follows the preview stop rule, as a render set to Preview does (`PREVIEW_STOP_RULE_ENABLED`, off by default and not yet on for Nodaro Cloud — see [Apply EDL](./apply-edl.md#a-run-stops-at-a-preview)). Where it is on, the nodes after the node wait for its Render final and are not charged in that run. Where it is off, the node still stops at its previews, but the nodes after it run on the previews, and are charged, and run again on the final clips at Render final.
- **Someone has to review.** In a workflow or app run with nobody to review it — started from the API, the SDK, MCP's `run_workflow` or a trigger rather than the editor or the app's own page, or run inside a component — a node with Review before render on cannot run, and you should turn Review before render off for those runs. Where the preview stop rule is on, such a run is refused before anything runs or is charged (`preview_review_required`; publishing or running a component that holds one, `preview_render_nested`), with a message telling you to turn Review before render off. A run refused once it has started records what held it: `preview_review_required_review_on` (`preview_render_nested_review_on` inside a sub-workflow or component), or `preview_review_required_mixed` (`preview_render_nested_mixed`) when an Apply EDL render set to Preview holds it too. Where the rule is off, the run is not refused up front: the nodes before the node run and are charged, and the node then fails with `preview_review_required` and the same message, with nothing charged for it. (MCP's own `make_clip_pack` and `continue_use_case` tools are reviewed by the agent that calls them, and can use Review before render.)

## If a run fails

- **A clip that could not be rendered** (or, on [several cameras](#several-cameras), whose camera switch failed). The run completes with the clips that rendered and keeps its fee; the node says how many could not be rendered ("1 clip could not be rendered."), and the API counts them on `failedClips`. A clip that failed is not charged. The run completed, so it has no **Continue**. Two ways to get the missing clip:
  - **The same clip, no fee:** render it yourself from the node's **Clip set (EDLs)** output — wire it into an [Apply EDL](./apply-edl.md) (or a [Speaker View](./speaker-view.md) for the framed look) with the wire's selection set to that clip (each clip's EDL names the recording), then an [Add Captions](./add-captions.md) if you want captions. Each step is charged at its own rate, with no per-run fee.
  - **A new run:** run the node again. This is a whole new run: every step is charged again, including the per-run fee, and the new plan may pick different moments.
- **Captions that could not be added to a clip.** The clip is delivered uncaptioned and marked **No captions** ("Captions could not be added to these clips."); the API marks it `captionsFailed` and counts such clips on `failedCaptions`. Captions that failed are not charged.
- **No clip rendered.** The run fails and its per-run fee is refunded. The message gives the count and the reason, for example "None of the 8 clips could be rendered: …".
- **The plan found no clips.** The run fails with "The plan found no clips in this recording.", nothing is rendered and its per-run fee is refunded.
- **A run that stopped before its captions ran** (the clips rendered, the captions step did not run) fails, and its per-run fee is refunded. Press **Continue**: it captions the clips already rendered, without rendering them again.
- **Any other failed run.** The steps that finished stay finished: their results (the transcript, the plan, the clips already rendered) are kept and they are not charged again. Press **Continue** on the node: only the step that failed and the ones after it run again.

## Not once per list item

A Clip Pack takes the recordings of one conversation, and its result is already a list (one entry per clip). A Clip Pack fed by a List is refused before any of its runs starts, whatever its Review before render setting, with nothing charged for it (`use_case_list_driven`): "Clip Pack takes the recordings of one conversation. Use a separate workflow run for each episode."

## Credit Cost

Clip Pack is charged **its steps at their own rates, plus a per-run fee of 11 credits**<!-- credits: use-case-fee:clip-pack -->:

- Transcribe (`elevenlabs-stt`): 25 credits<!-- credits: elevenlabs-stt -->
- Edit Plan, Clips mode: the Edit Plan rate for the recording's length and tier — standard: 22 credits<!-- credits-rate: edit-plan:clips:standard:flat --> plus 4.4<!-- credits-rate: edit-plan:clips:standard:per-minute --> credits per source minute (see [Edit Plan](./edit-plan.md#credit-cost) for the other tiers and how the minutes are counted)
- Per clip, the render, per minute of the clip:
  - with framing, Speaker View: 13.2 credits<!-- credits-rate: speaker-view:complex --> per minute in its Complex tier, 11 credits<!-- credits-rate: speaker-view --> in its Standard tier (at most two speakers on screen and no zoom, as the default Stacked framing of two speakers is) — a Preview at 3.3<!-- credits-rate: speaker-view:complex:proxy --> or 2.2<!-- credits-rate: speaker-view:proxy --> credits per minute; see [Speaker View](./speaker-view.md#credit-cost)
  - without framing (and for an audio recording), Apply EDL: 11 credits<!-- credits-rate: apply-edl --> per minute (a Preview: 1.1 credits<!-- credits-rate: apply-edl:proxy --> per minute); see [Apply EDL](./apply-edl.md#credit-cost)
- Per clip, Add Captions (when on): 55 credits<!-- credits: add-captions:kinetic -->
- With framing [following faces](#following-faces), Speaker Frames, once for the whole pack: 2.2<!-- credits-rate: speaker-frames --> credits per started block of 1,000 sampled frames, the run's total rounded up once. The estimate counts the episode's length plus 2 seconds at each end, at 2 frames per second, on each camera (see [Speaker Frames](./speaker-frames.md#credit-cost)); the run is charged for the clips' own frames.
- [Several cameras](#several-cameras) (not yet enabled on nodaro.ai): [Audio Sync](../processing-audio/audio-sync.md) over the sound and each camera, 11<!-- credits-rate: audio-sync:2src --> credits for each recording it lines up to the sound (none when the recordings are already in sync), and [Speaker Map](../processing-audio/speaker-map.md), 11 credits<!-- credits: speaker-map -->, once for the pack; per clip, with two or more cameras, [Camera Switch](./camera-switch.md), 11 credits<!-- credits: camera-switch -->. Edit Plan is priced at the sound's length.
- **Plus the per-run fee of 11 credits<!-- credits: use-case-fee:clip-pack -->.** A Render final after a review is not charged the fee again. A failed run's fee is refunded, and **Continue** holds it again, so a run is charged its fee once. A run that keeps some of its clips is charged the fee.

You are charged for each clip's own length, not for the estimate: each clip's render is billed at that clip's minutes (rounded up on its own) and its tier, and a clip that was not rendered, whose camera switch failed, or whose captions were not added, is not charged for them.

### What the estimate shows before you run

The estimate prices each clip at **twice the target length**, so it leans high: at the default 60 seconds, each clip's render is quoted at 2 minutes. With framing, Speaker View is quoted at its Complex rate, the previews and Render final included; a clip with at most two speakers on screen and no zoom is charged the Standard rate. It counts the clips you asked for (the plan may find fewer). After the previews, Render final is quoted on the clips the run cut that you kept, each at its own length. A recording with no known length is estimated at Edit Plan's 180-minute ceiling.

| Recording | Settings | Estimate |
|---|---|---|
| 60-min video | 8 clips of 60 seconds, the default framing (9:16, Stacked) and captions | 25<!-- credits: elevenlabs-stt --> + 286<!-- credits: edit-plan:clips:standard:60m --> + 8 × 27<!-- credits: speaker-view:complex@2 --> = 216<!-- credits: 8*speaker-view:complex@2 --> + 8 × 55<!-- credits: add-captions:kinetic --> = 440<!-- credits: 8*add-captions:kinetic --> + 11<!-- credits: use-case-fee:clip-pack --> = **978**<!-- credits: elevenlabs-stt + edit-plan:clips:standard:60m + 8*speaker-view:complex@2 + 8*add-captions:kinetic + use-case-fee:clip-pack --> |
| 60-min video | 8 clips of 60 seconds, Framing None (the template's chain), captions on | 25<!-- credits: elevenlabs-stt --> + 286<!-- credits: edit-plan:clips:standard:60m --> + 8 × 22<!-- credits: apply-edl@2 --> = 176<!-- credits: 8*apply-edl@2 --> + 440<!-- credits: 8*add-captions:kinetic --> + 11<!-- credits: use-case-fee:clip-pack --> = **938**<!-- credits: elevenlabs-stt + edit-plan:clips:standard:60m + 8*apply-edl@2 + 8*add-captions:kinetic + use-case-fee:clip-pack --> |
| 60-min video | 8 clips of 60 seconds, the default framing, Review before render (the previews) | 25<!-- credits: elevenlabs-stt --> + 286<!-- credits: edit-plan:clips:standard:60m --> + 8 × 7<!-- credits: speaker-view:complex:proxy@2 --> = 56<!-- credits: 8*speaker-view:complex:proxy@2 --> + 11<!-- credits: use-case-fee:clip-pack --> = **378**<!-- credits: elevenlabs-stt + edit-plan:clips:standard:60m + 8*speaker-view:complex:proxy@2 + use-case-fee:clip-pack -->; then Render final of the 8 clips of 55 seconds the run cut, all kept: 8 × 14<!-- credits: speaker-view:complex@1 --> = 112<!-- credits: 8*speaker-view:complex@1 --> + 440<!-- credits: 8*add-captions:kinetic --> = **552**<!-- credits: 8*speaker-view:complex@1 + 8*add-captions:kinetic -->, no fee |
| 60-min video | the same, with 5 of the 8 clips kept in the review | Render final of the 5 kept clips: 5 × 14<!-- credits: speaker-view:complex@1 --> = 70<!-- credits: 5*speaker-view:complex@1 --> + 5 × 55<!-- credits: add-captions:kinetic --> = 275<!-- credits: 5*add-captions:kinetic --> = **345**<!-- credits: 5*speaker-view:complex@1 + 5*add-captions:kinetic -->, no fee |
| 60-min video | 8 clips of 60 seconds, the default framing [following faces](#following-faces), captions on | 25<!-- credits: elevenlabs-stt --> + 286<!-- credits: edit-plan:clips:standard:60m --> + 18<!-- credits: speaker-frames@8 --> + 216<!-- credits: 8*speaker-view:complex@2 --> + 440<!-- credits: 8*add-captions:kinetic --> + 11<!-- credits: use-case-fee:clip-pack --> = **996**<!-- credits: elevenlabs-stt + edit-plan:clips:standard:60m + speaker-frames@8 + 8*speaker-view:complex@2 + 8*add-captions:kinetic + use-case-fee:clip-pack --> (Speaker Frames once for the pack: 3,604 seconds × 2 = 7,208 frames, 8 blocks) |
| 60-min, two cameras + Master audio ([several cameras](#several-cameras)) | 8 clips of 60 seconds, the default framing and captions | 25<!-- credits: elevenlabs-stt --> + 286<!-- credits: edit-plan:clips:standard:60m --> + 22<!-- credits: audio-sync:3src --> + 11<!-- credits: speaker-map --> + 8 × 11<!-- credits: camera-switch --> = 88<!-- credits: 8*camera-switch --> + 216<!-- credits: 8*speaker-view:complex@2 --> + 440<!-- credits: 8*add-captions:kinetic --> + 11<!-- credits: use-case-fee:clip-pack --> = **1099**<!-- credits: elevenlabs-stt + edit-plan:clips:standard:60m + audio-sync:3src + speaker-map + 8*camera-switch + 8*speaker-view:complex@2 + 8*add-captions:kinetic + use-case-fee:clip-pack --> (Audio Sync over three sources: the Master audio and two cameras; Camera Switch once per clip) |
| 60-min, two cameras + Master audio | the same, [following faces](#following-faces) | the row above + 33<!-- credits: speaker-frames@15 --> = **1132**<!-- credits: elevenlabs-stt + edit-plan:clips:standard:60m + audio-sync:3src + speaker-map + 8*camera-switch + speaker-frames@15 + 8*speaker-view:complex@2 + 8*add-captions:kinetic + use-case-fee:clip-pack --> (Speaker Frames once for the pack, on both cameras: 2 × 7,208 = 14,416 frames, 15 blocks) |

### Steps after the node

A node wired to **Clips** on an Each wire runs once per clip and is charged once per clip: a [Social Media Format](./social-media-format.md) after an 8-clip pack is charged eight times. The estimate counts the clips you asked for; the run charges the clips that were delivered.

## API

`POST /v1/clip-pack` with `{ mediaUrls: [<recording URL>, …], masterAudioUrl?, cameras?, count?, targetDurationSec?, framing?: { aspect, layout?, switchType?, emphasisStyle? } | null, framingSource?: "auto" | "static" | "tracking", captions?, captionStyle?, reviewBeforeRender?, planTier?, instructions?, styleGuide? }` starts a run and answers `202 { jobId, executionId }`. `mediaUrls` holds one recording, or up to six of one conversation in order with `masterAudioUrl` and `cameras: { wide?: <recording number> | null, synced?: boolean, speakerCameras?: { "<speaker number>": <recording number, 0 = the wide shot> } }` — see [Several cameras](#several-cameras). **Several recordings or a Master audio need Speaker Map**, not yet enabled on nodaro.ai: until then they are refused `403 node_not_available` before anything is probed or charged; the node list (`GET /v1/nodes`) and the body schema show the fields to everyone. `framingSource` left out is the even split (see [Following faces](#following-faces)). Leave `framing` out for the default (9:16, Stacked, Pan, Scale); a framing without a `layout` is Stacked, and `null` renders the recording's shape. An `emphasisStyle` the node does not draw is refused `400 validation_error`. Poll the job (`GET /v1/jobs/:id/status`). Its `output_data` carries the clips (`clips`: `[{ url, title?, hook?, clipKey, thumbnailUrl?, captionsFailed? }]`, in the plan's order; `thumbnailUrl` on each video clip), the first clip as `videoUrl` (`audioUrl` for audio clips; what a single-value read gets), how many clips could not be rendered (`failedClips`, a clip whose camera switch failed included) and how many came uncaptioned (`failedCaptions`), each only when there are some, the plan's clip set (`json`), the transcript (`transcript`) and `quality` (`proxy` for a review run's previews, `final` otherwise); a run on several recordings or a Master audio adds `cameras` (`{ speakers: [{ speaker, ordinal, camera, marginDb }], syncNotes, mapNotes }`; `camera` is the recording number, `null` for the wide shot). A failed run keeps what completed and names the step that failed (`failedStep`); a run that completes without some clips or captions counts them on `failedClips` and `failedCaptions` only. An `Idempotency-Key` header makes a retry of the same request answer with the same `jobId` and `"deduped": true`, starting nothing. `POST /v1/clip-pack/estimate` takes the same body and answers the estimate as `{ data: { totalCredits, stepsCredits, feeCredits, durationSec } }` without starting anything (the credit figures are 0 on an edition without credits).

`POST /v1/clip-pack/continue` with `{ jobId, mode }` continues one of your runs: `"mode": "from-failed"` runs what a failed run did not complete, and `"mode": "render-final"` (with `editedEdl`, your review of the clip set, optional: which clips to keep, and their hooks) renders a review run's kept clips at full quality and captions them. A review that drops every clip is refused `409 use_case_nothing_kept`. Its other refusals are in [API integration](../../api-integration.md) (the continuation codes, including `continuation_not_failed`, `continuation_settling`, `continuation_superseded` and `already_running`); a Render final of a run that was not a preview is refused `render_final_not_preview`, and one of an edit that was already rendered `render_final_already_rendered`.

The [SDK](../../sdk-reference.md) (`client.edit.clipPack`, `client.edit.estimateClipPack`, `client.edit.continueUseCase`), the [CLI](../../cli.md) (`nodaro edit clip-pack`, `nodaro edit continue-use-case`) and MCP (`make_clip_pack`, `continue_use_case`) call the same routes.

## Common Use Cases

- A week of vertical, captioned clips for Instagram Reels, TikTok and YouTube Shorts from one episode.
- Audio snippets of an audio-only podcast to share as previews.
- A shortlist of moments to pick from: turn on **Review before render**, keep the best, and render only those.

## Tips

- Use **Instructions** to steer the moments ("the funniest moments", "only the part about pricing").
- Turn on **Review before render** to drop weak clips and sharpen their hooks before anything renders at full quality.
- Wire **Clips** into a publishing node on an Each wire: each clip is posted once.
