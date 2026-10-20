# Speaker Layout

> Frame a whole recording by speaker in one step — the same length, nothing cut: each speaker framed in turn, or, with several cameras of one conversation, each speaker shown on their own camera.

**Not yet enabled on nodaro.ai.**

**Needs nodaro.ai on a self-hosted install.** Its render (Speaker View) runs on nodaro.ai. On a self-hosted install, connect your instance to nodaro.ai (Integrations → nodaro.ai, or paste an API key) and the node runs those steps there. Without a connection the node is not listed among the available nodes (`GET /v1/nodes`), and a run is refused before anything starts: `503` with the code `nodaro_connection_required`, no job created.

## Overview

Speaker Layout takes a recording and returns it framed by speaker, from start to end: nothing is cut, so the video is as long as the recording. Inside, it runs the same steps you can wire by hand — [Transcribe](../ai-text/transcribe.md) (speakers labelled, word timings), then [Speaker View](./speaker-view.md) over the whole recording, boxing each speaker on screen and switching to whoever is talking. Each step runs as its own job, so a long recording, a cancel or a failure behaves as it does in a hand-built workflow.

With [several cameras](#several-cameras) of one conversation (not yet enabled on nodaro.ai), the recordings are lined up and each speaker is shown on their own camera. To cut the recording too (silences, filler, a tighter episode), use [Tighten Episode](./tighten-episode.md) with a framing instead; for short clips, [Clip Pack](./clip-pack.md).

## Inputs

| Handle | Type | Required | Description |
|---|---|---|---|
| Recordings (`media`) | Video | Yes | The recording, up to 3 hours, with sound. With [several cameras](#several-cameras), each camera's recording (1–6). A run whose recordings have no picture is refused (`media_needs_video`): there is nothing to frame. |
| Master audio (`masterAudio`) | Audio | No | [Several cameras](#several-cameras): the mixer or recorder track, the video's sound. |

With one recording, a video already as narrow as the chosen shape (or narrower) is refused before anything is charged (`media_shape`): there is no extra width to follow a speaker across — choose a narrower shape or use a wider video. A recording that cannot be read is refused the same way (`media_unreadable`).

With more than one recording wired into `media`, the recordings are taken in the order the node's `mediaOrder` setting names (a list of the wired nodes' ids), else in the order they were wired: the first is Camera 1. Where Speaker Map is not available to you — on nodaro.ai today — a run reads the first recording only and ignores the others and any Master audio: the same run, the same estimate, nothing refused. The settings panel then says so; where Speaker Map is available, it shows a **Cameras** section instead.

## Outputs

| Handle | Type | Description |
|---|---|---|
| Video (`media`) | Video | The framed video. It carries its length, so a step priced by the length of what it is given (Trim, Loop, Combine Videos, Video SFX) is priced by the framed video's length. |
| Edit (EDL) (`json`) | EDL | The edit Speaker View drew: the whole recording, with each speaker's boxes. Wire it into another render, for example a second [Speaker View](./speaker-view.md) in another shape. It is JSON, not media: it does not connect to an input that takes only audio, video or images (wire the **Video** there). |

## Configuration

| Setting | Options | Default | Notes |
|---|---|---|---|
| Shape | 16:9, 9:16, 1:1, 4:5 | 9:16 | The video's shape. |
| Layout | The layouts Speaker View draws at the chosen shape (Auto, Single, Side by side, Stacked, Grid, Picture in picture) | Stacked | One the shape does not draw is snapped to one it does. |
| Switch | Speaker View's switches (Cut, Pan, Zoom, a crossfade) | Cut | The switch at each speaker change. A switch the layout rules out is shown greyed with its reason, as on Speaker View. |
| Emphasis | None, or Scale, Border and Dim, alone or together | Scale | How the speaker talking is emphasised. |
| Framing source | Automatic (follow faces) / Even split / Follow faces | Automatic | See [Following faces](#following-faces). |
| Review before render | On / Off | Off | On: the run stops at a quick preview; **Render final** then makes the full-quality video. See [Review before render](#review-before-render). |
| Cameras | Wide camera, Recordings already in sync, Who is on which camera | — | Shown with two or more recordings or a Master audio, where Speaker Map is available to you. See [Several cameras](#several-cameras). |

Each speaker on screen gets an automatic box — the default boxes Speaker View's **Split the camera by speaker** deals. A voice heard only briefly — under 10 seconds and under 5 % of the talk — gets no box of its own, so a stray label in the transcript never takes a share of the frame.

## Following faces

**Framing source** says where the speakers' boxes come from:

- **Automatic** — the default: follows faces while Speaker Frames is available to you, else the even split, with no refusal and nothing extra charged. Its estimate follows the same rule. A node or request that names no framing source reads Automatic.
- **Even split** — each speaker on screen gets an even share of the frame.
- **Follow faces** — [Speaker Frames](./speaker-frames.md) tracks each face, and Speaker View follows it (charged per started block of 1,000 sampled frames). Faces aren't named after a speaker yet: a camera that shows one person is followed; a camera shared by several speakers keeps the even split.

Where Speaker Frames is not available to you, the panel offers no framing source (Automatic is then the even split); a node set to **Follow faces** shows a note instead, and a run of it is refused before anything is charged: `403 node_not_available`, naming Speaker Frames — as is a request over the API, the SDK, the CLI or MCP that sends `framingSource: "tracking"`.

## Several cameras

**Not yet enabled on nodaro.ai.** Several recordings and a Master audio need [Speaker Map](../processing-audio/speaker-map.md), which works out who is on which camera and is not yet available on nodaro.ai. Until it is, a run in the editor, an app or a workflow reads its first recording only (see [Inputs](#inputs)), and a request over the API, the SDK, the CLI or MCP that sends several recordings or a Master audio is refused before anything is probed or charged: `403 node_not_available`.

Wire each camera's recording into **Recordings** and, when you have one, the mixer or recorder track into **Master audio**. The run then lines the recordings up ([Audio Sync](../processing-audio/audio-sync.md)), transcribes the sound, works out which camera each speaker is on (Speaker Map, over the whole recording), puts each stretch on whoever is talking ([Camera Switch](./camera-switch.md), with two or more cameras), and frames it with Speaker View — each camera's own shot.

- **Recordings.** 1–6 recordings of one conversation, in order: Camera 1, Camera 2… Drag them in the panel's **Recordings** list to reorder (`mediaOrder`).
- **Master audio.** The video's sound and the clock the recordings are lined up to. Up to 6 recordings in all, Master audio included. Without Master audio the sound is picked as on [Tighten Episode](./tighten-episode.md#several-cameras), so it never jumps between camera microphones. One camera with a Master audio is lined up to it and framed on that one camera.
- **Wide camera.** The camera that shows everyone. A speaker with no camera of their own is shown on it. None by default.
- **Recordings already in sync.** On when every recording already shares one clock: the run skips lining them up (no Audio Sync step).
- **Who is on which camera.** By default Speaker Map decides it from the cameras' own microphones. Set a speaker to a camera, or to the wide shot, to override it. **Speaker 1 is the first voice heard**, Speaker 2 the next, and so on.
- **The report.** The run's result names who was put on which camera (`output_data.cameras`), with the line-up and map notes.

The run's own refusals (`400`), before anything is charged, are those of [Tighten Episode](./tighten-episode.md#several-cameras): `too_many_recordings`, `wide_camera_out_of_range`, `invalid_cameras`.

## Review before render

With **Review before render** on, a run stops at a preview: Speaker View renders at its lower preview rate. Watch it, then press **Render final** on the node: it renders the video at full quality with the settings the preview was made with. There is nothing to edit — the layout has no cut to change — so the node offers no review inspector.

- **Render final renders only the render.** Transcribe, Speaker Frames and, with several cameras, Audio Sync, Speaker Map and Camera Switch are not run or charged again, and there is no fee.
- **Over the API.** `POST /v1/speaker-layout/continue` with `"mode": "render-final"` and no `editedEdl`; one sent with an `editedEdl` is refused `400 use_case_no_plan` ("Speaker Layout has no edit to change — run Render final without one."), before anything is read or charged. A second Render final of the same preview is refused `render_final_already_rendered`.
- **Someone has to review.** As on [Tighten Episode](./tighten-episode.md#review-before-render): a workflow or app run with nobody to review it cannot stop at the preview (`preview_review_required`), and MCP's own `speaker_layout` and `continue_use_case` tools are reviewed by the agent that calls them.
- **Not once per list item.** A node with Review before render on that is fed by a List is refused before any of its runs starts, with nothing charged (`use_case_review_list_driven`). With it off, a List runs the node once per item, each its own run with its own fee.

## If a run fails

The steps that finished stay finished: their results (the transcript, the line-up, the camera map) are kept and they are not charged again. Press **Continue** on the node: only the step that failed and the ones after it run again (`POST /v1/speaker-layout/continue` with `"mode": "from-failed"`). A failed run's fee is refunded, and Continue holds it again, so a run is charged its fee once.

## Credit Cost

Speaker Layout is charged **its steps at their own rates, plus a per-run fee of 11 credits**<!-- credits: use-case-fee:speaker-layout -->:

- Transcribe (`elevenlabs-stt`): 25 credits<!-- credits: elevenlabs-stt -->
- Speaker View, per minute of the recording, at its own rates (see [Speaker View](./speaker-view.md#credit-cost)). The estimate prices it at the higher (complex) rate, since the layout is not known before the run; a recording with at most two speakers on screen and no zoom is charged the lower one. A Preview is charged at the preview rates.
- Following faces, Speaker Frames: 2.2<!-- credits-rate: speaker-frames --> credits per started block of 1,000 sampled frames, the run's total rounded up once. One recording samples the whole video at 2 frames per second; several cameras sample every camera over the recording's length plus 2 seconds at each end (see [Speaker Frames](./speaker-frames.md#credit-cost)).
- [Several cameras](#several-cameras) (not yet enabled on nodaro.ai): Audio Sync over the sound and each camera, 11<!-- credits-rate: audio-sync:2src --> credits for each recording it lines up to the sound (none when the recordings are already in sync); Speaker Map, 11 credits<!-- credits: speaker-map -->; Camera Switch, 11 credits<!-- credits: camera-switch -->, with two or more cameras. Speaker View is priced at the sound's length (the Master audio's, else the longest recording's).
- **Plus the per-run fee of 11 credits<!-- credits: use-case-fee:speaker-layout -->.** A Render final after a review is not charged the fee again.

You are charged for the framed video's own minutes, not for the estimate.

### What the estimate shows before you run

The estimate prices Speaker View at the recording's full length — the length of the video it makes. A recording with no known length is estimated at the 180-minute ceiling.

| Recording | Settings | Estimate |
|---|---|---|
| 60-min video | Even split | 25<!-- credits: elevenlabs-stt --> + 792<!-- credits: speaker-view:complex@60 --> + 11<!-- credits: use-case-fee:speaker-layout --> = **828**<!-- credits: elevenlabs-stt + speaker-view:complex@60 + use-case-fee:speaker-layout --> |
| 60-min video | [Following faces](#following-faces) (or Automatic, where Speaker Frames is available to you) | 25<!-- credits: elevenlabs-stt --> + 18<!-- credits: speaker-frames@8 --> + 792<!-- credits: speaker-view:complex@60 --> + 11<!-- credits: use-case-fee:speaker-layout --> = **846**<!-- credits: elevenlabs-stt + speaker-frames@8 + speaker-view:complex@60 + use-case-fee:speaker-layout --> (Speaker Frames: 3,600 seconds × 2 = 7,200 frames, 8 blocks) |
| 60-min video | Automatic, where Speaker Frames is not available to you | 25<!-- credits: elevenlabs-stt --> + 792<!-- credits: speaker-view:complex@60 --> + 11<!-- credits: use-case-fee:speaker-layout --> = **828**<!-- credits: elevenlabs-stt + speaker-view:complex@60 + use-case-fee:speaker-layout --> (the even split) |
| 60-min video | Even split, Review before render (the preview) | 25<!-- credits: elevenlabs-stt --> + 198<!-- credits: speaker-view:complex:proxy@60 --> + 11<!-- credits: use-case-fee:speaker-layout --> = **234**<!-- credits: elevenlabs-stt + speaker-view:complex:proxy@60 + use-case-fee:speaker-layout -->; then Render final 792<!-- credits: speaker-view:complex@60 -->, no fee |
| 60 min, three cameras + Master audio ([several cameras](#several-cameras)) | Even split | 25<!-- credits: elevenlabs-stt --> + 33<!-- credits: audio-sync:4src --> + 11<!-- credits: speaker-map --> + 11<!-- credits: camera-switch --> + 792<!-- credits: speaker-view:complex@60 --> + 11<!-- credits: use-case-fee:speaker-layout --> = **883**<!-- credits: elevenlabs-stt + audio-sync:4src + speaker-map + camera-switch + speaker-view:complex@60 + use-case-fee:speaker-layout --> (Audio Sync over four sources: the Master audio and three cameras) |
| 60 min, three cameras + Master audio | Following faces | 25<!-- credits: elevenlabs-stt --> + 33<!-- credits: audio-sync:4src --> + 11<!-- credits: speaker-map --> + 11<!-- credits: camera-switch --> + 49<!-- credits: speaker-frames@22 --> + 792<!-- credits: speaker-view:complex@60 --> + 11<!-- credits: use-case-fee:speaker-layout --> = **932**<!-- credits: elevenlabs-stt + audio-sync:4src + speaker-map + camera-switch + speaker-frames@22 + speaker-view:complex@60 + use-case-fee:speaker-layout --> (Speaker Frames: 3 cameras × 3,604 seconds × 2 = 21,624 frames, 22 blocks) |
| Unknown length | Even split | 25<!-- credits: elevenlabs-stt --> + 2376<!-- credits: speaker-view:complex@180 --> + 11<!-- credits: use-case-fee:speaker-layout --> = **2412**<!-- credits: elevenlabs-stt + speaker-view:complex@180 + use-case-fee:speaker-layout --> |

## API

`POST /v1/speaker-layout` with `{ mediaUrls: [<recording URL>, …], masterAudioUrl?, cameras?, targetAspect?, layout?, switchType?, emphasisStyle?, framingSource?: "auto" | "static" | "tracking", reviewBeforeRender? }` starts a run and answers `202 { jobId, executionId }`. `mediaUrls` holds one video recording, or up to six of one conversation in order with `masterAudioUrl` and `cameras: { wide?: <recording number> | null, synced?: boolean, speakerCameras?: { "<speaker number>": <recording number, 0 = the wide shot> } }` — see [Several cameras](#several-cameras). `switchType` is one of Speaker View's switches and `emphasisStyle` `"none"` or `"scale"`, `"border"` and `"dim"` joined with `"+"` (each once); any other value is refused `400 validation_error`. An absent `framingSource` is `"auto"`. Poll the job (`GET /v1/jobs/:id/status`). Its `output_data` carries the framed video (`videoUrl`), its length in seconds when the run knows it (`durationSec`), the edit Speaker View drew (`json`), the transcript (`transcript`) and `quality` (`proxy` for a review run's preview, `final` otherwise); a run on several recordings or a Master audio adds `cameras`; a failed run names the step that failed (`failedStep`). An `Idempotency-Key` header makes a retry of the same request answer with the same `jobId` and `"deduped": true`, starting nothing. A run on one recording reads the recording's size before it starts; when you start too many of those in a minute, a run is refused `429 rate_limit_exceeded` before anything is created — try again in a moment. `POST /v1/speaker-layout/estimate` takes the same body and answers `{ data: { totalCredits, stepsCredits, feeCredits, durationSec } }` without starting anything (the credit figures are 0 on an edition without credits).

`POST /v1/speaker-layout/continue` with `{ jobId, mode }` continues one of your runs: `"mode": "from-failed"` runs what a failed run did not complete, and `"mode": "render-final"` renders a review run's final (no `editedEdl`: `400 use_case_no_plan`). Its other refusals are the [continuation codes](../../api-integration.md#continuing-a-run).

The [SDK](../../sdk-reference.md) (`client.edit.speakerLayout`, `client.edit.estimateSpeakerLayout`, `client.edit.continueUseCase`), the [CLI](../../cli.md) (`nodaro edit speaker-layout`, `nodaro edit continue-use-case`) and MCP (`speaker_layout`, `continue_use_case`) call the same routes.

## Common Use Cases

- A vertical, speaker-framed version of a whole two-person video podcast, for platforms that play long videos upright.
- A multicam interview, each speaker on their own camera, without cutting anything.
- A square or 4:5 version of a panel recording, every speaker boxed.

## Tips

- Use **Automatic** framing: it follows faces where it can and costs nothing extra where it cannot.
- Turn on **Review before render** for a long recording: check the preview before paying for the full-quality render.
- To also cut the recording, use [Tighten Episode](./tighten-episode.md) with a framing.
