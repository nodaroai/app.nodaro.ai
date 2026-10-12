# Video Mask
> Track a subject described in plain text through a video and get a black-and-white mask video back — white where the subject is, black everywhere else. Powered by SAM 3.1 (or SAM 3, at half the price).

## Overview

Video Mask takes a video and a short text description ("the dancer", "the red car") and returns a **mask video**: the same length and frame rate as the clip, white on every pixel of the subject in every frame, black elsewhere. Several subjects can be tracked at once by separating them with commas ("person, dog") — the mask is their union.

The mask is an ordinary video, so it connects anywhere a video does. Its main partner is [Mask Composite](../processing-video/mask-composite.md), which uses it to place the subject from one video over another (a dancer moved onto a beach, a product over a new backdrop). It also feeds the **Mask video** input of [Relight & Switch](./switchx.md) in custom alpha mode.

**White = subject.** This is the same polarity as [Generate Mask](../ai-image/generate-mask.md) (the still-image twin of this node) and the one Mask Composite expects.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Prompt | text | `""` | What to track — a short noun phrase works best (`"the woman in the red coat"`, `"the skateboard"`). Separate several subjects with commas. Required. Max 500 characters. |
| Threshold | slider | `0.5` | Detection confidence, `0.05`–`0.95` (step 0.05). Lower finds more (and less precise) regions — try `0.3` when nothing matches. |
| Model | select | `sam-3.1` | `sam-3.1` — SAM 3.1, tracks several objects in one pass and runs faster. `sam-3` — SAM 3, half the price. |
| `promptPrefix` / `promptSuffix` | text | -- | Optional pre/post text wrapped around the prompt at run time (settings panel → **Pre & post text**; hidden from app users; captured by presets). See [Prompt pre & post text](../../prompt-pre-post-text.md). |

## Inputs & Outputs

**Inputs:**
- `video` -- the clip to segment. Required.
- `prompt` -- optional text wire (a Text node, a List item); it replaces the panel's prompt.

**Outputs:**
- `video` (labelled **Mask**) -- the mask video (H.264 MP4). White = the subject.

## Limits

- Clips up to **5 minutes at 30 fps**. A faster clip counts proportionally longer — a 60 fps clip is measured at twice its length, so up to 2½ minutes of it — because the model works frame by frame.
- A clip the platform cannot read, or one over the limit, is refused before anything is charged (`invalid_video_duration` / `video_duration_exceeds_limit`).
- A clip longer than 1,800 frames (60 seconds at 30 fps) is segmented in 1,800-frame chunks — up to three at a time — and the masks are joined frame for frame. Tracking starts afresh at each chunk boundary; because the mask is the union of everything the prompt matches, this rarely shows.
- A rotated phone clip, a variable-frame-rate clip, or one larger than 1920 px on its long side is first re-encoded upright, at a constant rate and at most 1920 px; the mask has that geometry. Mask Composite stretches the mask over the full-size footage, so this needs no action on your side.

## Credit Cost

Priced by the clip's length at the 30 fps basis, in steps — one price row per model and step (`sam-3.1-video:<bucket>` / `sam-3-video:<bucket>`):

| Clip length (at 30 fps) | SAM 3.1 row | Credits | SAM 3 row | Credits |
|---|---|---|---|---|
| up to 5 s | `sam-3.1-video:5s` | 50 | `sam-3-video:5s` | 25 |
| up to 10 s | `sam-3.1-video:10s` | 95 | `sam-3-video:10s` | 48 |
| up to 15 s | `sam-3.1-video:15s` | 145 | `sam-3-video:15s` | 73 |
| up to 30 s | `sam-3.1-video:30s` | 285 | `sam-3-video:30s` | 143 |
| up to 60 s | `sam-3.1-video:60s` | 565 | `sam-3-video:60s` | 283 |
| up to 90 s | `sam-3.1-video:90s` | 850 | `sam-3-video:90s` | 425 |
| up to 2 min | `sam-3.1-video:120s` | 1130 | `sam-3-video:120s` | 565 |
| up to 3 min | `sam-3.1-video:180s` | 1695 | `sam-3-video:180s` | 848 |
| up to 4 min | `sam-3.1-video:240s` | 2260 | `sam-3-video:240s` | 1130 |
| up to 5 min | `sam-3.1-video:300s` | 2825 | `sam-3-video:300s` | 1413 |

**Formula:** priced length = clip seconds × max(1, frame rate ÷ 30), rounded up to a whole second; the run is charged the smallest row of its model that covers it.

**Worked examples:**
- 4 s at 30 fps → priced at 4 s → `sam-3.1-video:5s` (50 credits).
- 12 s at 24 fps → priced at 12 s → `sam-3.1-video:15s` (145 credits).
- 10 s at 60 fps → priced at 20 s → `sam-3.1-video:30s` (285 credits).
- 45 s at 30 fps → priced at 45 s → `sam-3.1-video:60s` (565 credits).
- 100 s at 30 fps → priced at 100 s → `sam-3.1-video:120s` (1130 credits).
- 4 minutes at 30 fps on SAM 3 → `sam-3-video:240s` (1130 credits).

**Before a run** (the node's badge, a workflow estimate) the clip's length is known only when the graph tells it (a Trim Video window, a generation's configured duration, a render's estimate); it is then quoted at that length's row at 30 fps. Otherwise the badge shows the range from the model's shortest row up to its longest (**50–2825** on SAM 3.1, **25–1413** on SAM 3), and a workflow estimate counts the longest. The run itself always measures the clip — including its real frame rate — and is charged that row.

## Typical Workflow

```
Upload Video (dance) ──┬──────────────────────────> Mask Composite ─> result
                       │                              ▲  ▲
                       └─> Video Mask ("the dancer") ─┘  │  (mask)
Upload Video (beach) ────────────────────────────────────┘  (background)
```

1. **Upload Video** provides the footage with the subject.
2. **Video Mask** with `prompt = "the dancer"` returns the dancer's mask.
3. **Mask Composite** takes the original footage as its **Foreground**, the beach as its **Background** and the mask as its **Mask** — the dancer now dances on the beach.

## Notes

- **When nothing matches on any frame**, the run fails with *"No region matched the mask prompt on any frame…"* and the credits are refunded. Shorten the prompt to a plain noun phrase, or lower the threshold.
- A subject that leaves the frame and comes back is tracked again when it reappears; frames where it is absent are black.
- The mask is not watermarked on any plan (a watermark would corrupt it).
- Requires a fal.ai key (`FAL_KEY`) on self-hosted installs; without one the run fails with a message saying so.
