# Generate Video Pro

> Long-form video generation. Requests above a single segment's limit are automatically split into multiple Seedance 2 segments and stitched into one seamless clip. Cloud edition only.

## Overview

Generate Video Pro is a specialized, Seedance-2-family-only sibling of [Generate Video](./generate-video.md), built for one thing: clips longer than a single provider call can produce. Ask for a duration beyond the single-segment limit (15 seconds) and the node transparently generates multiple segments in sequence — each one continuing from where the last left off — and stitches them into a single output video.

Below that limit, Generate Video Pro behaves exactly like a normal single-shot Seedance 2 run and is priced the same way. Use it when you need one continuous clip longer than 15 seconds; use [Generate Video](./generate-video.md) for everything else (shorter clips, other providers, first+last frame, video-to-video, or the full multimodal reference/prompt-token surface).

**Cloud edition only.** Generate Video Pro requires a Cloud subscription.

## Input handles

| Handle | Direction | Accepts | Notes |
|---|---|---|---|
| `prompt` | target | Text producers + visual pickers | Main prompt, carried into every segment |
| `negative` | target | Text producers | Appended to every segment prompt as an `Avoid:` suffix (Seedance 2 has no native negative parameter) |
| `startFrame` | target | Image producers | Opening frame for the first segment (ignored when an Extend Source is wired) |
| `endFrame` | target | Image producers (limit 1) | Closing frame — applied to the **final segment** only. Requires a start anchor or a multi-segment run (a single-segment text-only run has no end-frame path) |
| `imageReferences` | target | Image producers (ordered, multi) | Reference images carried into generation |
| `videoReferences` | target | Video producers (limit 1) | **Extend Source** — the run continues from this clip: its final 2 seconds ride as the `@video_1` reference and its last frame anchors segment 1, the same continuation transport later segments use between themselves |
| `audio` | target | Audio producers (limit 1) | Post-generation soundtrack overlay, merged onto the **final stitched video** (wired audio at full volume, generated audio ducked to background) |
| `audioReferences` | target | Audio producers (ordered, max 3) | Seedance 2 multimodal reference audio — carried into **every segment** so voice/music conditioning stays consistent across the stitch |
| `assets` | target | Characters / objects / creatures / locations / faces | Identity references — their images join the reference pool (carried into **every segment** so identity persists across the whole video) and `@mentions` in the prompt resolve exactly as on Generate Video |
| `elements` | target | Element pickers | Prompt-fragment injection, identical to Generate Video |
| `look` | target | Look/cinematography pickers | Prompt-fragment injection, identical to Generate Video |
| `video` | source | n/a | Output — the final stitched video |

Generate Video Pro exposes **exactly Generate Video's input handles** — same names, same accepted producers (guarded by an automated parity test). The only behavioral deltas are the ones long-video stitching requires: `videoReferences` is the single Extend Source rather than a style-reference pool, reference images/audio are carried into every segment rather than a single call, and a lone `@mention` stays a reference instead of being promoted to the start frame (identity must persist beyond segment 1).

## Configuration

| Field | Type | Default | Notes |
|---|---|---|---|
| Provider | Select | `seedance-2` | `seedance-2` (full) or `seedance-2-fast` — the only providers the pro engine currently supports |
| Prompt | Text | — | Describes the video; also settable via the `prompt` handle |
| Duration | Number (4–cap) | 8s | Minimum 4s. Maximum is the configured cap (120s by default) — see [Duration cap](#duration-cap) |
| Aspect Ratio | Select | `adaptive` | 16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9 / Adaptive (matches the wired input) |
| Resolution | Select | `720p` | By provider — see [Providers](#providers) |
| Generate Audio | Checkbox | on | |
| Planner model | Select | Claude Opus 4.7 | The AI model that plans the segment breakdown for multi-segment runs — any model from the [LLM model registry](../../choosing-models.md) |
| Overlap anchor | Select | Off | Experimental A/B — anchor each continuation on the previous segment's **last keyframe** (the model replays the short overlap, locking motion and lighting, and the stitch removes the duplicate) or its **very last frame** (continue directly from the end). Both carry a longer overlapping reference; the stitch detects the model's actual behavior per join | Experimental — each continuation starts from the previous segment's last keyframe while its video reference runs past that point to the end; the model replays the overlap almost identically (locking motion, lighting and identity) before continuing, and the stitch removes the duplicate. Continuations request a little extra duration to compensate (self-tuning) |
| Audio context tail | Checkbox | Off | Experimental — each continuation also hears the last ~8 seconds of the video-so-far's soundtrack as an audio reference, helping the music continue seamlessly instead of drifting (skipped when Audio References are wired) |
| Rolling references | Checkbox | Off | Experimental — after each segment the engine notes where every recurring entity was last seen; entities that return after being off-screen get their last-seen shot injected as an extra reference (video clip or frame) so identity and position carry across absences |
| Clean word cut | Checkbox | Off | Experimental — each non-final segment generates one extra second, then is losslessly trimmed at the nearest gap between sung/spoken words near its planned length, so the soundtrack never cuts mid-word at a boundary (the extra second rides provider processing; billing stays on the planned durations). When singing is continuous with no usable gap, the full segment is kept |
| Shot timestamps | Checkbox | Off | A/B lever — injects each beat's time range (rebased to the segment's own clock) into **Hybrid / Hybrid Plus / Hybrid Max / Condensed** segment prompts, which are timestamp-free by default. No effect on Faithful split / Slot-anchored (they keep your script's own timestamps either way) |
| Preferred segment length | Number (4–15s), optional | auto | Recommended segment size — the planner cuts even segments near this point instead of packing to the 15s cap. Empty = automatic split. A small value can turn even a short request into a multi-segment run |
| Planner style | Select | Auto | How the planner treats your script: **Auto** condenses structured video-analysis input and splits everything else faithfully; **Faithful split** always keeps your wording and timing (timestamps shifted to each segment's own clock); **Condensed** always rewrites into short, timestamp-free segment prompts; **Slot-anchored** keeps the faithful split and opens each segment with a cast-definitions header, referencing entities by their slot names throughout; **Hybrid** (experimental) writes compact timestamp-free beats that always name entities by their labels and lets reference images carry appearance; **Hybrid Plus** (experimental) moves identity out of the prose entirely: EVERY segment (the first included) opens with a structured `Elements:` identity manifest — one line per entity active in that segment's window — above a `Scene:` block of pure beats that reference entities by label only; continuation lines add a "last seen in @video_N" pointer and the entity's current state, and each continuation's very first line binds the opening frame (`You must use @image_N as the first frame …`). Requires Rolling references; **Hybrid Max** (experimental) is Hybrid Plus with the compression removed — the planner keeps each analyzed scene as its own beat and preserves every stated detail (actions, gestures, positions, setting texture, props), with no size target, for maximum fidelity at the cost of longer prompts. Also requires Rolling references |
| Plan only | Checkbox | off | Return the full segment plan **without generating any video** — see [Plan-only mode](#plan-only-mode) |
| Continuation context | Select (2-5s) | 2s | How much of the previous segment each continuation segment sees as its reference. Raise for slow camera moves or music-timed motion; each extra second adds a small per-join cost (see the pricing formula) |
| Auto-cast from analysis | Checkbox | Off | Experimental — when enabled and the script is a [Video Analysis](../processing-video/video-analysis.md) result whose entities carry reference frames, those frames are added as identity references (after any images you wired yourself, up to the provider's 9-image limit) and each segment prompt is told which reference is which entity. Off by default: generation is text-only unless you opt in |

## Providers

Generate Video Pro is scoped to the Seedance 2 family:

| Provider | Label | Resolutions |
|---|---|---|
| `seedance-2` | Seedance 2.0 | 480p / 720p / 1080p / 4K |
| `seedance-2-fast` | Seedance 2.0 Fast | 480p / 720p only |

Other models (including Seedance 2.0 Mini) are not currently supported by the pro engine and are not offered in selection. Workflows saved with a since-withdrawn provider keep running, and the editor snaps their selection to `seedance-2` the next time the panel is opened.

For the full Seedance 2 capability write-up (multimodal image/video/audio references, `{image:N}`-style prompt tokens, unified frames+references wiring) see [Generate Video → Providers](./generate-video.md#providers). Generate Video Pro forwards the full reference surface — `startFrame`, `endFrame`, `imageReferences`, `audioReferences`, `assets` (with `@mention` / `{image:N}` token resolution), and the Extend Source (`videoReferences`) — into generation.

## How segmentation works

A request at or below 15 seconds runs as a single segment — identical in shape to a normal [Generate Video](./generate-video.md) Seedance 2 run.

A request above 15 seconds is automatically split into multiple segments (each 4–15s), generated in sequence and stitched into one output:

- The **first segment** starts from the wired `startFrame` (if any) and the prompt — or, when an Extend Source is wired, continues from that clip's final moments exactly like a later segment continues from the one before it.
- Every **later segment** continues from the one before it — each is conditioned on the previous segment's final moments, so lighting, colour, subject and setting carry across the whole video.
- **Continuous shots vs. camera cuts:** each boundary is planned automatically from your prompt. By default the camera keeps rolling — the next segment is anchored on the previous frame and the join is invisible (one continuous shot). When your prompt describes distinct shots (numbered shots, "cut to", a new location or subject), that boundary becomes a clean **hard cut to a new camera angle of the same scene** instead. Either way the look (lighting, colour, world) stays consistent and the audio runs continuously — only the camera changes.
- Segment count and individual lengths are chosen automatically to cover the requested duration — by default segments pack toward the 15s cap. Setting **Preferred segment length** changes that: segments are cut evenly near your chosen point (e.g. ~13s for fewer, longer segments; ~4s for many short ones), always inside the 4–15s provider bounds. Credit pricing uses the same split, so the reserve always matches the plan.
- **Planner model** picks which AI model does that planning. The default (Claude Opus 4.7) works well for most scripts; you can select any model from the [LLM model registry](../../choosing-models.md) to trade speed against planning quality.
- **Planner style** picks the planning algorithm. **Faithful split** divides your script across segments without changing it — wording stays yours, and any timestamps are kept (shifted so each segment starts at 0:00). **Condensed** rewrites the script into compact, timestamp-free segment prompts (short prompts often generate better for analysis-derived scripts). **Slot-anchored** keeps the faithful split but opens each segment with a definitions header (one line per entity, e.g. `man-blue: Man with long dark hair…`) and references entities by those names in the action — useful when entity identity matters more than prose flow. **Hybrid** (experimental) combines the compact style with strict entity naming — every mention uses the entity's label, and entities that have reference images get no text description at all (the image carries their look), keeping prompts short. **Hybrid Plus** (experimental) separates identity from action completely. The planner writes pure beats — no reference sheet, no appearance text — naming every recurring entity by its label; the engine then composes each segment as an `Elements:` identity manifest above a `Scene:` block. Segment 1's manifest lists the entities active in its own window with their canonical descriptions (entities that don't act in a segment never appear in its manifest); continuation manifests add a `last seen in @video_N` pointer (including `@video_1`, the clip being extended) and the entity's current state (clothing/emotion) from the rolling scan, while first-time entities get an identity-only line. On the last-frame overlap arm, every continuation also opens with a first-line frame binding (`You must use @image_N as the first frame (it is the last frame, taken from @video_1).`) for maximum anchor adherence. The manifest is built from Rolling references — enable that toggle or Hybrid Plus behaves like plain Hybrid. **Hybrid Max** (experimental) is Hybrid Plus with the compression turned off: instead of condensing to a size target, the planner keeps each analyzed scene as its own beat and preserves every detail the analysis states — actions, gestures, positions, setting texture and props — for maximum fidelity (longer, richer prompts, bounded only by the provider's own limit). It shares Hybrid Plus's Elements manifest and likewise needs Rolling references. **Auto** (default) condenses structured video-analysis input and faithfully splits everything else. Combine with **Plan only** to compare styles cheaply before generating.

## Stopping and continuing a run

Because the pro engine generates one segment at a time and checkpoints after each, a running job can be **stopped gracefully** — keeping everything already generated — and later **continued** from any delivered segment.

**On the canvas:** while the node is running, its **Stop** menu offers **"Stop & keep what's rendered"** beside the usual Discard. Once a run has stopped with a partial result (or a failure delivered only some segments), a **"Continue"** control appears in the node's run strip — pick **Resume** (the first not-yet-rendered segment) or redo from an earlier one; it continues as a new run, billed only for the regenerated segments. The rest of this section documents the underlying API for SDK/CLI/MCP callers.

### Stop (keep the partial)

`POST /v1/generate-video-pro/:jobId/stop` (also: the SDK's `client.videoPro.stop(jobId)`, the CLI's `nodaro video-pro stop <jobId>`, or the `stop_video_pro` MCP tool).

- The segment currently generating is **abandoned and still billed** — the provider keeps rendering it either way; nothing after it starts.
- Everything completed so far is stitched into the job's **final video**: the job completes normally with the shorter result (`output_data.pro.stopped = true`, `stoppedAtSegment`, `billedSegments`).
- The charge is the standard commit formula over the **dispatched** segments (completed + the abandoned one); everything reserved beyond that is refunded. Stopping before the first segment finishes delivers nothing and charges only the fee plus the abandoned first segment; a job that never started is cancelled with a full refund.

### Continue (regenerate from a segment)

`POST /v1/generate-video-pro/continue` with `{ fromJobId, fromSegment? }` (also: `client.videoPro.continueRun(jobId, { fromSegment })`, `nodaro video-pro continue <jobId> --from-segment N`, or the `continue_video_pro` MCP tool).

- Starts a **new job** that reuses the original run's plan and its delivered segments below `fromSegment`, and regenerates everything from `fromSegment` on — overriding the original takes from that point.
- `fromSegment` is 1-based; omitted, it defaults to the first not-yet-delivered segment (a pure "pick up where it stopped"). Passing an earlier value redoes more; on a fully completed run an explicit `fromSegment` re-rolls the tail.
- Works on stopped, failed (with at least one delivered segment), and completed parents. The parent must be terminal — stop a running job first.
- Continuity state (the rolling-references ledger) is rebuilt from the kept segments automatically, so Hybrid Plus manifests and rolling re-anchors stay correct across the continuation.

**Continuation pricing.** The plan's segment lengths are already known, so the reserve is exact (no worst-case padding):

```
reserve = 10 (fee) + ceil(refPerSec × (K × T + D))
```

where **K** is the number of regenerated segments, **D** the sum of their planned lengths, and **T** the Continuation context setting. Every regenerated segment — the first included — bills at the reference rate, because each re-seeds off the previous footage (the kept prefix for the first one). `fromSegment = 1` degenerates to the fresh-run formula over the same fixed lengths. At commit, only regenerated segments that actually completed are charged; a continuation that produced nothing new refunds in full.

**Worked example (720p, `seedance-2`, the 60s / 5-segment plan above).** Stopped after segment 3 with segment 4 in flight: the delivered video covers segments 1–3, billed for 4 dispatched segments — `10 + ceil(10.25 × 14) + ceil(6.25 × (3 × 2 + 36)) = 10 + 144 + 263 = 417` credits, the rest of the 508-credit reserve refunded. Continuing from segment 4 reserves `10 + ceil(6.25 × (2 × 2 + 24)) = 10 + 175 = 185` credits for the two regenerated segments.

## Plan-only mode

Enable **Plan only** to run everything up to (and including) the planning step — and stop there. The node completes with the full planned configuration instead of a video:

- Per-segment breakdown: each segment's prompt (exactly as it would be sent), duration, and whether the boundary is a continuous shot or a hard cut.
- The run's global settings: provider, resolution, aspect ratio, total planned length.

The plan renders as a segment table on the node (hover for a copy-JSON button). Use it to iterate on long scripts cheaply — check how your prompt splits, where cuts land, and what each segment will say **before** paying for video generation. Turn Plan only off and run again to generate for real.

**Pricing:** a plan-only run is charged a small flat planning fee (the multi-segment fee base, minimum 2 credits) — never the video price. No video provider is ever called.

## Credit pricing

### Single segment (≤ 15s)

Billed via the same per-second Seedance 2 composite identifiers Generate Video uses (`seedance-2:<N>s:<resolution>`) — see Generate Video's [Seedance 2 pricing table](./generate-video.md#credit-pricing) for the full per-resolution rate ladder and worked examples.

**One difference from Generate Video:** a single-segment Generate Video Pro run is always billed at the no-reference rate, even when a start frame or reference images are wired. The cheaper `-ref` rate only ever applies to later segments of a multi-segment run (see below), where it reflects a segment continuing from the previous segment's frames — not to user-wired references.

### Multi-segment (> 15s)

```
reserve = 10 (fee) + ceil(noRefPerSec × 15) + ceil(refPerSec × ((N − 1) × T + (S − 15)))
```

- **10** — flat fee covering the segmentation/stitch overhead, charged once per run regardless of segment count.
- **noRefPerSec** / **refPerSec** — the same per-second Seedance 2 rates Generate Video's single-segment pricing uses. At 720p these are **10.25** and **6.25** credits/sec; see Generate Video's [Seedance 2 pricing table](./generate-video.md#credit-pricing) for the 480p / 1080p / 4K rates.
- **15** — the per-segment maximum. The first segment is always reserved at the full 15s cap, even when its actual length ends up shorter (see the worked example below).
- **N** — the number of segments the request splits into.
- **S** — the combined length (seconds) of all segments, which runs slightly longer than the requested duration to cover the per-join overlap needed for a seamless stitch.
- **`(N − 1) × T`** — the continuation-context overlap per join, billed at the reference rate. **T** is the Continuation context setting (2s by default — the minimum reference length the Seedance 2 family accepts; raisable to 5s). Each joining segment continues from the previous one's final T-second tail, so the worked examples below (all at the default T = 2) grow by `refPerSec × (N − 1)` credits per extra second of context.

#### Worked examples (720p, `seedance-2`)

| Requested duration | Mode | Segments | Total length (S) | Reserved credits |
|---:|---|---:|---:|---:|
| 8s | single | 1 | 8s | 82 |
| 15s | single | 1 | 15s | 154 |
| 16s | multi | 2 | 17s | 189 |
| 43s | multi | 3 | 44s | 371 |
| 60s | multi | 5 | 62s | 508 |
| 120s | multi | 9 | 123s | 939 |

**60-second example, in full.** A 60-second request splits into 5 segments (14s, 12s, 12s, 12s, 12s — totaling 62s). Reserved at job start: `10 + ceil(10.25 × 15) + ceil(6.25 × (4 × 2 + 47)) = 10 + 154 + 344 = 508` credits. If all 5 segments complete, the commit re-prices the first segment at its actual length (14s, not the reserved 15s cap): `10 + ceil(10.25 × 14) + ceil(6.25 × (4 × 2 + 48)) = 10 + 144 + 350 = 504` credits — **4 credits refunded**. Credits are only ever refunded at commit, never charged above the reservation.

### Partial delivery

If a run is interrupted before every planned segment finishes, the segments that completed are kept and billed — the delivered video ends at the last successfully generated segment, shorter than requested, rather than failing outright. Credits reserved for segments that never ran are refunded. An individual segment's generation attempt that fails and is retried internally is never billed for the retry itself — only segments that make it into the final stitched video count toward the charge.

### Interruption recovery

Long multi-segment runs checkpoint their progress after every segment. If the processing worker restarts mid-run (for example during a platform deploy), the run resumes automatically from the checkpoint — already-generated segments are never re-generated or re-billed, and a run that had finished generating resumes straight at the final stitch. Only a run that stalls *again* after its automatic resume is failed and refunded.

### Duration cap

The maximum requestable duration defaults to **120 seconds**; self-hosted deployments can raise or lower it via the `GENERATE_VIDEO_PRO_MAX_DURATION` environment variable. `GET /v1/nodes` reports the active cap for this node. Requests above the cap are clamped down to it before segmentation runs.

## Best practices

- Stay under 15 seconds and use [Generate Video](./generate-video.md) instead when you don't need a stitched multi-segment clip — it's cheaper (no fee-base) and gives you the full Seedance 2 reference/prompt-token surface.
- Wire a `startFrame` to anchor the opening shot; without one, the first segment is driven by the prompt alone.
- Keep the prompt generally applicable across the whole requested duration — it's reused for every segment, not just the first.
- Longer requests take proportionally longer to generate (segments run in sequence, not in parallel) — plan for wall-clock time, not just credits.

## See also

- [Generate Video](./generate-video.md) — for single-shot clips, other providers, first+last frame, or the full Seedance 2 reference/prompt-token surface.
