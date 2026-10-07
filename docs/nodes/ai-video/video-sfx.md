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
| `promptPrefix` / `promptSuffix` | text | -- | Optional pre/post text wrapped around the prompt at run time (settings panel → **Pre & post text**; hidden from app users; captured by presets). See [Prompt pre & post text](../../prompt-pre-post-text.md). |

## Inputs & Outputs

**Inputs:**
- Video (required) — source video (mp4, mov, webm). Maximum 300 seconds.
- Prompt (optional) — text describing the desired SFX. May be wired from a Text Prompt or Generate Text node.
- Negative (optional) — text describing sounds to exclude. Defaults to `"music"`.

**Outputs:**
- Video — an mp4 with the generated SFX merged in (original audio dropped).

## Credit Cost

Duration is derived automatically from the input video via ffprobe. The duration is rounded up into the next bucket; the bucket determines the cost shown in the editor and charged at run time. A single-node run, a run inside a workflow, and MCP or SDK calls all measure the clip and charge its bucket, and the whole clip is scored on every path.

| Input video duration | Bucket | Credits / version |
|----------------------|--------|------------------:|
| ≤ 8s   | `:8s`   | 10  |
| ≤ 15s  | `:15s`  | 10  |
| ≤ 30s  | `:30s`  | 20  |
| ≤ 60s  | `:60s`  | 30  |
| ≤ 120s | `:120s` | 50  |
| ≤ 300s | `:300s` | 110 |

For multi-version runs the cost multiplies: `versions × per-version`. Worked examples:

| Duration | Versions | Total credits |
|----------|---------:|--------------:|
| 5s       | 1        | 10            |
| 8s       | 1        | 10            |
| 12s      | 1        | 10            |
| 30s      | 1        | 20            |
| 31s      | 1        | 30            |
| 60s      | 4        | 120           |
| 180s     | 1        | 110           |

If ffprobe fails to derive a duration, the `:8s` bucket is used as a fallback and a warning is logged.

Before a run, the editor and the server's run estimate read the length the graph gives the video. On a rendered video (an Apply EDL output) they quote the bucket for the render's estimated length, at most the `:300s` bucket, the same bucket the listing uses (a Trailer's 2 minutes is the `:120s` bucket, a Tighten of an unknown recording the `:300s` bucket); a Trim, Loop, Combine Videos or Video SFX on it passes on the length it makes. Otherwise they read the length the upstream node reports. If no length is known yet, they quote the `:8s` bucket, and the run then charges the bucket for the clip it measures. Inside a workflow, each Video SFX node makes one version per run.

In the price a published app or template lists, a Video SFX node on any recording the app's or template's user replaces (the episode, or a second recording such as an intro card), or on the output of a Trim, Loop or Combine Videos node whose length follows one, is listed at the fixed 300-second price (110 credits per version), whatever the recording's length: a longer video is refused, so no run is charged more. On a rendered video it is listed at the render's estimated length: the 300-second price when that length follows the recording (a Tighten's render), the render's own bucket when it does not (a Trailer's 2 minutes). On the output of a Trim, Loop or Combine Videos node of a known length (a fixed 20-second trim window, say) it is listed at that length's bucket. On a generated video (Generate Video, Image to Video or Text to Video) it is listed at the bucket for the generation's configured duration (8 seconds when none is set, as a run of the step after it counts it), or the length the model renders when that is longer (its longest clip on auto). On the output of another step whose length the listing does not follow (such as Resize Video or Lip Sync), it is listed at the 8-second bucket, a documented exception: a run charges the bucket for the length it measures, which can be more than the listing. On a recording the user cannot replace, it is listed at that recording's bucket.

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
- Keep clips short for iteration — `:8s` and `:15s` buckets share the same 10-credit BASE, so an 8-second test clip costs the same as a 15-second one.
- If you want layered audio (e.g. SFX over music), generate the SFX here then mix the music in via Mix Audio.

## Common Use Cases

- Add foley or ambience to silent AI-generated video.
- Generate room tone, weather, or environmental SFX for short cinematic clips.
- Produce multiple alternate takes (`versions: 4`) and pick the best via a downstream Reduce node.
- Layer with the original dialogue/music using Merge Video & Audio.

## Powered by

This node sends your video to [Replicate](https://replicate.com) for processing using the [`zsxkib/mmaudio`](https://replicate.com/zsxkib/mmaudio) model, based on the [open-source MMAudio project](https://github.com/hkchengrex/MMAudio). See [Replicate's terms](https://replicate.com/terms) for licensing and attribution.
