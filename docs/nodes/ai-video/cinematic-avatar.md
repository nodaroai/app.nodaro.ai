# Cinematic Avatar

> Generate a cinematic, prompt-driven avatar clip from 1-3 HeyGen avatar looks.

## Overview

The Cinematic Avatar node creates a short cinematic video using HeyGen's generative (Seedance-style) pipeline. Unlike the [AI Avatar](./ai-avatar.md) node — which makes a talking head from a script or audio — Cinematic Avatar is driven entirely by a **text prompt** plus **1-3 avatar look IDs**. There is no script, no voice, and no audio input: the prompt describes the scene, action, and direction, and HeyGen renders a cinematic clip featuring the chosen look(s).

Because the prompt is a true generative prompt, the **Prompt Wizard** and prompt FieldMappings work on this node (they are deliberately disabled on AI Avatar, whose script is spoken verbatim).

## Selecting Avatar Looks

The config panel includes the same searchable avatar picker used by AI Avatar, fed live from the HeyGen API — but here you may pick **1 to 3 looks** to feature in the clip. Preview thumbnails show how each look appears. The picker returns empty with an "HeyGen API not configured" notice when HeyGen is not configured for the deployment.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Prompt | Textarea | — | Generative prompt describing the scene/action (required, 1-10,000 chars). Supports the Prompt Wizard. |
| Avatar Looks | Picker | — | 1-3 HeyGen avatar look IDs to feature (required) |
| Duration | Slider / Number | 10 | Clip length in seconds, range 4-15 |
| Auto Duration | Toggle | off | Let HeyGen pick the clip length (ignores Duration when on) |
| Aspect Ratio | Select | `16:9` | `16:9` (landscape), `9:16` (portrait / vertical), or `1:1` (square) |
| Resolution | Select | `720p` | Output resolution: `720p` or `1080p` |
| Enhance Prompt | Toggle | off | Ask HeyGen to enhance your prompt before generation |

## Inputs & Outputs

**Inputs:**
- Prompt (optional) — generative prompt wired from a text producer (also editable in the config panel)

**Outputs:**
- Generated video URL

## Credit Pricing

Credit cost depends on the selected **resolution** and the **duration** of the generated clip. A hold is reserved when the job starts; the final charge reflects the actual generated length, and any unused amount is **refunded automatically** when the job completes.

### Approximate cost

| Resolution | Credits / sec |
|------------|--------------:|
| 720p | ~9.4 credits/sec |
| 1080p | ~13.75 credits/sec |

**Worked example (the seeded default — 720p, 10 seconds):**

- Per-second rate at 720p ≈ 9.375 credits/sec
- 720p × 10s ≈ **94 credits** charged for the finished clip
- For an exact-duration clip the reserve hold equals the **~94-credit** charge for the 10-second duration, so there is no surplus to refund

A 4-second 720p draft is the cheapest combination (reserve hold ≈ 38 credits); a 15-second 1080p clip is the most expensive (reserve hold ≈ 207 credits).

**Auto Duration:** when **Auto Duration** is on, HeyGen chooses the clip length, so the final duration is unknown until the job completes. To make sure your balance always covers the result, the upfront hold is reserved at the **maximum 15-second** rate for the selected resolution (≈ 142 credits at 720p, ≈ 207 at 1080p). The final charge still reflects the real generated length, and the surplus is refunded automatically on completion.

> **Estimate notice:** The Cinematic Avatar rate is an **estimate** for the generative Seedance pipeline and has not yet been calibrated against a paid run. The credit cost shown in the editor before you run is authoritative, and the final charge always reflects the real clip length. Pricing may be adjusted after the first paid generations.

## Graceful Degradation

If HeyGen is not configured for the deployment:
- The avatar picker shows empty with an explanatory notice
- Attempting to run the node returns an error: `heygen_not_configured`

## Best Practices

- Describe the scene, mood, camera, and action in the prompt — this is a generative prompt, not a spoken script
- Pick a single look for a clear subject; use 2-3 looks when the scene calls for multiple characters
- Start at 720p with a short duration for drafts; raise resolution and duration for final delivery
- Use the Prompt Wizard to flesh out sparse prompts into cinematic direction

## Common Use Cases

- Cinematic intros, teasers, and stylized character moments
- Story beats featuring a consistent set of avatar looks
- Quick generative clips that don't require lip-synced narration

## Tips

- The 9:16 aspect ratio is optimized for TikTok, Instagram Reels, and YouTube Shorts; `1:1` suits square social posts
- Turn on **Auto Duration** when you want HeyGen to choose the most natural length for the prompt
- For talking-head / spokesperson videos with a script or voiceover, use the [AI Avatar](./ai-avatar.md) node instead
