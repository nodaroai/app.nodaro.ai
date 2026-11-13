# Trim Video

> Cut video by absolute time, relative offset (seconds or frames), keep first/last N seconds, or smart-loop-cut to find the cleanest loop boundary.

## Overview

The Trim Video node extracts or shapes a section of video. Six modes:

- **Range — start/end (seconds)** — absolute start/end times
- **Trim edges (seconds)** — trim N seconds from start AND/OR end (seconds-mirror of frames mode)
- **Keep first N seconds** — output is the first N seconds of the source (clamped to source length)
- **Keep last N seconds** — output is the last N seconds of the source (worker probes duration; works regardless of source length)
- **Trim edges (frames)** — frame-precise trim from start and/or end (worker probes the source's fps)
- **Smart Loop Cut** — picks the trailing frame closest to frame 0 by PSNR pixel similarity and trims there (best for VEO 3.1 first+last-frame outputs whose tail dissolve isn't always exactly 8 frames in)

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Lossless (snap to keyframe) | Checkbox | Off | Stream-copies the cut instead of re-encoding — zero quality loss and much faster. The start snaps back to the nearest keyframe, so the clip may begin up to a few seconds earlier than requested (never later), and it can end a few frames past the requested end. Falls back to a precise re-encode for sources that cannot be copied. Not used by Smart loop cut |
| Trim Mode | Select | time | One of the six modes above |
| Start Time (s) | Number | 0 | Start position in seconds (`time` mode) |
| End Time (s) | Number | — | End position in seconds (`time` mode). On the node — the editor, a workflow, a published app — an end left empty or at 0 cuts to the end of the clip. A request to `POST /v1/trim-video` leaves `endTime` out for that: an `endTime` it sends must be after `startTime` |
| Trim from start (s) | Number | 0 | Seconds trimmed from the start (`seconds` mode) |
| Trim from end (s) | Number | 0 | Seconds trimmed from the end (`seconds` mode) |
| Keep first (s) | Number | — | Output is the first N seconds (`keep-first-seconds` mode) |
| Keep last (s) | Number | — | Output is the last N seconds (`keep-last-seconds` mode) |
| Trim Start Frames | Number | 0 | Frames trimmed from the start (`frames` mode) |
| Trim End Frames | Number | 0 | Frames trimmed from the end (`frames` mode) |
| Lookback Window (frames) | Number | 16 | Trailing-frame search window (2-64), `smart-loop-cut` mode |
| Output Silent Video | Checkbox | off | Strip audio from the trimmed clip — single output is silent |

## Inputs & Outputs

**Inputs:** Video (required)
**Outputs:** `video-out` — single trimmed video clip — silent when "Output Silent Video" is enabled, otherwise audio is preserved.

## Credit Cost

Trim Video is **dynamically priced** based on output length, in units of **11 credits**<!-- credits-rate: trim-video --> — the run's units priced together as one charge:

- **Time mode:** 11 credits<!-- credits-rate: trim-video --> per 5 seconds of `(endTime - startTime)`, minimum 11<!-- credits: trim-video -->. A window that runs past the clip's end stops at the clip, and is charged only up to the clip's end; one that starts at or past the end is the minimum. With no end time (on the node, also an end of 0, its default) the cut runs to the end of the clip, and is charged from the start time to the clip's end
- **Seconds mode:** 11 credits<!-- credits-rate: trim-video --> per 5 seconds of `(upstream - trimStartSeconds - trimEndSeconds)`
- **Keep first/last seconds:** 11 credits<!-- credits-rate: trim-video --> per 5 seconds of `min(upstream, keepN)`
- **Frames mode:** 11 credits<!-- credits-rate: trim-video --> per 5 seconds of remaining duration (assumes 24fps for estimation)
- **Smart loop cut:** 11 credits<!-- credits-rate: trim-video --> per 5 seconds of upstream length + 11 credits<!-- credits-rate: trim-video --> per started 24 frames of lookback

Examples:

| Configuration | Output | Credits |
|---|---|---|
| Time mode, 0–10s | 10s | 22<!-- credits: trim-video@2 --> |
| Time mode, 0–60s | 60s | 132<!-- credits: trim-video@12 --> |
| Time mode from 0 with no end, on a 30s clip | 30s | 66<!-- credits: trim-video@6 --> |
| Seconds mode on a 30s clip, trim 2+3 | 25s | 55<!-- credits: trim-video@5 --> |
| Keep first 8s of a 20s clip | 8s | 22<!-- credits: trim-video@2 --> |
| Keep last 10s of a 30s clip | 10s | 22<!-- credits: trim-video@2 --> |
| Frames mode on a 10s clip, trim 24+24 frames | ~8s | 22<!-- credits: trim-video@2 --> |
| Smart loop cut on a 10s clip, lookback 16 | ≤10s | 33<!-- credits: trim-video@3 --> |

A single-node run, a run inside a workflow or a published app, and MCP or SDK calls are all charged this way, at the length the run measures.

**Priced by what is cut.** A run is charged for the cut it makes, read from the fields the request sets in the order the cut is decided — `smartLoopCut`, then the keep or seconds fields (keep last, keep first, trim seconds), then the frames fields, then the time range — whatever `trimMode` it names. A request with only `smartLoopCut: true` (as the MCP `trim_video` tool sends a smart loop cut) is charged a smart loop cut, and one with only `trimStartFrames` / `trimEndFrames` a frames trim. A request that sets the fields of two modes is charged the larger of the two.

**Measured before the charge.** Every run measures the video it is given (the file's own length, the length it is cut by) before anything is reserved, and is charged by that length; a length sent with the request (`upstreamDuration`) is ignored. A clip that cannot be read is refused before anything is charged: `Could not read the video. The file may be corrupted or an unsupported format.` How long measuring may take depends on who is waiting. On a single-node run, an API call or an MCP call — someone waits for the answer — the request is measured within 90 seconds: reading a clip's header takes at most 30 seconds, and a clip whose header carries no length (a recording made in a browser, for example) is read in full, packet by packet, in what is left of the 90 seconds. In a workflow or a published app, a clip's header takes at most 30 seconds and a full read at most 120 seconds, the time the render itself gets to download the clip. A clip read in full has no size limit other than that time. A measure that runs out of time is answered `503 probe_timeout` (`Timed out reading … — run it again.`; in a workflow the node fails with that message), with nothing charged, and can simply be run again. A link whose host cannot be looked up at that moment is answered `503 source_unreachable` (`Could not reach … — run it again.`) the same way; a link whose host does not exist is refused like a clip that cannot be read (`400 invalid_video_duration`, `Could not read …: its host was not found. Check the link.`). If the server sees the request closed while its clips are measured, before the charge, the measure stops there: no job is created and nothing is charged. A request it does not see closed — a connection held open on the way to the server, or an MCP call, which runs the step on the server itself — is measured, run and charged as usual. Each started 5 seconds is a unit, and the charge forgives up to 0.1 seconds past a 5-second mark on the clip: a 10-second generation that measures 10.04 seconds is charged as 10 seconds, while a clip of 10.15 seconds is charged the next unit.

**Re-measured at the render.** The run measures the video again once it has downloaded it, before anything is rendered. A clip that, less about half a second, now needs more units than the run was charged (a link that now serves a longer file) is refused — `The video is 30 seconds, longer than the 10 seconds this run was priced for — run it again` — and the charge is refunded; a clip that has grown but still fits the units it was charged renders as charged. A run that carries no priced length is refused and refunded too.

**Before a run**, the Run button, the workflow's estimate and a published app's listed price quote the same length for the video each wire will hand on:

- a video another node makes in this run: the length that node will produce at its settings — a generation at the length its model renders (Auto at its longest clip, a reference video wired or not, since a run that declares nothing lets the model pick its length; a Seedance 2.5 Edit of a wired reference video at that clip rounded up plus a second, an Extend as the run resolves it; a length set through a Duration node or a field mapping as the run reads it; a length an app's user types freely, at the longest the model renders), an Extend Video at its source plus the seconds it adds, a Trim, Loop or Combine Videos by the length it passes on (a Trim with Lossless on, whose cut starts at the keyframe at or before the window and can run a few frames past its end: at most to the end of its cut plus 0.6 seconds and never past its input, at its input's length when the cut runs to the clip's end or is set in frames; on an input of unknown length, a cut that keeps the last N seconds at N seconds, a minimum, and an open or frames cut as a length nothing knows) — plus about a tenth of a second for each clip made on the way, so the quote is not below the measured charge;
- a node that does not run in this run (you run the step on its own, or the node is frozen): the length recorded with the result it hands on. A generated video made at an automatic length, or by a Seedance 2.5 Edit or Extend, records the length it really is, leaving off at most a quarter second past a whole second; the estimate adds that quarter second back, so it is never below the clip the run measures. A video generation (Generate Video, Image to Video, Text to Video, Video to Video) whose result recorded no length — a fixed-length run records none — made that result at its settings, so it is read at the length they make, its Duration, as a clip the node makes in this run is read;
- an uploaded clip, or one added from your own uploads in the Library: the length measured when it was uploaded;
- a render's output (Apply EDL, a [Tighten Episode](./tighten-episode.md#steps-after-the-node)'s episode): the render's estimated length, rounded up to whole minutes;
- the output of a step that keeps its input's length (Add Captions, Resize Video, Fade Video, Face Swap, Video Upscale, …): its input's length, read by these same rules;
- when nothing can say how long a video will be (a Library video whose length was not recorded, a VEO or Runway extension, a video link): an **8-second stand-in**. That is a minimum: the run is charged the length it measures.

For example, a Trim set to **Seconds** with nothing cut, after a 15-second generation, is quoted at 15 seconds (15.1 seconds less the 0.1-second grace) — 33 credits<!-- credits: trim-video@3 --> — and charged by the clip it receives. A fixed window (time mode with an end) is priced by its window, up to the clip's end: a 0–60-second window on a 12-second clip is charged as 11.9 seconds, 33 credits<!-- credits: trim-video@3 -->.

**The length a Trim hands on.** Each run records the length of the file it made, on the job's output and on the result the editor keeps (the rows of an MCP conversation's canvas, and the second and later rows of a fan-out, carry none: a later run reads those at the length the Trim's settings pass on). A step after it that is priced by a length it is handed (Video Analysis, AI Audit) is priced by that length in a workflow run. Every quote reads a Trim that does not run again at that length too. Steps that measure the clip they are given (Loop, Combine Videos, Video SFX, …) measure it, as always. Before a Trim runs, a quote reads a Trim with Lossless on at most to the end of its cut plus 0.6 seconds, never past its input: its stream copy can run a few frames past the requested end (about 0.08 seconds at 24 frames a second, up to about half a second at 5); the bound holds down to about 5 frames a second, and a sparser clip (a slideshow, a sparse screen recording) can run a little further. On an input of unknown length, a lossless cut that keeps the last N seconds is read at N seconds, a minimum: the cut can start earlier.

## Best Practices

- Use **Seconds mode** when you want a relative trim like the frames mode but in seconds (works on any-length input).
- Use **Keep last N seconds** to grab the tail of a clip regardless of its length (e.g., the last 10s of any video).
- Use **Keep first N seconds** to cap a clip to a maximum duration.
- Use **Frames mode** when frame alignment matters (e.g., 24fps VEO outputs and you want to drop the last 8 frames precisely).
- Use **Smart Loop Cut** for stochastic tails — beats a fixed offset on outputs whose ideal cut isn't deterministic.
- Leave Start Time at 0 if you only need to shorten the end (Time mode).
- Use before Combine Videos to select the best segments from multiple clips.

## Common Use Cases

- Extract a specific scene from a longer video
- Remove unwanted intro/outro from generated video
- Cut AI-generated video to exact duration needed
- Drop the VEO tail dissolve precisely (frames or smart-cut)
- Grab the last N seconds of any clip for a quick outro (`keep-last-seconds`)
- Prepare clips for combination or composition

## Tips

- All modes that depend on source length (`seconds`, `keep-first-seconds`, `keep-last-seconds`, `frames`) probe duration server-side, so they work on any-length input without needing the user to know the source length up front.
- Time mode supports decimal precision (e.g., 2.5 for 2.5 seconds)
- Frame mode requires the worker to probe the source fps — it will hard-error rather than silently mis-convert if probing fails
- Smart loop cut returns metadata (chosen frame index, PSNR) in the job result, useful for debugging seam quality
- If you only need audio from the video, use Trim Audio instead
