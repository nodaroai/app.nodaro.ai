# Audio Sync

> Measure how far apart the clocks of 2–6 recordings of one conversation are, from their sound, so a multicam edit lines up without anyone typing offsets.

## Overview

A podcast or interview is usually recorded several times over: one camera per guest, a wide shot, a master microphone. Each device starts recording at its own moment, so the same laugh sits at a different timestamp in every file. The Audio Sync node listens to all of them and reports how far each recording is shifted against one **reference** recording.

It works on any mix of audio and video recordings (the audio track of a video is used), and it never calls an external provider: it runs locally with FFmpeg and plain TypeScript, so it works on every edition, including a keyless community install.

How it measures, per recording against the reference:

1. **Coarse:** the loudness envelopes of the two whole recordings are cross-correlated. This finds the shift at any distance, including a camera started minutes before the microphone.
2. **Fine:** the waveforms are correlated around that answer on up to three 10-second windows — the middle of the stretch both recordings share first, then its start and end. The correlation weighs every frequency by its phase (GCC-PHAT), so a camera across a reverberant room is still timed on the direct sound, not on the room's echo. Clean recordings land within about a millisecond; reverberant ones typically within a few.
3. **Drift:** separate recorders' clocks run at very slightly different speeds (commonly 20–100 parts per million). The windows' offsets are fitted to a line whose slope is the drift; drifts up to 200 ppm are measured. Drift is **measured and reported, never corrected**: the offset is taken at the middle of the shared stretch, which halves the worst error at either end.

Times are read on each file's own clock — the one edits are cut on. A video whose sound starts after its picture (a stream-copy trim, a camera's late microphone) is measured with that gap in place.

The output is data, not media. Wire it into data/JSON consumers, for example an editing step that lines up the sources of an edit decision list (EDL).

## Inputs & Outputs

**Inputs:** Sources (required, 2–6 recordings, audio or video). Wire every recording into the one **Sources** input. Each recording is identified by its upstream node: the node's id becomes its `sourceId` in the result, which is also the id an edit plan gives the same recording.

**Outputs:**
- `json` — an Audio Sync result object:

```json
{
  "version": 1,
  "reference": "mic",
  "offsets": [
    { "sourceId": "mic", "offsetMs": 0, "confidence": 1, "driftMsPerHour": 0 },
    { "sourceId": "camA", "offsetMs": 7500, "confidence": 0.94, "driftMsPerHour": 1.2 },
    { "sourceId": "camB", "offsetMs": -40000, "confidence": 0.91, "driftMsPerHour": null }
  ],
  "notes": []
}
```

- `reference` — the recording every offset is measured against. Its own offset is always `0`.
- `offsets[].offsetMs` — where the recording sits on the reference's clock, in whole milliseconds:

  **`referenceMs = sourceMs + offsetMs`**

  This is the EDL's sign rule (`masterMs = sourceMs + offsetMs`): when the reference is the master recording, `offsetMs` is exactly the value that recording's `EdlSource.offsetMs` takes. A camera started 7.5 s **after** the microphone has `+7500` (its second 0 is the microphone's second 7.5). A camera started 40 s **before** it has `−40000`.
- `offsets[].confidence` — from 0 to 1. With a shared stretch of 6 minutes or more, three measuring windows are taken, and when they agree to within a millisecond the answer is trusted (at least `0.6`, even for a camera across a reverberant room); a sharp match lifts it to `1`, and windows that disagree by 5 ms or more score `0`. A shorter stretch has a single window, so its one match and the overall alignment must both be clear. Below `0.5`, a `notes` line asks you to check that offset by ear. Low confidence is a result, not a failure: a camera whose microphone was off has nothing to align, and the run still completes.
- `offsets[].driftMsPerHour` — the measured clock drift against the reference, in milliseconds gained per hour. It is `null` when the shared stretch was too short (under about 6 minutes) to place more than one measuring window.
- `notes` — human-readable warnings:
  - **a weak match** for a recording (confidence below `0.5`): check that offset by ear;
  - **no clear match** (below `0.2`): the offset is a guess;
  - **drift**, when the drift over the shared stretch exceeds one frame at 30 fps (**33 ms**). The note gives the total drift and the worst error at the ends (half of it, since the offset is taken at the middle);
  - **no shared sound**, when a recording has no stretch in common with the reference (its `confidence` is `0`);
  - **no audio track**, when a source (say, a picture-only camera file) carries no sound at all: it gets a row with `confidence` `0` and the others are still aligned.

## Configuration

| Field | Default | Description |
|-------|---------|-------------|
| **Recordings** (`sourceOrder`) | wire order | The connected recordings, in order. Drag to reorder: the first recording is the default reference, and the result lists the offsets in this order. |
| **Reference** (`reference`) | first recording | The recording every offset is measured against. If the chosen recording is later disconnected, the node falls back to the first recording (the panel shows it). |

## Credits

Priced **per recording aligned to the reference**:

**`credits = 10 × (sources − 1)`**, for 2 to 6 sources

The reference itself is not aligned against anything, so it costs nothing. Source length does not change the price.

| Sources | Credits |
|---------|---------|
| 2 | 10 |
| 3 | 20 |
| 4 | 30 |
| 5 | 40 |
| 6 | 50 |

On the canvas, the price follows the number of recordings wired into **Sources**. An estimate made without the workflow's connections quotes the 6-source price, 50 credits, so it never under-quotes. Community and Business editions have no credits.

## Worked examples

**2 sources: a master microphone and one camera.** The camera started 7.5 s after the microphone.

- Result: `mic` → `0` (the reference), `cam` → `+7500`.
- **Cost:** 10 × (2 − 1) = **10 credits**.

**4 sources: a microphone and three cameras.** Camera A started 7.5 s after the microphone, camera B 40 s before it, and camera C (recording at 44.1 kHz) 3.25 s after it.

- Result: `mic` → `0`, `camA` → `+7500`, `camB` → `−40000`, `camC` → `+3250`.
- **Cost:** 10 × (4 − 1) = **30 credits**.

**6 sources, with the reference set to camera A.** The same offsets are measured against camera A's clock instead: every value shifts by camera A's own offset, and `camA` → `0`.

- **Cost:** 10 × (6 − 1) = **50 credits**.

**Drift.** Two recorders whose clocks differ by 100 ppm move 360 ms apart per hour. Over a 40-minute shared stretch that is 240 ms, well over the 33 ms threshold, so `driftMsPerHour` is about 360 in size (its sign says which way the recording slides) and a `notes` line warns that the ends are off by up to 120 ms. Nothing is corrected.

## Limits

- 2 to 6 recordings per run. Fewer than 2 or more than 6 connected recordings refuse the run before it starts (and before any credits are reserved).
- Recordings must share some sound (at least 2 seconds of overlap). A recording with none gets a `notes` line and confidence `0`.
- The reference must have sound — it is the clock everything is measured on. A reference without an audio track fails the run with a message naming it; any other source without one just gets its own `confidence` `0` row.
- Drift is reported, not corrected.
- A recording is fetched in full on its first run, up to 64 GB and up to an hour, as long as it keeps arriving at about 2 Mbit/s or faster (slower than that for a whole minute, and the fetch is abandoned). Later runs reuse the prepared audio.

## API

`POST /v1/audio-sync` with `{ sources: [{ id, url }], reference? }` (2–6 sources with unique ids; `reference` must be one of the ids). The finished job's `output_data.json` is the result above. See [API Integration](../../api-integration.md), [SDK Reference](../../sdk-reference.md) (`client.edit.audioSync`) and the [CLI](../../cli.md) (`nodaro edit audio-sync`). MCP: `audio_sync`.

## Best Practices

- Make the master microphone the reference (wire it first, or pick it): its offsets then drop straight into the EDL, where the master's clock is the timeline.
- Check any recording with low confidence by ear. It usually means that recording barely heard the conversation (a muted camera, a distant wide shot in a loud room).
- For long episodes, read the drift notes. More than a frame of drift means lip sync slides over the episode, even though the start lines up.

## Common Use Cases

- Line up a multicam podcast (one camera per guest plus a master microphone) before planning the edit.
- Find the offset of a separately recorded audio track (a recorder on the table) against the camera audio.
- Check whether two recorders drift apart over a long session.
