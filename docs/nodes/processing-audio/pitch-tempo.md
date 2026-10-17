# Pitch & Tempo
> Shift a voice or song up or down in semitones, or speed it up / slow it down without changing its pitch.

## Overview

The Pitch & Tempo node (internally `pitch-tempo`) changes the pitch and the tempo of audio independently, using the [Rubber Band](https://breakfastquay.com/rubberband/) time-stretching and pitch-shifting library (through FFmpeg's `rubberband` filter).

- **Pitch** moves every note up or down by a number of semitones while the length stays the same — +12 is one octave up, −12 one octave down.
- **Tempo** makes the audio faster or slower while the pitch stays where it is — 0.5× plays at half speed (twice as long), 2× at double speed (half as long).
- **Preserve formants** keeps a voice sounding like the same person when its pitch moves. Turn it off for the classic chipmunk (pitched up) or giant (pitched down) effect.

It works on **audio or video**: give it a video and it shifts the video's soundtrack and returns the video with the picture untouched.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Label | `string` | `"Pitch & Tempo"` | Display name on the canvas |
| Pitch (semitones) | `-12 … 12`, step 0.1 | `0` | Pitch shift. Fractions are allowed (0.5 = a quarter tone) |
| Tempo | `0.5 … 2`, step 0.05 | `1` | Speed factor with the pitch kept. Ignored for a video input (see below) |
| Preserve formants | `boolean` | `true` | Keep the voice's natural timbre while shifting pitch |

## Inputs & Outputs

- **Input**: `in` — any audio **or** video (an upload, a generated voice or song, a separated stem, a video clip).
- **Output**: one pip that follows the input — `audio-out` (MP3) for an audio input, `video-out` (MP4) for a video input.

**Video inputs.** The picture is copied as it is (no re-encode) and only the soundtrack is processed, so the result has exactly the original video's length and frames. Tempo is fixed at 1× for a video: a stretched soundtrack would no longer match its picture. To change the speed of a video, use **Adjust Speed** (Speed Ramp). A video with no audio track is refused (and refunded).

Whether a file is audio or video is read from the file itself, so an audio-only file served as a video (or a podcast MP3 with cover art) is processed as audio.

## Credits

Priced **per started minute of the input**, up to 30 minutes:

```
credits = 22 × max(1, ceil(input seconds ÷ 60))
```

| Input length | Credits |
|--------------|---------|
| 0:45 | 22<!-- credits: pitch-tempo:1m --> |
| 1:00 | 22<!-- credits: pitch-tempo:1m --> |
| 1:01 | 44<!-- credits: pitch-tempo:2m --> |
| 3:10 | 88<!-- credits: pitch-tempo:4m --> |
| 30:00 | 660<!-- credits: pitch-tempo:30m --> |

The input is measured before anything is charged, on a single-node run and in a workflow run alike, and the same input always costs the same. The price depends only on the input's length — not on the pitch, the tempo, or a longer output from slowing it down.

- An input **longer than 30 minutes** is refused before any charge (`media_duration_exceeds_limit`).
- An input whose length **cannot be read** (an unreachable link, a corrupted or unsupported file) is refused before any charge (`invalid_media_duration`). There is no fallback length.
- Before a run, the editor, the server's run estimate (MCP, the SDK, published apps) and the Render final balance check quote the input's started minutes when its length is known: an uploaded file's recorded length, a rendered or trimmed video's length (also through a step that keeps it, such as a [Tighten Episode](../processing-video/tighten-episode.md#steps-after-the-node)'s music mix), or the length the upstream node reports. When the length is not known yet, they quote the 30-minute price (660 credits<!-- credits: pitch-tempo:30m -->), which is the most a run can be charged. The run then reserves and charges the measured length, which is never more.

## API

`POST /v1/pitch-tempo` with exactly one of `audioUrl` or `videoUrl`, plus optional `semitones`, `tempo` and `preserveFormants`. Returns `{ jobId }`; the finished job's `output_data` carries `audioUrl` (audio input) or `videoUrl` + `thumbnailUrl` (video input), and `inputType`.

MCP: the `pitch_tempo` tool. SDK: `client.audio.pitchTempo(…)`. CLI: `nodaro audio pitch-tempo`.

## Best Practices

- For a natural-sounding voice change keep **Preserve formants** on and stay within about ±4 semitones; beyond that a voice starts to sound processed.
- Moving a song into another key: shift by the interval in semitones (e.g. −2 for a whole tone down).
- Fitting audio to a time slot: tempo 0.9 makes a clip about 11% longer without the voice dropping in pitch.

## Credits & licence

Rubber Band Library © Particular Programs Ltd, used under the GNU GPL as part of the FFmpeg build the platform ships.
