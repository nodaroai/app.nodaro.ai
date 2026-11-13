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
| ≤ 8s   | `:8s`   | 11<!-- credits: replicate-mmaudio:8s --> |
| ≤ 15s  | `:15s`  | 11<!-- credits: replicate-mmaudio:15s --> |
| ≤ 30s  | `:30s`  | 22<!-- credits: replicate-mmaudio:30s --> |
| ≤ 60s  | `:60s`  | 33<!-- credits: replicate-mmaudio:60s --> |
| ≤ 120s | `:120s` | 55<!-- credits: replicate-mmaudio:120s --> |
| ≤ 300s | `:300s` | 121<!-- credits: replicate-mmaudio:300s -->|

For multi-version runs the cost multiplies: `versions × per-version`. Worked examples:

| Duration | Versions | Total credits |
|----------|---------:|--------------:|
| 5s       | 1        | 11<!-- credits: replicate-mmaudio:8s -->           |
| 8s       | 1        | 11<!-- credits: replicate-mmaudio:8s -->           |
| 12s      | 1        | 11<!-- credits: replicate-mmaudio:15s -->           |
| 30s      | 1        | 22<!-- credits: replicate-mmaudio:30s -->           |
| 31s      | 1        | 33<!-- credits: replicate-mmaudio:60s -->           |
| 60s      | 4        | 132<!-- credits: 4*replicate-mmaudio:60s -->          |
| 180s     | 1        | 121<!-- credits: replicate-mmaudio:300s -->          |

If ffprobe fails to derive a duration, the `:8s` bucket is used as a fallback and a warning is logged.

Before a run, the node's price, its Run button and the workflow's estimate (in the editor, and on the server: `POST /v1/credits/estimate-workflow`, MCP) read the same length for the video on the `video` wire:

- **A video another node makes in this run** is read at the length that node will produce at its settings: a generation at the length its model renders (Auto at its longest clip, a reference video wired or not, unless the run declares a Seedance 2.5 Edit of it: then that clip rounded up plus a second; a length set through a Duration node or a field mapping as the run reads it), an Extend Video at its source plus the seconds it adds, a Trim, Loop or Combine Videos by the length it passes on (a Trim with Lossless on, whose cut starts at the keyframe at or before the window and can run a few frames past its end: at most to the end of its cut plus 0.6 seconds and never past its input, at its input's length when the cut runs to the clip's end or is set in frames; on an input of unknown length, a cut that keeps the last N seconds at N seconds, a minimum, and an open or frames cut as a length nothing knows). **Each clip made on the way adds about a tenth of a second**: a made clip runs a frame or an audio track a little past its planned length, the run measures the whole file, and any started second counts. So a generation set to 15 s is quoted at the `:30s` bucket (22 credits<!-- credits: replicate-mmaudio:30s --> per version), as a 15.04-second clip is charged.
- **A node that does not run in this run** (Video SFX run on its own, or a frozen node) hands on the result it already holds, so it is read at the length recorded for that result. A video generation (Generate Video, Image to Video, Text to Video, Video to Video) whose result recorded no length — a fixed-length run records none — made that result at its settings, so it is read at the length they make, its Duration, as a clip the node makes in this run is read.
- **An uploaded clip**, or one added from your own uploads in the Library, is read at the length measured when it was uploaded.
- **A rendered video** (an Apply EDL output, directly or through a step that keeps its length, such as a [Tighten Episode](../processing-video/tighten-episode.md#steps-after-the-node)'s captioned episode) is read at the render's estimated length, at most the `:300s` bucket, the same bucket the listing uses (a Trailer's 40 seconds — the longest trailer the plan cuts — is the `:60s` bucket, a Tighten of an unknown recording the `:300s` bucket).
- A length the upstream node only stores (an earlier result of a node that runs again, the seconds an extension adds) is never read.

If no length is known yet (nothing wired, a VEO or Runway extension, a video link, a Library video whose length was not recorded), they quote the `:300s` bucket (121 credits<!-- credits: replicate-mmaudio:300s --> per version), which is the most a run can be charged. The run then charges the bucket for the clip it measures. Inside a workflow, each Video SFX node makes one version per run.

In the price a published app or template lists, a Video SFX node on any recording the app's or template's user replaces (the episode, or a second recording such as an intro card), or on the output of a Trim, Loop or Combine Videos node whose length follows one, is listed at the fixed 300-second price (121 credits<!-- credits: replicate-mmaudio:300s --> per version), whatever the recording's length: a longer video is refused, so no run is charged more. On a rendered video it is listed at the render's estimated length: the 300-second price when that length follows the recording (a Tighten's render), the render's own bucket when it does not (a Trailer's 40 seconds, the `:60s` bucket). On the output of a Trim, Loop or Combine Videos node of a known length (a fixed 20-second trim window, say) it is listed at that length's bucket. On a video another node makes (a generation, an extension, a lip sync or an avatar, a step that keeps its input whole, …) it is listed at the length it is quoted at before a run — the length that node will produce, about a tenth of a second added for each clip made on the way (a 30-second generation is the `:60s` bucket, 33 credits<!-- credits: replicate-mmaudio:60s --> per version; a length the app's user types freely, the longest the model renders) — at most the 300-second price. On a video whose length is not known before the run (a YouTube or other video link the user cannot replace, a GIF to Video, the output of Render Video or Manual Edit, a VEO or Runway extension, a Suno music video, a narrated step whose audio is wired in or is a generated voice whose script comes from a source the listing cannot bound (not a literal text, an input with a character limit, or a Prompt or AI Writer node), or a list or sub-workflow), it is listed at the 300-second price, the most a run accepts. On a recording the user cannot replace, it is listed at that recording's bucket.

## Constraints

- Supported input formats: MP4 (H.264), MOV, WebM.
- Maximum duration: **300 seconds** (5 minutes). Longer videos are rejected with HTTP 400 `video_duration_exceeds_limit`.
- Maximum versions per run: **4**.
- If a run's versions cannot all be queued to start, `POST /v1/video-sfx` answers `500 internal_error` with `error.startedJobIds` naming the versions that did start (follow those; the list is empty when none did); the others are failed and their credits refunded.
- Recommended input resolution: up to 1080p (higher resolutions are untested and increase processing time).

## Determinism

- `seed` defaults to random per run.
- If you set a seed and `versions > 1`, each version uses `seed + index` so all takes are reproducible but distinct.
- If you leave `seed` blank (or set `-1`), every version uses a fresh random seed.

## Best Practices

- Write prompts that describe the sound, not the on-screen action ("crackling fire" beats "campfire scene").
- Keep clips short for iteration — `:8s` and `:15s` buckets share the same 11-credit<!-- credits: replicate-mmaudio:8s --> price, so an 8-second test clip costs the same as a 15-second one.
- If you want layered audio (e.g. SFX over music), generate the SFX here then mix the music in via Mix Audio.

## Common Use Cases

- Add foley or ambience to silent AI-generated video.
- Generate room tone, weather, or environmental SFX for short cinematic clips.
- Produce multiple alternate takes (`versions: 4`) and pick the best via a downstream Reduce node.
- Layer with the original dialogue/music using Merge Video & Audio.

## Powered by

This node sends your video to [Replicate](https://replicate.com) for processing using the [`zsxkib/mmaudio`](https://replicate.com/zsxkib/mmaudio) model, based on the [open-source MMAudio project](https://github.com/hkchengrex/MMAudio). See [Replicate's terms](https://replicate.com/terms) for licensing and attribution.
