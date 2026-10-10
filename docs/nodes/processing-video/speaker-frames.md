# Speaker Frames

> Find where each speaker's face is, over time, on every camera of an edit — the face tracks a tracked framing reads.

**Cloud feature.** Speaker Frames runs on Nodaro Cloud. On a self-hosted install, connect your instance to nodaro.ai (Integrations → nodaro.ai, or paste an API key); without a connection the node saves on the canvas but cannot run. A connected install builds the low-resolution detection copies of the cameras it samples itself and sends only those, never the originals: the master audio, a camera you untick and any other source of the edit are not sent at all (the edit nodaro.ai receives names them with a placeholder it never reads) — once nodaro.ai accepts runs from a connected install. Until then, a run from a connected install is refused with *"Speaker Frames is not available on a connected install yet"*.

**Not priced yet.** Every run is refused with *"Speaker Frames is not priced yet"* before anything is charged, until its price is set. The node, its settings panel and the Run button say so.

## Overview

Speaker Frames looks at the footage an edit keeps and records, per camera, where each face is over time. Its result is a stored **track file** (boxes per face, on each camera's own clock) and, on the node's output, that file's **descriptor**: where it is stored, its SHA-256 and size, and a summary per camera and per track. Speaker View's tracked framing reads it.

It samples only what the edit keeps: each kept stretch **plus 2 seconds each side**, at **2 frames per second**, on every video camera the edit shows. A 90-minute episode tightened to 60 minutes is sampled for about 60 minutes, not 90.

## Inputs

| Handle | Type | Required | Description |
|--------|------|----------|-------------|
| EDL | json | One of EDL / Video | The edit — Edit Plan's EDL or Camera Switch's switched edit. **A clip pack runs once:** wire Edit Plan's Clips output straight in and every clip is folded into **one** run over the union of the clips' kept footage, never one run per clip. |
| Video | video | One of EDL / Video | A single video, sampled whole (up to 180 minutes). |
| Transcript | json | No | The renamed transcript Camera Switch outputs (its speaker names included), so the tracks are labelled in the same names the edit uses. Wire the **same** transcript Camera Switch outputs. |

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

The node keeps manual corrections in its `trackAssignments` field — a list of `{ trackId, speaker }`, where `speaker: null` clears a track's label. They are stored on the Speaker Frames node, by track id, and applied by whatever reads the tracks: today the node's panel and its summary on the canvas; Speaker View's tracked framing once it reads face tracks. The **Face tracks** output itself carries the descriptor as the run wrote it, corrections not applied. A re-run keeps the corrections where the track ids survive; a correction whose track a re-run no longer has is listed in the panel, never silently dropped.

## Credit Cost

Not priced yet — every run is refused before anything is charged until the price is set.

## API

`POST /v1/speaker-frames` with `{ edl?, videoUrl?, transcript?, excludeSourceIds? }` — exactly one of `edl` (one EDL, a clip pack — an array of EDLs — or a clip set, as objects or JSON strings) and `videoUrl`. `excludeSourceIds` lists the cameras you unticked. Refused before charging: `400` for a malformed request or an edit that is not on the recording's clock (`invalid_edl`), an untick list naming no camera of the edit or wiring both or neither input (`invalid_input`), a camera over 180 minutes (`too_long`); `503 not_priced` until the price is set. On a self-hosted install the route answers `503 nodaro_connection_required` without a connection or when nodaro.ai rejects the install's connection (revoked or expired — reconnect from Integrations), `503 speaker_frames_relay_unavailable` while nodaro.ai does not take runs from a connected install or cannot be reached. No source of the edit is sent, so none is size-checked; if a detection copy the install built is over the 500 MB a relay can send, the job fails naming its camera — keep less footage or untick that camera. The finished job's `output_data.json` is the descriptor.

`GET /v1/speaker-frames/capabilities` answers `{ relay, source }`: whether this server runs a Speaker Frames job relayed from a connected self-host. `source` is `server` (this server's own answer), `nodaro.ai` (a connected self-host's answer from nodaro.ai), `nodaro.ai-unreachable` (nodaro.ai could not be asked), `nodaro.ai-rejected` (nodaro.ai rejected the install's connection) or `not-connected` (a self-host with no connection).
