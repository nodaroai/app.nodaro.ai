# Silence Detect

> Detect silent spans in an audio or video track and emit them as source-clock ranges.

## Overview

The Silence Detect node runs one local FFmpeg `silencedetect` pass over the connected audio or video and returns the silent spans as a structured JSON payload on its `json` output handle. It never calls an external provider, so it works on a keyless (community) install.

It reads a cheap 16 kHz mono audio proxy of the source, so a long recording is analysed in seconds rather than by downloading and decoding the full-resolution original. Connect an audio track **or** a video (its audio is used automatically) and run.

The output is data, not media — feed it into data/JSON consumers (for example, an editing/EDL step or an Extract Field node), not a media input.

## Inputs & Outputs

**Inputs:** Audio or Video (required)

**Outputs:**
- `json` — a `SilenceDetect` result object:

```json
{
  "version": 1,
  "ranges": [
    { "startMs": 2120, "endMs": 3880 }
  ],
  "durationMs": 6000
}
```

- `ranges` — the silent spans, in milliseconds on the **source** clock, ordered as they occur. `endMs` is exclusive and always greater than `startMs`.
- `durationMs` — the total source duration, in milliseconds.

## Configuration

| Field | Default | Description |
|-------|---------|-------------|
| **Silence threshold** (`thresholdDb`) | `-35` | Audio quieter than this (in dBFS, always ≤ 0) counts as silence. A lower value is stricter (only near-total quiet is silence). |
| **Minimum silence** (`minSilenceMs`) | `700` | Only gaps at least this long (in ms) are reported. |
| **Speech padding** (`padMs`) | `120` | Padding kept around speech (in ms). Each detected span is shrunk **inward** by this amount at both ends so a downstream cut doesn't clip a breath or the attack of a word. A span that would collapse to nothing after padding is dropped. |

## Credits

**Flat 10 credits per run**, regardless of source length, threshold, or the number of ranges found. The pass is a local FFmpeg analysis with no external provider cost.

## Worked example

A 6-second recording that is silent between the 2- and 4-second marks, run with the defaults (`thresholdDb: -35`, `minSilenceMs: 700`, `padMs: 120`):

1. `silencedetect` reports one silent span from ≈ 2.000 s to ≈ 4.000 s (a 2-second gap, comfortably above the 700 ms minimum).
2. The 120 ms speech padding shrinks the span inward at both ends: start `2000 + 120 = 2120 ms`, end `4000 − 120 = 3880 ms`.

Result:

```json
{
  "version": 1,
  "ranges": [
    { "startMs": 2120, "endMs": 3880 }
  ],
  "durationMs": 6000
}
```

**Cost:** 10 credits.

## Best Practices

- Raise **Minimum silence** to ignore short breaths and inter-word gaps; lower it to catch brief pauses.
- If cuts are clipping the start of words, increase **Speech padding**; if silences feel too generous, decrease it.
- A noisy room (a fan, air conditioning) can sit above the default threshold, so its gaps are not found — raise **Silence threshold** toward 0 (e.g. to `-30`) so that ambience counts as silence. Lower it (e.g. to `-45`) when quiet speech is being marked as silence.
- The `ranges` are on the **source** clock, so they line up with the original audio/video timeline for a downstream edit.

## Common Use Cases

- Find dead air and long pauses in a podcast or interview before an editing pass.
- Feed the ranges into a downstream tighten/edit step that removes silence.
- Measure how much of a recording is silence versus speech.
