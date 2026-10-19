# Tighten Episode

> Tighten a podcast or interview recording in one step: transcribe it, remove silences and filler, cut the episode, and optionally add captions and a music bed.

**Needs nodaro.ai on a self-hosted install.** Its planning step (and, with framing, its render) runs on nodaro.ai. On a self-hosted install, connect your instance to nodaro.ai (Integrations → nodaro.ai, or paste an API key) and the node runs those steps there. Without a connection the node is not listed among the available nodes (`GET /v1/nodes`), and a run is refused before anything starts: `503` with the code `nodaro_connection_required`, no job created. Transcribe uses the install's own ElevenLabs key, or the connection when there is none.

## Overview

Tighten Episode takes one recording and returns the tightened episode. Inside, it runs the same steps you can wire by hand — [Transcribe](../ai-text/transcribe.md) (speakers labelled, word timings), [Silence Detect](../processing-audio/silence-detect.md), [Edit Plan](./edit-plan.md) in Tighten mode, and [Apply EDL](./apply-edl.md) — plus [Add Captions](./add-captions.md) and a music bed ([Mix Audio](../processing-audio/mix-audio.md), then [Merge Video & Audio](../processing-audio/merge-video-audio.md) on a video episode) when you turn them on. Each step runs as its own job, so a long episode, a cancel or a failure behaves as it does in a hand-built workflow.

It can also cut a conversation filmed on [several cameras](#several-cameras) (not yet enabled on nodaro.ai). Use the individual nodes (Edit Plan, Apply EDL, Camera Switch, Speaker View…) when you need more control: a hand-edited EDL, clips or chapters. The **Tighten Episode** template in the template marketplace is that hand-built chain, ready to fill. The **Tighten Episode in One Node** template is this node instead, wired to an episode recording with [Review before render](#review-before-render) on and word-highlight captions: a run stops at a preview of the cut, and **Render final** renders the full-quality episode.

## Inputs

| Handle | Type | Required | Description |
|---|---|---|---|
| Recordings (`media`) | Video or audio | Yes | The episode recording, up to 3 hours. It must have sound. An audio recording makes an audio episode. With [several cameras](#several-cameras), each camera's recording. |
| Music (`music`) | Audio | No | A music bed. It dips under the voice while someone speaks and ends when the episode ends. |
| Master audio (`masterAudio`) | Audio | No | [Several cameras](#several-cameras): the mixer or recorder track, the episode's sound. |

A longer recording (when its length can be read), one with no sound, or a music file that cannot be read as audio is refused before anything is charged.

With more than one recording wired into `media`, the recordings are taken in the order the node's `mediaOrder` setting names (a list of the wired nodes' ids), else in the order they were wired: the first is Camera 1. Where Speaker Map is available to you, the run cuts between all of them (see [Several cameras](#several-cameras)). Where it is not — on nodaro.ai today — a run reads the first recording only and ignores the others and any Master audio, exactly as before: the same run, the same estimate, nothing refused. The settings panel then says so; where Speaker Map is available, it shows a **Cameras** section instead (see [Several cameras](#several-cameras)).

## Outputs

| Handle | Type | Description |
|---|---|---|
| Episode (`media`) | Video or audio | The tightened episode. **Episode audio** on an audio episode. It carries the episode's length, so a step priced by the length of what it is given (Trim, Loop, Combine Videos, Video SFX, Pitch & Tempo) is priced by it: see [Steps after the node](#steps-after-the-node). |
| Edit (EDL) (`json`) | EDL | The edit plan the episode was cut from, with your review edits applied. Wire it into another render, for example a second [Apply EDL](./apply-edl.md) in another format. Wired into a text or prompt input, it lands there as its JSON text, in the editor as in a server run. It is JSON, not media: it does not connect to an input that takes only audio, video or images (wire the **Episode** there). |

## Configuration

| Setting | Options | Default | Notes |
|---|---|---|---|
| Episode | Video / Audio only | Video | An audio recording always makes an audio episode (the setting is then locked to Audio only). |
| Framing | None — the camera as recorded, or a shape (16:9, 9:16, 1:1, 4:5) + a layout | None | Video episodes. Renders the episode with [Speaker View](./speaker-view.md) instead of Apply EDL: when two to six speakers share the camera and the output is not 16:9, each speaker on screen gets an automatic box — the default boxes Speaker View's **Split the camera by speaker** deals; otherwise the camera is shown full frame. No face tracking is wired in. Only the layouts Speaker View draws at the chosen shape are offered. |
| Captions | On / Off, with a caption style | On, Word highlight | Video episodes only. |
| Review before render | On / Off | Off | On: the run stops at a quick preview you can review and edit; **Render final** then makes the full-quality episode. See [Review before render](#review-before-render). |
| Editing quality | Economy / Standard / Premium | Standard | The Edit Plan tier. |
| Instructions, Style guide | Text (up to 4,000 characters each) | — | Passed to the plan. |
| Music under speech | 0–100 | 75 | How far the music dips while someone speaks (Mix Audio's **Duck amount**). Shown when a music bed is connected. |

## Several cameras

**Not yet enabled on nodaro.ai.** Several recordings and a Master audio need [Speaker Map](../processing-audio/speaker-map.md), which works out who is on which camera and is not yet available on nodaro.ai. Until it is, a run in the editor, an app or a workflow reads its first recording only (see [Inputs](#inputs)), a published app's or template's listed price is that of its first recording (a listing is priced as any user would run it, whoever published it), and a request over the API, the SDK, the CLI or MCP that sends several recordings or a Master audio is refused before anything is probed or charged: `403 node_not_available`.

Wire each camera's recording into **Recordings** and, when you have one, the mixer or recorder track into **Master audio**. The run then lines the recordings up, transcribes the sound, works out which camera each speaker is on, plans the tightened cut, and puts each cut on whoever is talking — the [Multicam Cut](./camera-switch.md) chain, in one node.

- **Recordings.** 1–6 recordings of one conversation, in order: Camera 1, Camera 2… Drag them in the panel's **Recordings** list to reorder (`mediaOrder`). One of them may be sound only (a recorder track wired as a recording); only one.
- **Master audio.** The episode's sound and the clock the recordings are lined up to. Up to 6 recordings in all, Master audio included. **Without Master audio** the sound is the sound-only recording if there is one, else the wide camera's own sound (else Camera 1's), so the sound never jumps between camera microphones; two or more cameras then keep one place for it, so up to 5 cameras. One camera with a Master audio is lined up to it and cut on that one camera. A Master audio wired from the same node as one of the cameras is that camera's own sound: the node runs as without one.
- **Wide camera.** The camera that shows everyone. A speaker with no camera of their own is shown on it, and it is never a speaker's camera. None by default.
- **Recordings already in sync.** On when every recording already shares one clock: the run skips lining them up (no Audio Sync step).
- **Who is on which camera.** By default [Speaker Map](../processing-audio/speaker-map.md) decides it from the cameras' own microphones: the camera that hears a speaker loudest is theirs. A speaker no camera clearly leads for has **no clear camera** and is shown on the wide camera (else any camera that filmed them); the node then says so under its result, and so does the run's report. Set a speaker to a camera, or to the wide shot, to override the automatic map. **Speaker 1 is the first voice heard**, Speaker 2 the next, and so on.
- **The report.** The run's result names who was put on which camera (`output_data.cameras`: each speaker, the camera it got, `null` for the wide shot, and how far its camera led the next), with the line-up and map notes.
- **Audio episode.** An audio-only episode of several recordings is the sound's alone: no line-up, map or switch.
- **Framing.** With two or more cameras, a framed episode shows each camera's own shot; the automatic boxes over the speakers apply to one camera only.
- **Review before render.** **Render final** of a reviewed run on several cameras runs Camera Switch again on your edited cut, then the render and what follows.

The run's own refusals (`400`), before anything is charged: two sound-only recordings, or one with a Master audio (`recordings_two_audio_only`); more recordings than above (`too_many_recordings`); a wide camera that is not one of the recordings with picture (`wide_camera_out_of_range`); Cameras settings that are not valid (`invalid_cameras`). Cameras settings on a run of one recording with no Master audio are ignored.

## Review before render

With **Review before render** on, a run stops at a preview of the cut: the render is a Preview (Apply EDL's or Speaker View's lower preview rate), and captions and the music bed are not added yet. Review the cut and edit it in the review inspector, then press **Render final** on the node: it renders the episode at full quality with your edit, then adds the captions and the music bed, once.

- **Render final uses the settings the preview was made with.** To change a setting, run the node again.
- **Render final again (in the editor, or `POST /v1/tighten-episode/continue`).** Once a Render final has finished, you can edit the cut again and render it final again: the render and the steps after it run and are charged again, with no fee. Rendering the same edit a second time is refused, and one Render final runs at a time.
- **In a published app.** A Tighten Episode with Review before render on shows its preview on the app's page, with a **Render final** button, as an Apply EDL render does (see [App view modes](../../app-view-modes.md#render-final)). There, once a final has been made, another Render final of the same run is refused (`render_final_not_preview`).
- **What follows the node.** This follows the preview stop rule, as a render set to Preview does (`PREVIEW_STOP_RULE_ENABLED`, off by default and not yet on for Nodaro Cloud — see [Apply EDL](./apply-edl.md#a-run-stops-at-a-preview)). Where it is on, the nodes after the node wait for its Render final and are not charged in that run. Where it is off, the node still stops at its preview, but the nodes after it run on the preview, and are charged, and run again on the final episode at Render final.
- **Someone has to review.** In a workflow or app run with nobody to review it — started from the API, the SDK, MCP's `run_workflow` or a trigger rather than the editor or the app's own page, or run inside a component — a node with Review before render on cannot run, and you should turn Review before render off for those runs. Where the preview stop rule is on, such a run is refused before anything runs or is charged (`preview_review_required`; publishing or running a component that holds one, `preview_render_nested`), with a message telling you to turn Review before render off. A run refused once it has started records what held it: `preview_review_required_review_on` (`preview_render_nested_review_on` inside a sub-workflow or component), or `preview_review_required_mixed` (`preview_render_nested_mixed`) when an Apply EDL render set to Preview holds it too. Where the rule is off, the run is not refused up front: the nodes before the node run and are charged, and the node then fails with `preview_review_required` and the same message, with nothing charged for it. (MCP's own `tighten_episode` and `continue_use_case` tools are reviewed by the agent that calls them, and can use Review before render.)
- **Not once per list item.** Whatever the preview stop rule, a node with Review before render on that is fed by a List is refused before any of its runs starts, with nothing charged for it (`use_case_review_list_driven`): "Review before render isn't available when the node runs once per list item — turn it off to run the list."

## If a run fails

The steps that finished stay finished: their results (the transcript, the edit) are kept and they are not charged again. Press **Continue** on the node: only the step that failed and the ones after it run again. A node fed by a List runs once per item; it has no Continue or Render final — run it again.

When the workflow is [continued from where it failed](../../api-integration.md#continuing-a-failed-run) over the API, the node continues its own run the same way, but only while its recording, music bed and settings are still the ones that run used (a setting added to the node since that run counts as unchanged while it holds its default). If any of them changed (a corrected recording upstream, or a setting sent in the continuation's overrides), it runs again from the start on what it has now, and is charged its fee for that run.

## Credit Cost

Tighten Episode is charged **its steps at their own rates, plus a per-run fee of 11 credits**<!-- credits: use-case-fee:tighten-episode -->:

- Transcribe (`elevenlabs-stt`): 25 credits<!-- credits: elevenlabs-stt -->
- Silence Detect: 11 credits<!-- credits: silence-detect -->
- Edit Plan, Tighten mode: the Edit Plan rate for the recording's length and tier — standard: 4.4<!-- credits-rate: edit-plan:tighten:standard:per-minute --> credits per source minute (see [Edit Plan](./edit-plan.md#credit-cost))
- Apply EDL: 11 credits<!-- credits-rate: apply-edl --> per minute of the rendered episode (a Preview: 1.1 credits<!-- credits-rate: apply-edl:proxy --> per minute) — see [Apply EDL](./apply-edl.md#credit-cost)
- With framing, Speaker View instead of Apply EDL, at its own per-minute rates (see [Speaker View](./speaker-view.md#credit-cost))
- Add Captions (when on): 55 credits<!-- credits: add-captions:kinetic -->
- Music bed (when connected): Mix Audio 22 credits<!-- credits: mix-audio -->, plus Merge Video & Audio 22 credits<!-- credits: merge-video-audio --> on a video episode
- [Several cameras](#several-cameras) (not yet enabled on nodaro.ai): [Audio Sync](../processing-audio/audio-sync.md) over the sound and each camera, 11<!-- credits-rate: audio-sync:2src --> credits for each recording it lines up to the sound (none when the recordings are already in sync); [Speaker Map](../processing-audio/speaker-map.md), 11 credits<!-- credits: speaker-map -->, and [Camera Switch](./camera-switch.md), 11 credits<!-- credits: camera-switch -->, with two or more cameras. Edit Plan and the render are priced at the sound's length.
- **Plus the per-run fee of 11 credits<!-- credits: use-case-fee:tighten-episode -->.** A Render final after a review is not charged the fee again. A failed run's fee is refunded, and **Continue** holds it again, so a run is charged its fee once.

You are charged for the rendered episode's own minutes, not for the estimate.

### What the estimate shows before you run

The estimate prices the render at the recording's full length. The tightened cut is shorter, so the render is charged less than the estimate shows. A recording with no known length is estimated at the 180-minute ceiling. Render final's balance check uses the length of the plan's cut (with your edit: the length it is charged for), not the full recording; the estimate shown before the run is unchanged. With framing, Speaker View is estimated at its higher rate until the edit is known; a cut with at most two speakers on screen and no zoom is charged the lower one.

| Recording | Settings | Estimate |
|---|---|---|
| 60-min video | captions off, no music | 25<!-- credits: elevenlabs-stt --> + 11<!-- credits: silence-detect --> + 264<!-- credits: edit-plan:tighten:standard:60m --> + 660<!-- credits: apply-edl@60 --> + 11<!-- credits: use-case-fee:tighten-episode --> = **971**<!-- credits: elevenlabs-stt + silence-detect + edit-plan:tighten:standard:60m + apply-edl@60 + use-case-fee:tighten-episode --> |
| 60-min video | captions on | 25<!-- credits: elevenlabs-stt --> + 11<!-- credits: silence-detect --> + 264<!-- credits: edit-plan:tighten:standard:60m --> + 660<!-- credits: apply-edl@60 --> + 55<!-- credits: add-captions:kinetic --> + 11<!-- credits: use-case-fee:tighten-episode --> = **1026**<!-- credits: elevenlabs-stt + silence-detect + edit-plan:tighten:standard:60m + apply-edl@60 + add-captions:kinetic + use-case-fee:tighten-episode --> |
| 55-min audio | — | 25<!-- credits: elevenlabs-stt --> + 11<!-- credits: silence-detect --> + 264<!-- credits: edit-plan:tighten:standard:60m --> + 605<!-- credits: apply-edl@55 --> + 11<!-- credits: use-case-fee:tighten-episode --> = **916**<!-- credits: elevenlabs-stt + silence-detect + edit-plan:tighten:standard:60m + apply-edl@55 + use-case-fee:tighten-episode --> (Edit Plan at its 60-minute step; how the minutes are counted is on [Edit Plan](./edit-plan.md#credit-cost)) |
| 60-min video | captions on, Review before render (the preview) | 25<!-- credits: elevenlabs-stt --> + 11<!-- credits: silence-detect --> + 264<!-- credits: edit-plan:tighten:standard:60m --> + 66<!-- credits: apply-edl:proxy@60 --> + 11<!-- credits: use-case-fee:tighten-episode --> = **377**<!-- credits: elevenlabs-stt + silence-detect + edit-plan:tighten:standard:60m + apply-edl:proxy@60 + use-case-fee:tighten-episode -->; then Render final 660<!-- credits: apply-edl@60 --> + 55<!-- credits: add-captions:kinetic --> = **715**<!-- credits: apply-edl@60 + add-captions:kinetic -->, no fee |
| 60-min video | captions on, music bed | 1026<!-- credits: elevenlabs-stt + silence-detect + edit-plan:tighten:standard:60m + apply-edl@60 + add-captions:kinetic + use-case-fee:tighten-episode --> + 22<!-- credits: mix-audio --> + 22<!-- credits: merge-video-audio --> = **1070**<!-- credits: elevenlabs-stt + silence-detect + edit-plan:tighten:standard:60m + apply-edl@60 + add-captions:kinetic + use-case-fee:tighten-episode + mix-audio + merge-video-audio --> |
| 60-min video | captions on, framing 9:16 stacked | 25<!-- credits: elevenlabs-stt --> + 11<!-- credits: silence-detect --> + 264<!-- credits: edit-plan:tighten:standard:60m --> + 792<!-- credits: speaker-view:complex@60 --> + 55<!-- credits: add-captions:kinetic --> + 11<!-- credits: use-case-fee:tighten-episode --> = **1158**<!-- credits: elevenlabs-stt + silence-detect + edit-plan:tighten:standard:60m + speaker-view:complex@60 + add-captions:kinetic + use-case-fee:tighten-episode --> |
| 60-min video | framing 9:16 stacked, Review before render (the preview) | 25<!-- credits: elevenlabs-stt --> + 11<!-- credits: silence-detect --> + 264<!-- credits: edit-plan:tighten:standard:60m --> + 198<!-- credits: speaker-view:complex:proxy@60 --> + 11<!-- credits: use-case-fee:tighten-episode --> = **509**<!-- credits: elevenlabs-stt + silence-detect + edit-plan:tighten:standard:60m + speaker-view:complex:proxy@60 + use-case-fee:tighten-episode --> |
| 90-min, three cameras + Master audio ([several cameras](#several-cameras)) | captions off | 25<!-- credits: elevenlabs-stt --> + 11<!-- credits: silence-detect --> + 396<!-- credits: edit-plan:tighten:standard:90m --> + 33<!-- credits: audio-sync:4src --> + 11<!-- credits: speaker-map --> + 11<!-- credits: camera-switch --> + 990<!-- credits: apply-edl@90 --> + 11<!-- credits: use-case-fee:tighten-episode --> = **1488**<!-- credits: elevenlabs-stt + silence-detect + edit-plan:tighten:standard:90m + audio-sync:4src + speaker-map + camera-switch + apply-edl@90 + use-case-fee:tighten-episode --> (Audio Sync over four sources: the Master audio and three cameras) |
| Unknown length | captions off | 25<!-- credits: elevenlabs-stt --> + 11<!-- credits: silence-detect --> + 792<!-- credits: edit-plan:tighten:standard:180m --> + 1980<!-- credits: apply-edl@180 --> + 11<!-- credits: use-case-fee:tighten-episode --> = **2819**<!-- credits: elevenlabs-stt + silence-detect + edit-plan:tighten:standard:180m + apply-edl@180 + use-case-fee:tighten-episode --> |
| A List of three recordings (Each), unknown length | captions off | 3 × (2808<!-- credits: elevenlabs-stt + silence-detect + edit-plan:tighten:standard:180m + apply-edl@180 --> + 11<!-- credits: use-case-fee:tighten-episode -->) = **8457**<!-- credits: 3*elevenlabs-stt + 3*silence-detect + 3*edit-plan:tighten:standard:180m + 3*apply-edl@180 + 3*use-case-fee:tighten-episode -->: each item is its own run, with its own fee |

### Steps after the node

A step priced by the length of the video (or audio) it is given — [Trim](./trim-video.md#credit-cost), [Loop](./loop-video.md#credit-cost), [Combine Videos](./combine-videos.md#credit-cost), [Video SFX](../ai-video/video-sfx.md#credit-cost), or [Pitch & Tempo](../processing-audio/pitch-tempo.md) on an audio episode — wired to the node's **Episode** is priced at the length of the episode's cut, whether the episode is the render itself or its captioned or music-bed version (both keep the cut's length):

- The estimate before you run prices it at the render's estimated length: the recording's full length, or the 180-minute ceiling when the recording's length is not known (a Video SFX at most its 300-second price, a Pitch & Tempo at most its 30-minute price).
- A published app's or template's listed price lists a Trim, Loop or Combine Videos per minute of the recording, a Video SFX at its fixed 300-second price (it refuses a longer video), and a Pitch & Tempo at its 30-minute price (660 credits<!-- credits: pitch-tempo:30m -->), the most a run of it is charged.
- The run charges it at the length of the cut that was rendered, which the run reports on the node's output.

For example, a Trim set to **Seconds** with nothing cut, after a Tighten Episode of a 60-minute recording with captions on, is estimated at 60 minutes: 7920 credits<!-- credits: trim-video@720 -->, not the 22 credits<!-- credits: trim-video@2 --> of the 8-second fallback length it was estimated at before.

## API

`POST /v1/tighten-episode` with `{ mediaUrls: [<recording URL>, …], masterAudioUrl?, cameras?, musicUrl?, output?, framing?: { aspect, layout } | null, captions?, captionStyle?, reviewBeforeRender?, planTier?, instructions?, styleGuide?, musicDuckAmount? }` starts a run and answers `202 { jobId, executionId }`. `mediaUrls` holds one recording, or up to six of one conversation in order with `masterAudioUrl` and `cameras: { wide?: <recording number> | null, synced?: boolean, speakerCameras?: { "<speaker number>": <recording number, 0 = the wide shot> } }` — see [Several cameras](#several-cameras). **Several recordings or a Master audio need Speaker Map**, not yet enabled on nodaro.ai: until then they are refused `403 node_not_available` before anything is probed or charged; the node list (`GET /v1/nodes`) and the body schema show the fields to everyone. Poll the job (`GET /v1/jobs/:id/status`). Its `output_data` carries the episode (`videoUrl`, or `audioUrl` for an audio episode), its length in seconds when the run knows it (`durationSec`: the cut's), the edit (`json`), the transcript (`transcript`) and `quality` (`proxy` for a review run's preview, `final` otherwise); a run on several recordings or a Master audio adds `cameras` (`{ speakers: [{ speaker, ordinal, camera, marginDb }], syncNotes, mapNotes }`; `camera` is the recording number, `null` for the wide shot); a failed run keeps what completed and names the step that failed (`failedStep`). An `Idempotency-Key` header makes a retry of the same request answer with the same `jobId` and `"deduped": true`, starting nothing. `POST /v1/tighten-episode/estimate` takes the same body and answers the estimate as `{ data: { totalCredits, stepsCredits, feeCredits, durationSec } }` without starting anything (the credit figures are 0 on an edition without credits).

`POST /v1/tighten-episode/continue` with `{ jobId, mode }` continues one of your runs: `"mode": "from-failed"` runs what a failed run did not complete, and `"mode": "render-final"` (with `editedEdl`, your edit of the plan, optional) renders a review run's final. Its refusals are in [API integration](../../api-integration.md) (the continuation codes, including `continuation_not_failed`, `continuation_settling`, `continuation_superseded` and `already_running`); a Render final of a run that was not a preview is refused `render_final_not_preview`, and one of an edit that was already rendered `render_final_already_rendered`.

The [SDK](../../sdk-reference.md) (`client.edit.tightenEpisode`, `client.edit.estimateTightenEpisode`, `client.edit.continueUseCase`), the [CLI](../../cli.md) (`nodaro edit tighten-episode`, `nodaro edit continue-use-case`) and MCP call the same routes.

## Common Use Cases

- Clean up a raw interview recording before publishing.
- Produce an audio-only podcast episode from a video recording.
- A vertical, speaker-framed cut of a two-person video podcast (Framing 9:16).
- Add a music bed under the whole episode.

## Tips

- Turn on **Review before render** for important episodes: check the cut in the review inspector, edit it, then Render final.
- The **Edit (EDL)** output feeds other nodes, for example a second Apply EDL render in another format.
- Use **Instructions** for what the plan should keep or remove ("keep the cold open", "cut the sponsor read").
