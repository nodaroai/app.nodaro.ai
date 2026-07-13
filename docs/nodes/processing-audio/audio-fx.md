# Audio FX
> Apply creative audio effects — scenario reverbs, telephone/megaphone, echo, or custom delay+EQ (FFmpeg).

## Overview

The Audio FX node (internally `audio-fx`) processes an audio clip with a chosen effect, using FFmpeg. Its primary use is **placing a dry voice into a scene** — a flat ElevenLabs/TTS voice dropped onto a video sounds "outside" the picture; a room reverb makes it read as recorded in that space. It also covers character effects (telephone, megaphone) and a Custom mode for manual delay + EQ.

It pairs naturally with **Text to Speech → Audio FX (Room) → Merge Video & Audio**, and with **Audio Separation** (apply FX to a single separated stem).

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Label | `string` | `"Audio FX"` | Display name on the canvas |
| Effect | preset | `room` | Which effect to apply (see Presets) |
| Wet / Dry mix | `0–100` | per-preset | Reverb presets only — higher = more room, less direct voice |
| Delay (ms) / Decay | numbers | `250` / `0.4` | Echo + Custom |
| EQ Low / High (dB) | `-20..20` | `0` | Custom only |

## Presets

**Scenario reverbs** (convolution; place the voice in a space):

| Preset | Space |
|--------|-------|
| Room (indoor) | ordinary room — dialogue |
| Bathroom | small, bright, tiled |
| Car interior | tight, damped cabin |
| Hall / Lobby | medium room |
| Concert Hall | large, lush tail |
| Church | cathedral — long, dark |
| Cave | dark, diffuse |
| Arena / Stadium | huge, bright PA tail |
| Outdoor (open air) | almost dry, faint reflections |

**Character / time:** Telephone (band-limited line), Megaphone / PA (mid-forward + grit), Echo / Slap-back (delay), Custom (delay + EQ).

## Inputs & Outputs

- **Input**: `in` — any audio (a generated voice, an uploaded clip, or a separated stem).
- **Output**: `audio` — the processed audio (URL), connectable to any audio input (Merge Video & Audio, Voice Changer, Mix Audio, etc.).

## Credits

Flat **2 credits** per run (FFmpeg processing, no provider markup).

Reverb presets calibrate their level against the rendering engine at run
time. If that calibration cannot complete safely, the run **fails and the
credits are refunded** — the node never renders a reverb at a guessed level.
A transient failure succeeds on retry; if the same run keeps failing with a
calibration error, report it rather than retrying further.

## Best Practices

- For dialogue indoors, **Room** with mix ~25–35 is usually enough — too much reverb muddies speech.
- Match the reverb to the shot: **Church**/**Cave** for big stone spaces, **Car** for interiors, **Outdoor** for exteriors (keep it subtle).
- Apply FX **before** Merge Video & Audio so the placed voice is what lands on the video.
