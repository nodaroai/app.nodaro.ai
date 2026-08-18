# Generate Video Pro

> Long-form video generation. Requests above a single segment's limit are automatically split into multiple Seedance 2 segments and stitched into one seamless clip. Runs on Nodaro Cloud — self-hosted installs run it through their nodaro.ai connection.

## Overview

Generate Video Pro is a specialized sibling of [Generate Video](./generate-video.md), built for one thing: clips longer than a single provider call can produce. Ask for a duration beyond the model's single-segment limit and the node transparently generates multiple segments and stitches them into a single output video.

You choose the model. Every video model that accepts a start still plus reference images is available — the Seedance 2 family, Hailuo 3, the VEO 3.1 family, Gemini Omni, Grok and HappyHorse — and each one contributes its own segment lengths and resolutions. See [Providers](#providers) for the full list and for which models additionally support the continuation-based **Extend** render method.

Below the model's single-segment limit, Generate Video Pro behaves like a normal single-shot run on that model and is priced the same way. Use it when you need one long clip; use [Generate Video](./generate-video.md) for everything else (single shots, video-to-video, first+last frame, or the full multimodal reference/prompt-token surface).

**Availability.** Native on Nodaro Cloud. On a self-hosted install the node
appears with a **NODARO** mark and runs through your
[nodaro.ai connection](../../community-cloud-connect.md) — OAuth Connect or a
pasted API key — billed to the connected nodaro.ai account. Without a
connection the node card shows a **Connect nodaro.ai** CTA and a run refuses
with `503 nodaro_connection_required`.

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
| Provider | Select | `seedance-2` | Any model that accepts a start still plus reference images — see [Providers](#providers) |
| Prompt | Text | — | Describes the video; also settable via the `prompt` handle |
| Duration | Number (4–cap) | 8s | Minimum 4s. Maximum is the configured cap (120s by default) — see [Duration cap](#duration-cap) |
| Aspect Ratio | Select | `adaptive` | 16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9 / Adaptive (matches the wired input) |
| Resolution | Select | `720p` | By provider — see [Providers](#providers) |
| Generate Audio | Checkbox | on | |
| Planner model | Select | Claude Opus 4.7 | The AI model that plans the segment breakdown for multi-segment runs — any model from the [LLM model registry](../../choosing-models.md) |
| Overlap anchor | Select | Off | Experimental A/B — anchor each continuation on the previous segment's **last keyframe** (the model replays the short overlap, locking motion and lighting, and the stitch removes the duplicate) or its **very last frame** (continue directly from the end). Both carry a longer overlapping reference; the stitch detects the model's actual behavior per join | Experimental — each continuation starts from the previous segment's last keyframe while its video reference runs past that point to the end; the model replays the overlap almost identically (locking motion, lighting and identity) before continuing, and the stitch removes the duplicate. Continuations request a little extra duration to compensate (self-tuning) |
| Audio context tail | Checkbox | Off | Experimental — each continuation also hears the last ~8 seconds of the video-so-far's soundtrack as an audio reference, helping the music continue seamlessly instead of drifting (skipped when Audio References are wired) |
| Smart cut | Select | Best pair | How each join is cut. **Best pair** (default) picture-matches the boundary and cuts where the two segments overlap most closely. The two **Pre-roll** modes handle a continuation that re-enacts the previous tail — see [Smart cut](#smart-cut) |
| Best-pair search window | Two numbers (1–24), optional | 8 × 8 | How many frames the matcher compares at each join: the last N of a segment against the first M of the next. Blank = 8 × 8. Best pair only — see [Smart cut](#smart-cut) |
| Rolling references | Checkbox | Off | Experimental — after each segment the engine notes where every recurring entity was last seen; entities that return after being off-screen get their last-seen shot injected as an extra reference (video clip or frame) so identity and position carry across absences |
| Clean word cut | Checkbox | Off | Experimental — each non-final segment generates one extra second, then is losslessly trimmed at the nearest gap between sung/spoken words near its planned length, so the soundtrack never cuts mid-word at a boundary (the extra second rides provider processing; billing stays on the planned durations). When singing is continuous with no usable gap, the full segment is kept |
| Shot timestamps | Checkbox | Off | A/B lever — injects each beat's time range (rebased to the segment's own clock) into **Hybrid / Hybrid Plus / Hybrid Max / Condensed** segment prompts, which are timestamp-free by default. No effect on Faithful split / Slot-anchored (they keep your script's own timestamps either way) |
| Preferred segment length | Number (4–15s), optional | auto | Recommended segment size — the planner cuts even segments near this point instead of packing to the 15s cap. Empty = automatic split. A small value can turn even a short request into a multi-segment run |
| Planner style | Select | Auto | How the planner treats your script: **Auto** condenses structured video-analysis input and splits everything else faithfully; **Faithful split** always keeps your wording and timing (timestamps shifted to each segment's own clock); **Condensed** always rewrites into short, timestamp-free segment prompts; **Slot-anchored** keeps the faithful split and opens each segment with a cast-definitions header, referencing entities by their slot names throughout; **Hybrid** (experimental) writes compact timestamp-free beats that always name entities by their labels and lets reference images carry appearance; **Hybrid Plus** (experimental) moves identity out of the prose entirely: EVERY segment (the first included) opens with a structured `Elements:` identity manifest — one line per entity active in that segment's window — above a `Scene:` block of pure beats that reference entities by label only; continuation lines add a "last seen in @video_N" pointer and the entity's current state, and each continuation's very first line binds the opening frame (`You must use @image_N as the first frame …`). Requires Rolling references; **Hybrid Max** (experimental) is Hybrid Plus with the compression removed — the planner keeps each analyzed scene as its own beat and preserves every stated detail (actions, gestures, positions, setting texture, props), with no size target, for maximum fidelity at the cost of longer prompts. Also requires Rolling references |
| Render method | Select | Extend | **Extend (video chain)** continues each segment from the previous one's tail; **Keyframes (scene anchors)** renders each scene from its own generated start/end frames, so scenes are independent — see [Render method](#render-method) |
| Anchor frames | Select | Auto | Keyframes only — how much each shot is pinned to generated stills: **Auto**, **Start + end frames**, **Start frame only** (each opening still chained off the previous shot's real last frame, nothing pinned at the end) or **References only** (no frame conditioning at all) — see [Anchor frames](#anchor-frames) |
| Plan only | Checkbox | off | Return the full segment plan **without generating any video** — see [Plan-only mode](#plan-only-mode) |
| Continuation context | Select (2-5s) | 2s | How much of the previous segment each continuation segment sees as its reference. Raise for slow camera moves or music-timed motion; each extra second adds a small per-join cost (see the pricing formula). No effect under the Keyframes render method — nothing continues from a previous segment there |
| Auto-cast from analysis | Checkbox | Off | Experimental — when enabled and the script is a [Video Analysis](../processing-video/video-analysis.md) result whose entities carry reference frames, those frames are added as identity references (after any images you wired yourself, up to the provider's own identity-ref cap — 30 on Seedance 2.5, 9 on the Seedance 2 family and Hailuo 3) and each segment prompt is told which reference is which entity. Off by default: generation is text-only unless you opt in |

**Per-look identity.** When the driving analysis separates a subject's
deliberate [appearance
looks](../processing-video/video-analysis.md#appearance-looks-variations)
(dream vs reality, flashback vs present, a disguise) and binds them to scenes,
generation keys each subject's continuity on the *(entity, look)* pair: every
look stays visually consistent across its own scenes — same wardrobe, same
hair — without bleeding into the scenes where the other look is active.
Consuming apps that support per-look casting (for example Recast) drive this
automatically; scripts without look bindings behave exactly as before.

## Providers

Generate Video Pro offers every video model that can drive the engine's **keyframes** render method — that is, any model which accepts a generated start still plus reference images, and declares its own segment durations:

| Provider | Label | Segment lengths | Resolutions | Render methods |
|---|---|---|---|---|
| `seedance-2` | Seedance 2.0 | 4–15s | 480p / 720p / 1080p / 4K | Keyframes + Extend |
| `seedance-2-fast` | Seedance 2.0 Fast | 4–15s | 480p / 720p | Keyframes + Extend |
| `seedance-2-mini` | Seedance 2.0 Mini | 4–15s | 480p / 720p | Keyframes + Extend |
| `seedance-2-5` | Seedance 2.5 | 4–30s | 480p / 720p / 1080p | Keyframes + Extend |
| `minimax-h3` | minimax-h3 | 4–15s | 2K (default) / 768P | Keyframes + Extend |
| `veo3` | VEO 3.1 Quality | 4 / 6 / 8s | 720p / 1080p / 4K | Keyframes |
| `veo3.1` | VEO 3.1 Fast | 4 / 6 / 8s | 720p / 1080p / 4K | Keyframes |
| `veo3_lite` | VEO 3.1 Lite | 4 / 6 / 8s | 720p / 1080p / 4K | Keyframes |
| `gemini-omni-video` | Gemini Omni | 4 / 6 / 8 / 10s | 720p / 1080p / 4K | Keyframes |
| `grok-i2v` | Grok I2V | 6 / 10s | 480p / 720p | Keyframes |
| `happyhorse-ref2v` | HappyHorse 1.1 Ref2V | 3–15s | 720p / 1080p | Keyframes |

### Render methods and why the list differs

- **Keyframes** — every segment is generated from its own anchor still (plus a closing still on models that honour an end frame), and every seam is a hard cut. Nothing conditions on another segment's video, which is why single-scene retakes don't cascade. The only thing a model needs for this is start-frame conditioning plus reference images, so it is available on **every** provider above.
- **Extend** — each segment continues from the previous one via a short context tail sent as a *reference video*. That transport exists only on models with a reference-to-video mode (the Seedance 2 family and Hailuo 3), so the Render method control is disabled with a reason on the others. Selecting a keyframes-only provider never silently downgrades an extend run — the request is rejected.

Note that Gemini Omni does accept a video input, but as a video-to-video **source** clip (with its own trim window and flat pricing), not as a continuation reference — so it is keyframes-only here.

**Segment lengths are per-model.** A request longer than the model's single-segment maximum is split into several segments; models with a sparse set of allowed lengths (VEO's 4/6/8s, Grok's 6/10s) can only land on those values, so the delivered duration snaps to the nearest total the model can actually produce and the node reports what you will get.

Two consequences worth knowing on the sparse-length models:

- **A run is capped at 24 segments**, which on a short-segment model binds before the duration limit does. VEO renders at most 8 seconds per segment, so a VEO run tops out around 185 seconds however long you ask for; Gemini Omni and Grok top out around 233. The run is shortened to fit and the delivered duration is reported — it is never padded or silently failed.
- **Scene-aligned splitting snaps onto the model's menu.** That mode supplies an explicit per-segment length list; on a sparse-length model each off-menu duration is snapped to the nearest value the model actually offers (count and order preserved), and the response declares it with `segmentDurationsSnapped: true` so a caller can see the plan moved. Exact scene timing needs a dense-menu model (Seedance / Hailuo 3); the snap keeps sparse-menu models usable for scene-aligned work at the cost of slightly shifted cuts.

**Off-grid resolutions snap to the nearest priced tier.** An API/MCP caller sending a resolution the selected model doesn't offer (e.g. `480p` on VEO's 720p/1080p/4k) is priced and rendered at the model's **nearest** tier — ties go to the **cheaper** one, never the priciest — and the clamped value is echoed on the pricing response (`resolution`), so what is billed and what renders are the same by construction. Display names also differ from wire values on some models: send minimax-h3's cheap tier as the literal `768P` (the per-model wire spelling is served by `GET /v1/nodes` under `providerResolutionWire`).

Hailuo 3 shares Seedance 2's multimodal reference surface (the same 9-image / 3-video / 3-audio reference semantics), so the whole continuation transport carries over unchanged. Its per-second price has no with-reference axis; both segment rates derive from the one 8s composite of the selected resolution tier (`minimax-h3:8s` @2K, `minimax-h3:8s:768p` @768P — see [Credit cost](#credit-cost)).

Models that take only a bare start frame with no reference-image forwarding (Wan, Hailuo 2.3, Bytedance Pro, Grok Imagine 1.5) stay out — the anchor wave's identity references would be silently dropped. Workflows saved with a since-withdrawn provider keep running, and the editor snaps their selection to `seedance-2` the next time the panel is opened.

For the full Seedance 2 capability write-up (multimodal image/video/audio references, `{image:N}`-style prompt tokens, unified frames+references wiring) see [Generate Video → Providers](./generate-video.md#providers). Generate Video Pro forwards the full reference surface — `startFrame`, `endFrame`, `imageReferences`, `audioReferences`, `assets` (with `@mention` / `{image:N}` token resolution), and the Extend Source (`videoReferences`) — into generation.

## How segmentation works

A request at or below 15 seconds runs as a single segment — identical in shape to a normal [Generate Video](./generate-video.md) Seedance 2 run.

A request above 15 seconds is automatically split into multiple segments (each 4–15s), generated in sequence and stitched into one output:

- The **first segment** starts from the wired `startFrame` (if any) and the prompt — or, when an Extend Source is wired, continues from that clip's final moments exactly like a later segment continues from the one before it.
- Every **later segment** continues from the one before it — each is conditioned on the previous segment's final moments, so lighting, colour, subject and setting carry across the whole video.
- **Continuous shots vs. camera cuts:** each boundary is planned automatically from your prompt. By default the camera keeps rolling — the next segment is anchored on the previous frame and the join is invisible (one continuous shot). When your prompt describes distinct shots (numbered shots, "cut to", a new location or subject), that boundary becomes a clean **hard cut to a new camera angle of the same scene** instead. Either way the look (lighting, colour, world) stays consistent and the audio runs continuously — only the camera changes.
- Segment count and individual lengths are chosen automatically to cover the requested duration — by default segments pack toward the 15s cap. Setting **Preferred segment length** changes that: segments are cut evenly near your chosen point (e.g. ~13s for fewer, longer segments; ~4s for many short ones), always inside the 4–15s provider bounds. Credit pricing uses the same split, so the reserve always matches the plan.
- **Explicit segment durations (API only, platform ≥ 0.89.0).** SDK / workflow-JSON / API callers can bypass the automatic split entirely by passing `segmentDurations` — an array of 1–24 integers, each 4–15s, that becomes the exact per-segment plan. The array must satisfy `sum(segmentDurations) = ceil(duration + 0.3 × (N − 1))` (the requested duration plus 0.3s of stitch overlap per join) or the request is rejected with a 400 — the same array is validated by pricing, planned by the engine, and echoed in the plan, so the quote, the reserve, and the rendered segments can never disagree. Mutually exclusive with **Preferred segment length**. This is the mechanism behind scene-aligned splitting (e.g. Recast's "Natural — split at shot boundaries" mode, which derives the array from the video analysis' scene cut list): segment boundaries land on real cuts, each window holds whole scenes, and boundaries default to clean hard cuts instead of carrying a shot across a seam. There is no canvas control for this field.
- **Planner model** picks which AI model does that planning. The default (Claude Opus 4.7) works well for most scripts; you can select any model from the [LLM model registry](../../choosing-models.md) to trade speed against planning quality — including Claude Opus 5, which becomes the default in an upcoming planner-engine update.
- **Planner style** picks the planning algorithm. **Faithful split** divides your script across segments without changing it — wording stays yours, and any timestamps are kept (shifted so each segment starts at 0:00). **Condensed** rewrites the script into compact, timestamp-free segment prompts (short prompts often generate better for analysis-derived scripts). **Slot-anchored** keeps the faithful split but opens each segment with a definitions header (one line per entity, e.g. `man-blue: Man with long dark hair…`) and references entities by those names in the action — useful when entity identity matters more than prose flow. **Hybrid** (experimental) combines the compact style with strict entity naming — every mention uses the entity's label, and entities that have reference images get no text description at all (the image carries their look), keeping prompts short. **Hybrid Plus** (experimental) separates identity from action completely. The planner writes pure beats — no reference sheet, no appearance text — naming every recurring entity by its label; the engine then composes each segment as an `Elements:` identity manifest above a `Scene:` block. Segment 1's manifest lists the entities active in its own window with their canonical descriptions (entities that don't act in a segment never appear in its manifest); continuation manifests add a `last seen in @video_N` pointer (including `@video_1`, the clip being extended) and the entity's current state (clothing/emotion) from the rolling scan, while first-time entities get an identity-only line. On the last-frame overlap arm, every continuation also opens with a first-line frame binding (`You must use @image_N as the first frame (it is the last frame, taken from @video_1).`) for maximum anchor adherence. The manifest is built from Rolling references — enable that toggle or Hybrid Plus behaves like plain Hybrid. **Hybrid Max** (experimental) is Hybrid Plus with the compression turned off: instead of condensing to a size target, the planner keeps each analyzed scene as its own beat and preserves every detail the analysis states — actions, gestures, positions, setting texture and props — for maximum fidelity (longer, richer prompts, bounded only by the provider's own limit). It shares Hybrid Plus's Elements manifest and likewise needs Rolling references. **Auto** (default) condenses structured video-analysis input and faithfully splits everything else. Combine with **Plan only** to compare styles cheaply before generating.

## Render method

**Render method** decides how the segments of a multi-segment run are produced. It does not change the split itself — segment count and lengths come from the same planner either way.

### Extend (video chain) — the default

Each segment continues the previous one: the engine feeds the previous segment's final moments back to the model as a reference, so lighting, colour, subject and setting carry forward frame-to-frame. This is the behaviour every section above describes, and it is what you get when the field is left alone. Best for continuous action and unbroken camera movement.

Because each segment depends on the one before it, changing one scene means everything after it is regenerated too (that is what [Continue](#continue-regenerate-from-a-segment) does from a chosen segment onward).

### Keyframes (scene anchors)

Each scene is rendered from its **own** generated start and end frames instead of from the previous segment's video. The engine generates the anchor images for a scene, then renders the scene between them.

- **Scenes are independent.** Nothing downstream depends on an earlier scene's footage, so a single scene can be re-rendered on its own without touching the rest of the video.
- **Consistency comes from the anchors,** not from a video chain — the anchor frames (and your wired identity references) are what hold the look together across scenes.
- **Pairs naturally with scene-aligned splits.** It is at its best when segment boundaries land on real shot boundaries — see the explicit `segmentDurations` lever under [How segmentation works](#how-segmentation-works).
- **Audio: voices and sound effects only.** The video model is not asked to score the video under this method. Add music afterwards with [Merge Video + Audio](../processing-audio/merge-video-audio.md) (or any of the audio nodes) rather than expecting a soundtrack from the render.

Keyframes requires the current cloud engine version; on an older deployment the field is ignored and the run falls back to the extend chain.

**Pricing shape.** A keyframes run is reserved as the flat plan fee, plus **every** segment's seconds at the **no-reference** per-second rate, plus the anchor images. There is no continuation-context term at all — no segment rides another segment's tail, so the `(N − 1) × T` overlap the extend formula charges simply does not exist here (the Continuation context setting has no effect on a keyframes run). Anchors are reserved at the worst case of **two per scene** at the anchor image model's own price; the engine only generates an end frame where the scene warrants one (longer scenes, on models that support a strict closing frame), and the commit charges the actual count — so the anchor part of the reserve only ever refunds down, never up. Continuing a keyframes run re-renders the chosen scenes at the same no-reference rate and adds **no** anchor reserve: the parent run's anchors are reused.

**Which model draws the anchors.** Anchors are generated at 2K with [GPT Image 2](../ai-image/generate-image.md). The one exception is **21:9** — GPT Image 2 does not render that ratio, so ultra-wide runs draw their anchors on Nano Banana Pro instead, which does. That is purely an anchor-model choice; the video itself is unaffected. Because the two models are priced differently, a 21:9 keyframes run reserves (and charges) more per anchor than the same run at 16:9 — read the current per-image numbers from the [Generate Image](../ai-image/generate-image.md) pricing table rather than assuming a ratio between them.

For the extend-mode formula and worked examples see [Credit pricing](#credit-pricing).

### Anchor frames

Under the keyframes method, **Anchor frames** controls how much each shot is pinned to generated stills. It has no effect on an extend run, where segments continue from video tails rather than anchors, and the control is hidden there.

| Setting | What the engine does | Use it when |
|---|---|---|
| **Auto** (default) | The engine decides — today that means a generated opening still per scene, plus a closing still on longer scenes where the provider honours a strict end frame. | You have no specific reason to override it. |
| **Start + end frames** | Every scene renders between a generated opening still and a generated closing still. | A shot has to land on a specific final image — a held pose, a product hero, a title frame. |
| **Start frame only** | Each scene opens on a still generated from the **previous shot's real last frame**, then ends wherever its motion naturally lands. No closing still is generated or pinned. | Camera moves through the scene, or shots have been warping to reach their closing frame. |
| **References only** | No frame conditioning at all. Identity and location references plus the scene prompt carry the shot. | You want the model to compose the scene to fit the direction — camera, light, atmosphere — rather than match a still. |

**Why "Start frame only" exists.** A closing still is generated *before* the shot is rendered, so it is a guess about where the world ends up after the motion. When the camera travels, that guess disagrees with what the shot actually does, and the model bends its world to reach the pinned frame — objects drift, rescale, or slide across the shot in the final second. Chaining each opening still off the previous render's *real* last frame removes the guess while keeping continuity, at the cost of scene endings that are no longer pinned (the hard cut at each seam absorbs it).

**With an end frame wired.** A reference-driven run has no closing-frame lane, so **References only** is not offered while something is connected to the node's `endFrame` handle — and a node already set to it snaps back to **Auto** when that edge is drawn. Requesting the combination through the API is rejected rather than silently ignored.

**Pricing.** Anchor mode does not change the reserve: a keyframes run still holds the worst case of two anchors per scene, and the commit charges the actual count. Choosing **Start frame only** generates one anchor per scene instead of two, and **References only** generates none at all, so the unused portion refunds — see the pricing shape above.

Anchor frames requires the current cloud engine version; on an older deployment the field is ignored and the run uses that engine's own default.

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
reserve = 100 (fee) + ceil(refPerSec × (K × T + D))
```

where **K** is the number of regenerated segments, **D** the sum of their planned lengths, and **T** the Continuation context setting. Every regenerated segment — the first included — bills at the reference rate, because each re-seeds off the previous footage (the kept prefix for the first one). `fromSegment = 1` degenerates to the fresh-run formula over the same fixed lengths. At commit, only regenerated segments that actually completed are charged; a continuation that produced nothing new refunds in full.

**Worked example (720p, `seedance-2`, the 60s / 5-segment plan above).** Stopped after segment 3 with segment 4 in flight: the delivered video covers segments 1–3, billed for 4 dispatched segments — `10 + ceil(10.25 × 14) + ceil(6.25 × (3 × 2 + 36)) = 10 + 144 + 263 = 417` credits, the rest of the 508-credit reserve refunded. Continuing from segment 4 reserves `10 + ceil(6.25 × (2 × 2 + 24)) = 10 + 175 = 185` credits for the two regenerated segments.

## Smart cut

Every segment after the first is generated *from* the previous one's tail, so the two clips overlap: the same moment exists at the end of one and the start of the next. Left alone that overlap plays twice and the join stutters. Smart cut finds the duplicate and removes it.

**Best pair** (the default) compares the last frames of a segment against the first frames of the next, picture by picture, ends the previous clip on the closest-matching frame and starts the next one immediately after its twin. The repeated moment plays exactly once and the motion runs straight through the join.

**Best-pair search window** is how far that comparison looks — the last **N** frames of a segment against the first **M** of the next, `8 × 8` by default. The window matters because a match outside it is never found: if a continuation re-enacts, say, a full second of the previous tail but the search only covers 8 frames, the real twin sits beyond the window and the join silently falls back to a small fixed trim instead. Widening to `24 × 24` covers about a second at 24fps and catches those longer re-enactments. Leave it blank unless you see stutters at the joins — a wider window costs a little match time and, past the real overlap, can pair two frames that merely look alike. Both numbers accept 1–24 and can differ.

The two **Pre-roll** modes are for a different case: a continuation that begins *early* and replays part of the previous tail before continuing. They detect that replay and cut diagonally through it — **keep-next** hides the seam inside the overlap, **keep-prev** keeps the previous segment's original frames. They need a last-frame boundary, so they're unavailable when Overlap anchor is set to Keyframe (a keyframe re-enactment has no pixel replay to detect). Under a pre-roll mode the search window doesn't apply — those modes run their own search.

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

The formula below is the **extend** render method (the default). Keyframes runs are priced differently — plan fee + every segment at the no-reference rate + the metered anchor budget, with no continuation-context term; see [Render method → Keyframes](#keyframes-scene-anchors).

```
reserve = 100 (fee) + ceil(noRefPerSec × 15) + ceil(refPerSec × ((N − 1) × T + (S − 15)))
```

- **100** — flat fee covering the segmentation/stitch overhead, charged once per run regardless of segment count.
- **noRefPerSec** / **refPerSec** — the same per-second Seedance 2 rates Generate Video's single-segment pricing uses. At 720p these are **102.5** and **62.5** credits/sec; see Generate Video's [Seedance 2 pricing table](./generate-video.md#credit-pricing) for the 480p / 1080p / 4K rates.
- **15** — the per-segment maximum. The first segment is always reserved at the full 15s cap, even when its actual length ends up shorter (see the worked example below).
- **N** — the number of segments the request splits into.
- **S** — the combined length (seconds) of all segments, which runs slightly longer than the requested duration to cover the per-join overlap needed for a seamless stitch.
- **`(N − 1) × T`** — the continuation-context overlap per join, billed at the reference rate. **T** is the Continuation context setting (2s by default — the minimum reference length the Seedance 2 family accepts; raisable to 5s). Each joining segment continues from the previous one's final T-second tail, so the worked examples below (all at the default T = 2) grow by `refPerSec × (N − 1)` credits per extra second of context.

**Levered splits (Preferred segment length or explicit `segmentDurations`).** The same formula applies over the levered split's own durations, with one refinement: the first segment reserves at its **actual** planned length (`durations[0]`) instead of the worst-case 15s cap (which could over-pad — or even go negative in the reference term — when segments are short). Example: a 79.3s request with the scene-aligned array `[8, 10, 6, 6, 5, 6, 4, 4, 4, 5, 5, 5, 7, 8]` (N = 14, S = 83) reserves `100 + ceil(102.5 × 8) + ceil(62.5 × (13 × 2 + 75)) = 100 + 820 + 6313 = 7233` credits at 720p.

**Hailuo 3 (`minimax-h3`) rates.** The same formula applies, but Hailuo 3 has no with-reference rate axis: **noRefPerSec = refPerSec**, both derived from the one 8s composite of the selected resolution tier — **91.25** credits/sec @2K (`minimax-h3:8s` = 730 ÷ 8; the default, and what any non-768P resolution value collapses to) or **56.25** credits/sec @768P (`minimax-h3:8s:768p` = 450 ÷ 8). Its reference-to-video rate equals its base rate; each continuation's T-second context tail is billed as input seconds at that same rate, which is exactly the formula's `refPerSec × (N − 1) × T` term. A 60s request (5 segments, S = 62) reserves `100 + ceil(91.25 × 15) + ceil(91.25 × (4 × 2 + 47)) = 100 + 1369 + 5019 = 6488` credits @2K, or `100 + ceil(56.25 × 15) + ceil(56.25 × 55) = 100 + 844 + 3094 = 4038` @768P.

#### Flat-priced providers (VEO 3.1 family, Gemini Omni, Grok, HappyHorse)

The per-second formula above applies only to models that publish a per-second rate — the Seedance 2 family and Hailuo 3. The remaining providers are priced **per generation**, so there is no rate to multiply. They render keyframes-only, where each segment is exactly one ordinary image-to-video generation, so each segment is billed at that model's own published price for its length and resolution:

```
reserve = feeBase + Σ segmentPrice(provider, resolution, dᵢ) + anchorBudget
```

- `segmentPrice` is the same credit identifier a single-shot [Generate Video](./generate-video.md) run on that model would use — so an admin reprice moves the pro node with it.
- `anchorBudget` is the worst case of two anchor stills per segment, exactly as for keyframes runs on any provider. The metered commit settles the real count, so it only ever refunds down.

**Worked example (`veo3` @ 720p, three 8-second segments).** VEO is flat per generation regardless of clip length, so all three segments cost the same: `feeBase + 3 × veo3 + 3 × 2 × anchor`. The delivered duration is 23 seconds, not 24 — the 0.3s seam allowance per join is deducted from the raw 24s of footage. VEO offers 4/6/8s only, all even, so a total that needs an odd number of seconds simply isn't reachable; the node reports the length you will actually get.

**Worked example (`gemini-omni-video` @ 720p, segments of 10 + 8 + 6s).** Gemini Omni is priced by duration tier rather than flat, so each segment bills at its own tier (`gemini-omni-video:10`, `:8`, `:6`) and the reserve is their sum plus the fee and anchor budget.

#### Worked examples (720p, `seedance-2`)

| Requested duration | Mode | Segments | Total length (S) | Reserved credits |
|---:|---|---:|---:|---:|
| 8s | single | 1 | 8s | 820 |
| 15s | single | 1 | 15s | 1540 |
| 16s | multi | 2 | 17s | 1888 |
| 43s | multi | 3 | 44s | 3701 |
| 60s | multi | 5 | 62s | 5076 |
| 120s | multi | 9 | 123s | 9388 |

**60-second example, in full.** A 60-second request splits into 5 segments (14s, 12s, 12s, 12s, 12s — totaling 62s). Reserved at job start: `100 + ceil(102.5 × 15) + ceil(62.5 × (4 × 2 + 47)) = 100 + 1538 + 3438 = 5076` credits. If all 5 segments complete, the commit re-prices the first segment at its actual length (14s, not the reserved 15s cap): `100 + ceil(102.5 × 14) + ceil(62.5 × (4 × 2 + 48)) = 100 + 1435 + 3500 = 5035` credits — **41 credits refunded**. Credits are only ever refunded at commit, never charged above the reservation.

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
