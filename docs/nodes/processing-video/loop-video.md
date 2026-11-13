# Loop Video

> Repeat video to reach a target duration or count, with optional smart-loop-cut for seamless seams.

## Overview

The Loop Video node extends short video clips by repeating them. Choose between repeating a fixed number of times or looping until a target duration is reached. An optional **Smart Loop Cut** preprocess trims the source clip to its cleanest loop boundary BEFORE concatenating, eliminating seam discontinuity at every internal repeat — useful for VEO 3.1 outputs and any clip with a stochastic tail.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Mode | Select | repeat | repeat (N times) or duration (loop to target) |
| Repeat Count | Number | 2 | Number of repetitions: 2-20x (repeat mode) |
| Target Duration | Number | — | Target length in seconds: 1-300s (duration mode) |
| Smart Cut Before Looping | Checkbox | off | Trim input to the cleanest loop boundary before concat |
| Lookback Window (frames) | Number | 16 | How many trailing frames to evaluate (2-64) when smart cut is on |

## Inputs & Outputs

**Inputs:** Video (required)
**Outputs:** `video-out` — looped video

## Credit Cost

Loop Video is **dynamically priced** based on output length and smart-cut work:

- **Base:** 11 credits<!-- credits-rate: loop-video --> per started 5 seconds of output (minimum 11 credits<!-- credits: loop-video -->)
- **Smart cut adder:** +11 credits<!-- credits-rate: loop-video --> per started 24 frames of lookback (when smart cut is enabled)

The base and the adder are priced together as one charge.

Examples:

| Configuration | Output | Credits |
|---|---|---|
| Repeat 4× a 5s clip | 20s | 44<!-- credits: loop-video@4 --> |
| Repeat 3× a 10s clip | 30s | 66<!-- credits: loop-video@6 --> |
| Loop to 60s | 60s | 132<!-- credits: loop-video@12 --> |
| Loop to 30s + smart cut, lookback 16 | 30s | 77<!-- credits: loop-video@7 --> (66<!-- credits-rate: loop-video@6 --> base + 11<!-- credits-rate: loop-video --> cut) |
| Loop to 60s + smart cut, lookback 64 | 60s | 165<!-- credits: loop-video@15 --> (132<!-- credits-rate: loop-video@12 --> base + 33<!-- credits-rate: loop-video@3 --> cut) |

A single-node run, a run inside a workflow or a published app, and MCP or SDK calls are all charged this way, at the length the run measures.

**Measured before the charge.** Every run measures the video it is given (the file's own length) before anything is reserved, and is charged by that length; a length sent with the request (`upstreamDuration`) is ignored. A clip that cannot be read is refused before anything is charged: `Could not read the video. The file may be corrupted or an unsupported format.` How long measuring may take depends on who is waiting. On a single-node run, an API call or an MCP call — someone waits for the answer — the request is measured within 90 seconds: reading a clip's header takes at most 30 seconds, and a clip whose header carries no length (a recording made in a browser, for example) is read in full, packet by packet, in what is left of the 90 seconds. In a workflow or a published app, a clip's header takes at most 30 seconds and a full read at most 120 seconds, the time the render itself gets to download the clip. A clip read in full has no size limit other than that time. A measure that runs out of time is answered `503 probe_timeout` (`Timed out reading … — run it again.`; in a workflow the node fails with that message), with nothing charged, and can simply be run again. A link whose host cannot be looked up at that moment is answered `503 source_unreachable` (`Could not reach … — run it again.`) the same way; a link whose host does not exist is refused like a clip that cannot be read (`400 invalid_video_duration`, `Could not read …: its host was not found. Check the link.`). If the server sees the request closed while its clips are measured, before the charge, the measure stops there: no job is created and nothing is charged. A request it does not see closed — a connection held open on the way to the server, or an MCP call, which runs the step on the server itself — is measured, run and charged as usual. Each started 5 seconds is a unit, and the charge forgives up to 0.1 seconds past a 5-second mark on the clip, before its copies are counted: a 10-second generation that measures 10.04 seconds is charged as 10 seconds, while a clip of 10.15 seconds is charged the next unit.

**Re-measured at the render.** The run measures the video again once it has downloaded it, before anything is rendered. A clip that, less about half a second, now needs more units than the run was charged (a link that now serves a longer file) is refused — `The video is 30 seconds, longer than the 10 seconds this run was priced for — run it again` — and the charge is refunded; a clip that has grown but still fits the units it was charged renders as charged. A run that carries no priced length is refused and refunded too.

**Before a run**, the Run button, the workflow's estimate and a published app's listed price quote the same length for the video each wire will hand on:

- a video another node makes in this run: the length that node will produce at its settings — a generation at the length its model renders (Auto at its longest clip, a reference video wired or not, since a run that declares nothing lets the model pick its length; a Seedance 2.5 Edit of a wired reference video at that clip rounded up plus a second, an Extend as the run resolves it; a length set through a Duration node or a field mapping as the run reads it; a length an app's user types freely, at the longest the model renders), an Extend Video at its source plus the seconds it adds, a Trim, Loop or Combine Videos by the length it passes on (a Trim with Lossless on, whose cut starts at the keyframe at or before the window and can run a few frames past its end: at most to the end of its cut plus 0.6 seconds and never past its input, at its input's length when the cut runs to the clip's end or is set in frames; on an input of unknown length, a cut that keeps the last N seconds at N seconds, a minimum, and an open or frames cut as a length nothing knows) — plus about a tenth of a second for each clip made on the way, so the quote is not below the measured charge;
- a node that does not run in this run (you run the step on its own, or the node is frozen): the length recorded with the result it hands on. A generated video made at an automatic length, or by a Seedance 2.5 Edit or Extend, records the length it really is, leaving off at most a quarter second past a whole second; the estimate adds that quarter second back, so it is never below the clip the run measures. A video generation (Generate Video, Image to Video, Text to Video, Video to Video) whose result recorded no length — a fixed-length run records none — made that result at its settings, so it is read at the length they make, its Duration, as a clip the node makes in this run is read;
- an uploaded clip, or one added from your own uploads in the Library: the length measured when it was uploaded;
- a render's output (Apply EDL, a [Tighten Episode](./tighten-episode.md#steps-after-the-node)'s episode): the render's estimated length, rounded up to whole minutes;
- the output of a step that keeps its input's length (Add Captions, Resize Video, Fade Video, Face Swap, Video Upscale, …): its input's length, read by these same rules;
- when nothing can say how long a video will be (a Library video whose length was not recorded, a VEO or Runway extension, a video link): an **8-second stand-in**. That is a minimum: the run is charged the length it measures.

For example, a Loop repeating twice after a 15-second generation is quoted at 30 seconds (twice 15.1 seconds less the 0.1-second grace) — 66 credits<!-- credits: loop-video@6 --> — and charged by the clip it receives; three times after a 10-second generation, 66 credits<!-- credits: loop-video@6 --> too. Loop to a target length is priced by its target whatever the clip, though the clip is still measured.

## Best Practices

- Use "duration" mode when you need a specific length (e.g., 30s for social media)
- Enable **Smart Loop Cut** for VEO 3.1 outputs and any clip with a stochastic tail dissolve — it picks the trailing frame closest to frame 0 (by PSNR pixel similarity) and trims there, beating a fixed offset on stochastic outputs
- Ensure loop points are seamless — clips that start and end similarly loop better
- Use with Fade In/Out to smooth loop transitions

## Common Use Cases

- Extend a 5-second AI-generated clip to 30 seconds for Instagram
- Create repeating background videos for presentations
- Loop ambient or atmospheric footage for extended scenes
- Build seamless perfect-loops from VEO 3.1 first+last-frame outputs (with smart cut on)

## Tips

- Duration mode trims the final loop to exactly the target length
- For truly seamless loops, generate source video with matching start and end frames AND enable smart cut
- Smart cut runs a single ffmpeg pass + per-candidate PSNR comparison — adds ~1-3s of work depending on lookback
