# Upscale Video

> Upscale video resolution using Topaz or VEO AI, or finalize a Seedance 2.5 draft at 1080p.

## Overview

The Video Upscale node enhances video resolution using AI upscaling. Choose between Topaz (factor-based scaling with quality enhancement), VEO (fixed target resolutions), or **Seedance 2.5 HD (from draft)**, which finalizes a Seedance 2.5 draft at 1080p. Unlike most processing nodes, upscaling uses AI processing.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Provider | Select | topaz | Upscaling engine |

### Topaz Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Upscale Factor | Select | 2 | 1x (enhance only), 2x (recommended), 4x (maximum) |

### VEO Options

Select target resolution: 1080p or 4K.

**VEO upscale only works on a video that a VEO node generated earlier in the same workflow.** It re-renders that generation at the higher resolution rather than processing a file, so an uploaded video, or a clip from any other model, cannot feed it. Wire the VEO node's video output straight into this node. For every other video, choose the Topaz provider.

The node card names the selected provider ("VEO 1080p Upscale", "Topaz 2x Upscale"), and a run with a VEO provider and no VEO source is refused before any credits are reserved, with a message that says to connect the VEO node or switch to Topaz.

### Seedance 2.5 HD (from draft)

Provider id `seedance-2-5-hd`. It finalizes a **Seedance 2.5 draft** — a Generate Video or Video to Video (Seedance 2.5 Edit) run made with **Draft** on (see [Draft mode](../ai-video/generate-video.md#seedance-25-draft-mode)). The result is **the same take, frame for frame** — same seed, prompt, references, timing and audio setting — re-rendered at **1080p**, at the draft's own length. It is not an upscale of the 480p pixels and not a new take: nothing creative is sent again, only a reference to the draft.

**It only works on a Seedance 2.5 draft.** Wire the Seedance 2.5 node's video output straight into this node. The run is refused before any credits are reserved, with a message saying what to do, when the source is:

- not a draft (a Seedance 2.5 run with Draft off), or not made by Seedance 2.5 at all;
- someone else's video;
- still rendering, or failed;
- rendered through a connected nodaro.ai account on a self-hosted install (finalize it on nodaro.ai instead).

**Drafts are kept for about 7 days.** Finalizing a draft older than that fails and the credits are refunded — make a new draft. When the provider says the draft has expired or is unknown, the message is "This Seedance draft can no longer be finalized".

#### Credits

The price is set by the **draft**, never by this node: the length of the take the provider rendered for it, in whole seconds (a clip's 4.04 s counts as 4 s; anything under 4 s counts as 4 s, the most is 30 s), and whether the draft used a reference **video**. Reference images do not change the price. The length is the take itself, not the clip you see in the node: an audio track merged onto the draft, or a Smart Loop Cut, changes the stored clip but not the take the finalize re-renders.

| Draft | Credits |
|---|---|
| No reference video | **395 credits per second**, rounded up to the next 10 (`ceil(39.5 × seconds) × 10`) |
| With a reference video | **237.5 credits per second** on the reference clip seconds **plus** the draft's seconds: `ceil(237.5 × (reference_seconds + draft_seconds))` |

Worked examples:

| Draft | Calculation | Credits |
|---|---|---:|
| 4 s, no reference video | ceil(39.5 × 4) × 10 | **1580** |
| 5 s, no reference video | ceil(39.5 × 5) × 10 = 198 × 10 | **1980** |
| 8 s, no reference video | ceil(39.5 × 8) × 10 | **3160** |
| 30 s, no reference video | ceil(39.5 × 30) × 10 | **11850** |
| 4 s reference clip edited into a 4 s draft | ceil(237.5 × (4 + 4)) | **1900** |
| 10 s reference clip edited into a 10 s draft | ceil(237.5 × (10 + 10)) | **4750** |
| 2 s reference clip (the shortest Seedance 2.5 accepts) into a 4 s draft | ceil(237.5 × (2 + 4)) | **1425** |

The reference-clip seconds are the ones measured when the draft was reserved; a clip that could not be measured counts as 30 s (the per-clip cap), never less. If the draft's length cannot be read at all, the finalize is refused and nothing is charged.

**The price you see before you run.** The node's Run button shows the **exact** credits for the draft that is wired into it — the same number the run reserves, read from the draft itself (its length and reference clips). Before a draft is wired, or while the wired video cannot be finalized (still rendering, not a draft), it shows **"from N"**: the lowest price any draft can finalize for. The provider dropdown shows the same "from N". That minimum is the cheapest draft there can be: the shortest reference clip Seedance 2.5 accepts (2 s) with the shortest draft (4 s) — **1425** credits, below the 4 s draft without a reference video (**1580**). The workflow's pre-run cost estimate does not read the draft yet and quotes this provider at its 8 s row.

**Audio.** A draft that got an audio track after it was rendered — the **Audio** input of Generate Video, or the voice of a voiced clip (Character voices / dialogue) — gets the **same** audio mixed onto the 1080p render, with the same settings, at no extra cost. A draft without such a track is delivered as the provider renders it (with the model's own sound if the draft had it). If the audio cannot be re-applied (its source can no longer be read or processed — a network hiccup is retried briefly first), the 1080p video is still delivered and charged, **without** that audio, and the result shows a warning; add the audio back with a **Merge Video & Audio** node. The same happens when the stored draft's picture is not the length of the 1080p take — for example a draft trimmed by a **Smart Loop Cut**: its audio is not copied onto the render, because it would come out truncated or out of sync, so the 1080p video is delivered without it, with the same warning.

**When is a draft worth it?** A 4 s draft costs **280** credits (the same as any 480p run). Draft + finalize = 280 + 1580 = **1860**, against **1140** for one direct 1080p run, so for a single attempt the direct render is cheaper. But two attempts cost 2 × 1140 = **2280** directly, while two drafts and one finalize cost 2 × 280 + 1580 = **2140** — drafting first pays off as soon as a direct 1080p would have needed **two or more tries**, and the saving grows with every extra try.

Through the API: `POST /v1/video-upscale` with `{ "provider": "seedance-2-5-hd", "sourceJobId": "<the draft's job id>" }` (or `"taskId": "<its providerTaskId>"`). Via MCP: `video_upscale` with `model: "seedance-2-5-hd"` and `source_job_id`. To read the price first, without starting anything, call `POST /v1/credits/seedance-hd-estimate` with the same `sourceJobId` or `taskId` (see [Seedance 2.5 HD finalize estimates](../../api-integration.md#seedance-25-hd-finalize-estimates)).

## Inputs & Outputs

**Inputs:** Video (required). With a VEO provider it must come from a VEO generation node in this workflow; with Seedance 2.5 HD, from a Seedance 2.5 node with Draft on.
**Outputs:** Upscaled video
## Best Practices

- VEO 1080p is a good option for moderate upscaling
- Use Topaz 2x for highest quality results
- Upscale after all other processing is complete to avoid re-processing at higher resolution
- 1x Topaz (enhance) improves quality without changing resolution

## Common Use Cases

- Upscale AI-generated 480p/720p video to 1080p for publishing
- Enhance video quality before final delivery
- Prepare content for high-resolution displays or large screens

## Tips

- Upscaling works best on clean source video — apply noise reduction or effects before upscaling
- VEO 4K is the highest-quality option — only use for final deliverables that truly need 4K
- Topaz 1x enhance is great for improving quality without changing dimensions
