# Video SFX

> Generate synchronized sound effects, foley, or ambient audio for a video clip.

## Overview

The Video SFX node takes an input video plus an optional text prompt and produces an mp4 with AI-generated sound effects merged in. It uses Replicate's `zsxkib/mmaudio` model (based on the open-source MMAudio project) and is ideal for adding rain, footsteps, ambience, room tone, foley, or other diegetic sounds to silent or AI-generated video.

> ⚠️ **Replaces the existing audio track.** The original audio of the input video is dropped and replaced with the generated SFX. To keep the original audio, route this node's output into a **Merge Video & Audio** node with the original audio as a second input.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Prompt | Textarea | — | Describes the desired sound (e.g., "rain on metal roof", "footsteps in dry leaves"). Connected text/prompt nodes override the config-panel value. |
| Negative prompt | Textarea | `music` | Sounds to exclude. mmaudio's default keeps the output SFX-only — change it if you actually want musical SFX. |
| Versions | Number | 1 | How many takes to generate per run (1–4). Each version uses a distinct seed for variety; cost scales linearly. |
| cfg_strength | Number | 4.5 | Advanced — guidance scale (1.0–10.0). |
| num_steps | Number | 25 | Advanced — diffusion steps (10–50). |
| seed | Number | random | Advanced — leave blank or `-1` for random. When set, version N uses `seed + N`. |

## Inputs & Outputs

**Inputs:**
- Video (required) — source video (mp4, mov, webm). Maximum 300 seconds.
- Prompt (optional) — text describing the desired SFX. May be wired from a Text Prompt or Generate Text node.
- Negative (optional) — text describing sounds to exclude. Defaults to `"music"`.

**Outputs:**
- Video — an mp4 with the generated SFX merged in (original audio dropped).

## Credit Cost

Duration is derived automatically from the input video via ffprobe. The duration is rounded up into the next bucket; the bucket determines the BASE cost. The system markup (default 25%) is applied on top.

| Input video duration | Bucket | BASE credits / version | Visible credits / version |
|----------------------|--------|----------------------:|--------------------------:|
| ≤ 8s   | `:8s`   | 1  | 2  |
| ≤ 15s  | `:15s`  | 1  | 2  |
| ≤ 30s  | `:30s`  | 2  | 3  |
| ≤ 60s  | `:60s`  | 3  | 4  |
| ≤ 120s | `:120s` | 5  | 7  |
| ≤ 300s | `:300s` | 11 | 14 |

For multi-version runs the cost multiplies: `versions × per-version`. Worked examples:

| Duration | Versions | BASE total | Visible total |
|----------|---------:|-----------:|--------------:|
| 5s       | 1        | 1          | 2             |
| 8s       | 1        | 1          | 2             |
| 12s      | 1        | 1          | 2             |
| 30s      | 1        | 2          | 3             |
| 31s      | 1        | 3          | 4             |
| 60s      | 4        | 12         | 15            |
| 180s     | 1        | 11         | 14            |

If ffprobe fails to derive a duration, the `:8s` bucket is used as a fallback and a warning is logged.

## Constraints

- Supported input formats: MP4 (H.264), MOV, WebM.
- Maximum duration: **300 seconds** (5 minutes). Longer videos are rejected with HTTP 400 `video_duration_exceeds_limit`.
- Maximum versions per run: **4**.
- Recommended input resolution: up to 1080p (higher resolutions are untested and increase processing time).

## Determinism

- `seed` defaults to random per run.
- If you set a seed and `versions > 1`, each version uses `seed + index` so all takes are reproducible but distinct.
- If you leave `seed` blank (or set `-1`), every version uses a fresh random seed.

## Best Practices

- Write prompts that describe the sound, not the on-screen action ("crackling fire" beats "campfire scene").
- Keep clips short for iteration — `:8s` and `:15s` buckets share the same 1-credit BASE, so an 8-second test clip costs the same as a 15-second one.
- If you want layered audio (e.g. SFX over music), generate the SFX here then mix the music in via Mix Audio.

## Common Use Cases

- Add foley or ambience to silent AI-generated video.
- Generate room tone, weather, or environmental SFX for short cinematic clips.
- Produce multiple alternate takes (`versions: 4`) and pick the best via a downstream Reduce node.
- Layer with the original dialogue/music using Merge Video & Audio.

## Powered by

This node sends your video to [Replicate](https://replicate.com) for processing using the [`zsxkib/mmaudio`](https://replicate.com/zsxkib/mmaudio) model, based on the [open-source MMAudio project](https://github.com/hkchengrex/MMAudio). See [Replicate's terms](https://replicate.com/terms) for licensing and attribution.
