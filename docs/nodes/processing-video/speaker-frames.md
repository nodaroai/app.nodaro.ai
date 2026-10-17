# Speaker Frames

> Find where each speaker's face is, over time, on every camera of an edit — the face tracks a tracked framing reads.

**Cloud feature.** Speaker Frames runs on Nodaro Cloud. On a self-hosted install, connect your instance to nodaro.ai (Integrations → nodaro.ai, or paste an API key); without a connection the node saves on the canvas but cannot run. A connected install builds the low-resolution detection copies of the cameras it samples itself and sends only those, never the originals: the master audio, a camera you untick and any other source of the edit are not sent at all (the edit nodaro.ai receives names them with a placeholder it never reads) — once nodaro.ai accepts runs from a connected install. Until then, a run from a connected install is refused with *"Speaker Frames is not available on a connected install yet"*.

**Priced per started block of 1,000 sampled frames** — see [Credit Cost](#credit-cost).

Tracks follow each face but aren't named after a speaker yet — Speaker View uses your drawn regions, or asks which face is whom.

## Overview

Speaker Frames looks at the footage an edit keeps and records, per camera, where each face is over time. Its result is a stored **track file** (boxes per face, on each camera's own clock) and, on the node's output, that file's **descriptor**: where it is stored, its SHA-256 and size, and a summary per camera and per track. Wire it into [Speaker View](./speaker-view.md#face-tracking)'s **Face tracks** input (or press **Add face tracking** there) and each speaker's crop follows their face.

It samples only what the edit keeps: each kept stretch **plus 2 seconds each side**, at **2 frames per second**, on every video camera the edit shows. A 90-minute episode tightened to 60 minutes is sampled for about 60 minutes, not 90.

## Inputs

| Handle | Type | Required | Description |
|--------|------|----------|-------------|
| EDL | json | One of EDL / Video | The edit — Edit Plan's EDL or Camera Switch's switched edit. **A clip pack runs once:** wire Edit Plan's Clips output straight in and every clip is folded into **one** run over the union of the clips' kept footage, never one run per clip. |
| Video | video | One of EDL / Video | A single video, sampled whole (up to 180 minutes). |
| Transcript | json | No | The renamed transcript Camera Switch outputs (its speaker names included), so the names on the tracks and in the panel are the ones the edit uses. Wire the **same** transcript Camera Switch outputs. |

Wire exactly one of EDL and Video: with both wired, the run is refused before anything is charged.

## Output

| Handle | Type | Description |
|--------|------|-------------|
| Face tracks | json | The track file's descriptor: `url`, `sha256`, `bytes`, the sample rate, and per camera its sampled spans, scene cuts and tracks (`id`, `speaker` when attributed, `boxCount`). The boxes themselves are in the stored file. |

On a connected self-host the track file is copied into the install's own storage after the run and its hash re-checked; the descriptor then points at that copy, which is kept and deleted with the install's own job.

## Configuration

| Field | Description |
|-------|-------------|
| Cameras to track | Every camera the wired edit samples, with its frame count. Untick a camera you do not need tracked (for example a close-up a render shows full frame); it is then not sampled. A camera you unticked that is no longer in the wired edit is ignored when the node runs. |

The sample rate (2 per second) is fixed. A camera whose kept footage is over **180 minutes** is refused before anything is charged.

### Corrections

The node keeps manual corrections in its `trackAssignments` field — a list of `{ trackId, speaker, rawSpeaker? }`, where `speaker: null` clears a track's label and `rawSpeaker` is the transcript's own label behind `speaker` (so a later rename in Camera Switch moves the correction to the new name; a correction without it keeps its name as written). They are stored on the Speaker Frames node, by track id, and applied by whatever reads the tracks: the node's panel and its summary on the canvas, and [Speaker View](./speaker-view.md#face-tracking), which renders with them. The panel and the summary show every name through the speaker names of the transcript wired into Speaker Frames, so after a rename in Camera Switch a track and a correction show the new name, as Speaker View uses it; with no transcript wired they show the names as stored. Set them in Speaker View's **Edit framing…**: it draws the tracked faces over each camera, and picking who a face is saves the correction here. When this node feeds a Speaker View fed a video and its result names no face for one of that Speaker View's speakers, the panel offers **Which face is …?**, which opens that Speaker View's **Edit framing…** with a guide that asks one face at a time ([Speaker View: Which face is who](./speaker-view.md#a-video-instead-of-an-edit)). The **Face tracks** output itself carries the descriptor as the run wrote it, corrections not applied. A re-run keeps the corrections where the track ids survive; a correction whose track a re-run no longer has is listed in the panel, never silently dropped.

## Credit Cost

Priced **per started block of 1,000 sampled frames**, at 2.2<!-- credits-rate: speaker-frames --> credits a block — one rate for every kind of footage (HD or 4K, one camera or several):

- `rate × max(1, ceil(sampled frames ÷ 1,000))`, the run's total rounded up to a whole credit — at least **one block per run**.
- **Sampled frames** are what the run looks at: on each ticked camera, every stretch the edit keeps **plus 2 seconds each side** (stretches whose margins touch are merged), at **2 frames per second** — `ceil(seconds × 2)` per camera, added up over the cameras. A bare video is sampled whole: `ceil(its length in seconds × 2)`.

| Run | Sampled frames | Blocks | Credits |
|-----|----------------|--------|---------|
| A 90-minute episode tightened to 82 min 30 s — 90 kept stretches of 55 s, one wide camera | 10,616 | 11 | 25<!-- credits: speaker-frames@11 --> |
| A clip pack of 8 clips of 56 s on one camera — one run over all of them | 960 | 1 | 3<!-- credits: speaker-frames --> |
| A 14-second video | 28 | 1 | 3<!-- credits: speaker-frames --> |

**Reserved on the count, charged on what was sampled.** When the run starts, the server counts the frames itself — from the kept stretches of the edit on the ticked cameras, or from a bare video's measured length — and reserves that many blocks; it never takes a frame count from the request. A video relayed from a connected self-hosted install is counted from the detection copy the install sends: that copy is all the run samples, so its frames are the most it can be charged. You are then charged for the frames the run actually sampled, at the same rate, never more than was reserved, and the rest is released: a stretch that runs past the end of its video samples nothing.

**A clip pack is one run.** Its clips' stretches on the same camera are merged, so the pack is charged for their union once, not a block per clip.

The rate is one price row, `speaker-frames`, which an administrator can change in the admin panel's model prices (`/admin/models`).

**Quoting it from the API.** `GET /v1/credits/model-cost?model=speaker-frames` answers **one block's** price, 3<!-- credits: speaker-frames --> — the least a run is charged, not what a run costs (11 blocks are 25<!-- credits: speaker-frames@11 -->, not 11 × 3<!-- credits: speaker-frames -->). For a run's total, send the workflow to `POST /v1/credits/estimate-workflow`: it counts the frames as [the estimate below](#what-the-estimate-shows-before-you-run) does. For a block count you already know, `GET /v1/credits/model-cost?model=speaker-frames:<N>u` is its exact price. `GET /v1/nodes/speaker-frames` serves the rate as `creditRate`: `creditsPerUnit` 2.2<!-- credits-rate: speaker-frames --> (one block, not rounded), `unit: "1000-frames"`, `minUnits: 1` and `rounding: "ceil-run-total"` — a run is charged `ceil(blocks × creditsPerUnit)`, rounded up once ([Node discovery](../../api-integration.md#11-node-discovery)).

### What the estimate shows before you run

The cost on the node, the **Run** button, the run-confirm dialog and the credit check before a run is an **estimate**, and it leans high:

- **The edit is known now** — the plan Camera Switch or Edit Plan holds and that node does not run again in this run, or an EDL set on the node: its own frames on the ticked cameras.
- **A video instead of an edit** — the whole video at 2 frames per second over its recorded length, the length [Speaker View's video mode](./speaker-view.md#a-video-instead-of-an-edit) reads: an upload's own length, a render's estimated length, or the length a Trim, Loop or Combine Videos passes on, at most 180 minutes. A 14-second upload is quoted 28 frames, one block, 3<!-- credits: speaker-frames -->; a 45-minute upload 5,400 frames, 6 blocks, 14<!-- credits: speaker-frames@6 -->.
- **Otherwise** — the node that makes the edit runs again in this run or has nothing saved yet, or a video whose length is not known before the run (a link, or a step that has not run yet) — the ceiling: 180 minutes on each of 6 cameras, 129,600 frames, 130 blocks, 286<!-- credits: speaker-frames@130 -->.

The run itself reserves only the frames it will sample, so for up to six cameras the estimate is never below what you are charged.

## API

`POST /v1/speaker-frames` with `{ edl?, videoUrl?, transcript?, excludeSourceIds? }` — exactly one of `edl` (one EDL, a clip pack — an array of EDLs — or a clip set, as objects or JSON strings) and `videoUrl`. `excludeSourceIds` lists the cameras you unticked. Refused before charging: `400` for a malformed request or an edit that is not on the recording's clock (`invalid_edl`), an untick list naming no camera of the edit or wiring both or neither input (`invalid_input`), a camera over 180 minutes, or a video over 180 minutes (`too_long`). The route reserves from its own count of the frames (see [Credit Cost](#credit-cost)). On a self-hosted install the route answers `503 nodaro_connection_required` without a connection or when nodaro.ai rejects the install's connection (revoked or expired — reconnect from Integrations), `503 speaker_frames_relay_unavailable` while nodaro.ai does not take runs from a connected install or cannot be reached. No source of the edit is sent, so none is size-checked; if a detection copy the install built is over the 500 MB a relay can send, the job fails naming its camera — keep less footage or untick that camera. The finished job's `output_data.json` is the descriptor.

`GET /v1/speaker-frames/capabilities` answers `{ relay, source }`: whether this server runs a Speaker Frames job relayed from a connected self-host. `source` is `server` (this server's own answer), `nodaro.ai` (a connected self-host's answer from nodaro.ai), `nodaro.ai-unreachable` (nodaro.ai could not be asked), `nodaro.ai-rejected` (nodaro.ai rejected the install's connection) or `not-connected` (a self-host with no connection).
