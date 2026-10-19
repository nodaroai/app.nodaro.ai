# Speaker Map

> Work out which camera each speaker is on, from the cameras' own microphones, so a multicam edit switches to the right person without anyone filling in a table.

**Not yet enabled on nodaro.ai.**

## Overview

In a multicam podcast or interview, each guest usually has their own camera, and every camera has a microphone of its own. While a guest is talking, the camera pointed at them hears them loudest. Speaker Map uses that: it takes a transcript with speaker labels, listens to each camera during every speaker's turns, and decides whose camera is whose. The result goes into [Camera Switch](../processing-video/camera-switch.md)'s **Speaker map** input, which then puts each cut on the speaking person's camera.

The rule, per speaker:

- Over all of that speaker's turns, the camera that hears them **loudest** is theirs, when it leads the next-loudest camera by at least the **lead** you set (3 dB by default).
- When no camera leads by that much (the cameras are too close together, or the speaker sits between two), the speaker gets **no clear camera** (`""`) and Camera Switch shows them on the **wide shot**. A note names the speaker and how far ahead the loudest camera was.
- The **wide shot** and the **master recording** are no one's camera: they hear everyone, so they never win a speaker.
- A camera with no sound (no audio track, a muted microphone, or one that heard none of the turns) is never a failure: it simply cannot win a speaker, and a note names it.

It never calls an external provider: it reads each recording's sound locally with FFmpeg, so it works on every edition, including a keyless community install.

## Inputs

| Handle | Type | Required | Description |
|--------|------|----------|-------------|
| Cameras | video or audio | **Yes** (2–6) | Every recording: the cameras, and the master recording and the wide shot when you have them. Each recording is identified by its upstream node, the same id an edit plan gives it, so the map fits Camera Switch as it is. |
| Offsets | json | No | An [Audio Sync](./audio-sync.md) result over the same recordings. Leave it unwired when the recordings already share a clock. Any recording can be Audio Sync's reference: the offsets are moved onto the edit's clock (the master recording, else the first recording). |
| Transcript | json | **Yes** | The word transcript **with speaker labels**: a [Transcribe](../ai-text/transcribe.md) node run with speaker detection on, of the master recording (else the first recording), whose clock the turns are read on. |

## Outputs

| Handle | Type | Description |
|--------|------|-------------|
| Speaker map | json | Which camera each speaker is on. Wire it into Camera Switch's **Speaker map** input. |
| Edit (EDL) | json | The recordings as one edit on the master clock: the offsets applied, the master and wide marked, and each camera's `speakers` set from the map. |

The **Speaker map** output:

```json
{
  "version": 1,
  "speakerMap": { "speaker_0": "camA", "speaker_1": "camB", "speaker_2": "" },
  "confidence": {
    "speaker_0": { "camera": "camA", "marginDb": 9.4 },
    "speaker_1": { "camera": "camB", "marginDb": 6.1 },
    "speaker_2": { "camera": "", "marginDb": 1.2 }
  },
  "notes": ["\"speaker_2\": no clear camera (the loudest led by 1.2 dB) — shown on the wide shot; set the map to override."]
}
```

- `speakerMap`: speaker label → the camera's id; `""` means no clear camera (the wide shot).
- `confidence`: per speaker, the camera they got and how far, in dB, the loudest camera led the next (`null` when fewer than two cameras heard them).
- `edl` (when the recordings could be read): the same edit as the **Edit (EDL)** output, also on `output_data.edl`.
- `notes`: plain-language warnings: a speaker with no clear camera, a speaker fewer than two cameras heard, a camera with no audio track, a camera that heard none of the turns.

## Configuration

| Field | Default | Description |
|-------|---------|-------------|
| **Cameras** (`sourceOrder`) | wire order | The connected recordings, in order. |
| **Master recording** (`masterSourceId`) | none | The recording that hears everyone (a master microphone): no one's camera, and the clock the edit runs on. |
| **Wide shot** (`wideSourceId`) | none | The camera that films everyone: no one's camera; a speaker with no clear camera is shown on it. It must be a camera, not a sound-only recording. |
| **Lead needed** (`marginDb`) | 3 dB | How much louder the loudest camera must be than the next for a speaker to get it. The panel offers 1–12 dB; the API takes 0–30. Lower gives more speakers a camera; higher keeps only the clear ones. |

## Credit Cost

Speaker Map costs 11 credits<!-- credits: speaker-map --> per run, whatever the length or the number of recordings. Community and Business editions have no credits.

**Refused before charging:** fewer than 2 or more than 6 recordings, two recordings with the same id, a master or wide id that is not one of the recordings, a wide shot that is a sound-only recording (on the canvas, an audio node; over the API, a source sent with `kind: "audio"`), a missing transcript, and a transcript with **no speaker labels at all** (turn on speaker detection in Transcribe and run it again).

## API

`POST /v1/speaker-map` with `{ sources: [{ id, url, kind? }], transcript, offsets?, masterSourceId?, wideSourceId?, marginDb? }` (2–6 sources with unique ids; `kind: "audio"` marks a sound-only recording, such as a master mic, which is never anyone's camera; `offsets` is an Audio Sync result). A malformed request answers `400 validation_error`, a transcript with no speaker labels `422 no_speakers`, both before any credits are reserved. The finished job's `output_data.json` is the Speaker map result above, and `output_data.edl` the edit. See [API Integration](../../api-integration.md), [SDK Reference](../../sdk-reference.md) (`client.edit.speakerMap`) and the [CLI](../../cli.md) (`nodaro edit speaker-map`). MCP: `speaker_map`. Hand the result to Camera Switch as `speakerMapResult` (SDK), `speaker_map_result` (MCP) or `--speaker-map-result` (CLI).

## Common Use Cases

- A multicam podcast with one camera per guest: Audio Sync → Transcribe with speaker detection → Speaker Map → Camera Switch's Speaker map, so the switch knows whose camera is whose without a hand-filled table.
- An interview where the guests swap seats between sessions: run Speaker Map on each session instead of re-mapping by hand.

## Tips

- Mark the master microphone and the wide shot. Otherwise their sound competes with the cameras', and a wide shot that hears everyone may win a speaker.
- Wire Audio Sync's offsets in whenever the recordings were started separately. Without them each camera is read at the transcript's timestamps, and a camera that started late is listened to at the wrong moments.
- Read the notes. A speaker with no clear camera usually sits between two cameras, or the cameras' microphones were set very differently. Set that speaker's camera on Camera Switch: a camera set on the node wins over the map.
- Raise the lead when the map picks a camera that is only slightly louder; lower it when too many speakers come back with no clear camera.
