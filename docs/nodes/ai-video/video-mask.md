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
| Hold mask when the subject is lost | toggle | off | When the model loses the subject for a few frames (a hand in front of a face), each frame whose mask covers under 0.002 % of the picture (about 41 px at 1080p — a stray speck; a real subject, however small, is kept) repeats the most recent non-empty mask, so a mask that hides the subject never uncovers it. A mask is held for at most 1 second; if the subject is still missing after that, the remaining frames stay empty until the model finds it again, so a mask never lingers where the subject no longer is. Frames before the first detection stay empty; frame count, rate and size are unchanged. The API takes it as `holdLastMask`, and the job's output then also reports `heldFrames`. |
| Ignore subjects smaller than (% of frame height) | slider | `0` (off) | Drops, on every frame, each separate white region (pixels touching, diagonals included) whose bounding box is shorter than this share of the frame height — for example extras' faces behind the main person (on a 540-px-tall shot, `15` keeps faces 81 px tall or more). Bigger regions are kept exactly. It runs before *Hold mask when the subject is lost*, so a frame left with only small regions counts as empty and is held from the last frame with a big subject. If no region on any frame is tall enough, the result is an all-black (empty) mask with `coverage` 0 and `kept` false, delivered and charged as usual. The API takes it as `minSubjectHeightPct` (0–100); the job's output then also reports `droppedRegions`. To tell an empty mask from a tiny one, read `kept` (any region left on any frame), not `coverage`, which is rounded to 4 decimals. |
| Ignore subjects larger than (% of frame height) | slider | `0` (off) | The mirror: drops each region whose bounding box is TALLER than this share of the frame height — for example a paste-back mask that keeps only the small faces in the background. With both set, a region is kept when *smaller than* ≤ its height ≤ *larger than*; the smaller-than value above the larger-than value is refused (the panel warns). Same pass, same rules: before the hold, and an empty mask (`coverage` 0, `kept` false, charged) when nothing is left. The API takes it as `maxSubjectHeightPct` (0–100). |
| Zone | four % fields (left, right, top, bottom) | `0` each (off) | Keeps only the regions whose bounding-box **centre** lies inside the frame minus these margins — for example to drop the faces at the edges of the picture. Each margin is `0`–`49` % of the frame width (left / right) or height (top / bottom), so the inner rectangle is never empty; a region straddling the line is kept or dropped as a whole, by its centre. It runs on every frame after the two size cuts and before *Hold mask when the subject is lost*, so a frame left with nothing inside counts as empty and is held. All four at `0` turns it off (the node stores `null`). If nothing is inside on any frame, the result is an empty mask (`coverage` 0, `kept` false), delivered and charged as usual. The API takes it as `zone: { leftPct, rightPct, topPct, bottomPct }` (a margin left out is 0); the job's output then reports `droppedRegions` too. |
| Detect again after every cut | toggle | off | For an edited clip: the scene cuts are found first and each shot is segmented on its own, so the subject is found anew in each shot (a new face or object after a cut is masked too) and *Hold mask when the subject is lost* never carries a mask across a cut. A dissolve or fade counts as one shot, a camera flash is usually not a cut, a cut into fast motion (a swing, a hit, a whip pan) still counts, and a piece shorter than 8 frames joins the shot next to it. Each shot's mask is fitted to that shot's exact frame count, so the mask keeps the clip's frame count and every cut stays where it is. On a clip with no cut it is one shot — the same mask, fitted to the clip's exact frame count. The price does not change (it follows the clip's length). The API takes it as `perShot`; the job's output reports `shots` (1 when off). |
| Detect again every (seconds) | slider | `0` (off) | The model finds its subjects near the start of each request it is sent, and a subject that first shows up partway through — someone who walks in, or a face that turns to the camera a second into the shot — can stay unmasked for the rest of that request. Set this to `1`–`10` and the clip is sent in pieces of at most that many seconds, so the subjects are detected again at the start of each piece: a face that appears mid-shot is masked from the next boundary on. The pieces are counted from the start of the clip — or, with *Detect again after every cut* on, from the start of each shot (so every cut still starts a piece); a last piece shorter than 8 frames joins the one before it. These boundaries are not cuts: *Hold mask when the subject is lost* carries a mask across them. Each piece is one more request to the model (three run at a time, each takes about half a minute however short), so the run takes longer — a 10-second clip at `1` is about four rounds of requests instead of one. **The price does not change** (it follows the clip's length). Each piece's mask is fitted to that piece's exact frame count, so the mask keeps the clip's frame count. It works with or without *Detect again after every cut*. The API takes it as `redetectEverySec` (`0`, or `1`–`10`; a value in between or above is refused); the job's output reports `chunks`, the number of requests. |
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
- A clip longer than 1,800 frames (60 seconds at 30 fps) is segmented in 1,800-frame chunks — up to three at a time — and the masks are joined frame for frame. Tracking starts afresh at each chunk boundary; because the mask is the union of everything the prompt matches, this rarely shows. With *Detect again after every cut* on, every cut is a chunk boundary too, and a shot longer than 1,800 frames is split the same way. With *Detect again every (seconds)* set, the chunks are that many seconds long instead, and tracking starts afresh at each of them by design.
- A rotated phone clip, a variable-frame-rate clip, or one larger than 1920 px on its long side is first re-encoded upright, at a constant rate and at most 1920 px; the mask has that geometry. Mask Composite stretches the mask over the full-size footage, so this needs no action on your side.

## Credit Cost

Priced by the clip's length at the 30 fps basis, in steps — one price row per model and step (`sam-3.1-video:<bucket>` / `sam-3-video:<bucket>`):

| Clip length (at 30 fps) | SAM 3.1 row | Credits | SAM 3 row | Credits |
|---|---|---|---|---|
| up to 5 s | `sam-3.1-video:5s` | 55<!-- credits: sam-3.1-video:5s --> | `sam-3-video:5s` | 28<!-- credits: sam-3-video:5s --> |
| up to 10 s | `sam-3.1-video:10s` | 105<!-- credits: sam-3.1-video:10s --> | `sam-3-video:10s` | 53<!-- credits: sam-3-video:10s --> |
| up to 15 s | `sam-3.1-video:15s` | 160<!-- credits: sam-3.1-video:15s --> | `sam-3-video:15s` | 81<!-- credits: sam-3-video:15s --> |
| up to 30 s | `sam-3.1-video:30s` | 314<!-- credits: sam-3.1-video:30s --> | `sam-3-video:30s` | 158<!-- credits: sam-3-video:30s --> |
| up to 60 s | `sam-3.1-video:60s` | 622<!-- credits: sam-3.1-video:60s --> | `sam-3-video:60s` | 312<!-- credits: sam-3-video:60s --> |
| up to 90 s | `sam-3.1-video:90s` | 935<!-- credits: sam-3.1-video:90s --> | `sam-3-video:90s` | 468<!-- credits: sam-3-video:90s --> |
| up to 2 min | `sam-3.1-video:120s` | 1243<!-- credits: sam-3.1-video:120s --> | `sam-3-video:120s` | 622<!-- credits: sam-3-video:120s --> |
| up to 3 min | `sam-3.1-video:180s` | 1865<!-- credits: sam-3.1-video:180s --> | `sam-3-video:180s` | 933<!-- credits: sam-3-video:180s --> |
| up to 4 min | `sam-3.1-video:240s` | 2486<!-- credits: sam-3.1-video:240s --> | `sam-3-video:240s` | 1243<!-- credits: sam-3-video:240s --> |
| up to 5 min | `sam-3.1-video:300s` | 3108<!-- credits: sam-3.1-video:300s --> | `sam-3-video:300s` | 1555<!-- credits: sam-3-video:300s --> |

**Formula:** priced length = clip seconds × max(1, frame rate ÷ 30), rounded up to a whole second; the run is charged the smallest row of its model that covers it.

**Worked examples:**
- 4 s at 30 fps → priced at 4 s → `sam-3.1-video:5s` (55 credits<!-- credits: sam-3.1-video:5s -->).
- 12 s at 24 fps → priced at 12 s → `sam-3.1-video:15s` (160 credits<!-- credits: sam-3.1-video:15s -->).
- 10 s at 60 fps → priced at 20 s → `sam-3.1-video:30s` (314 credits<!-- credits: sam-3.1-video:30s -->).
- 45 s at 30 fps → priced at 45 s → `sam-3.1-video:60s` (622 credits<!-- credits: sam-3.1-video:60s -->).
- 100 s at 30 fps → priced at 100 s → `sam-3.1-video:120s` (1243 credits<!-- credits: sam-3.1-video:120s -->).
- 4 minutes at 30 fps on SAM 3 → `sam-3-video:240s` (1243 credits<!-- credits: sam-3-video:240s -->).

**Before a run** (the node's badge, a workflow estimate) the clip's length is known only when the incoming clip tells it (an upload's declared `duration`, a Trim Video window, a generation's configured duration, a render's estimate). When that clip is an upload that also declares its frame rate (`fps` in its data) — wired straight in, or through a Trim Video, a Loop Video, or a Combine Videos whose clips all declare the same rate — Video Mask is quoted at its frame-rate-priced length, the same rule a run is charged by (a 10 s upload at 60 fps is quoted as 20 s); with no declared rate, it is quoted at that length's row at 30 fps. When the length is not known at all, the badge shows the range from the model's shortest row up to its longest (**50–2825** on SAM 3.1, **25–1413** on SAM 3), and a workflow estimate counts the longest. The run itself always measures the clip — including its real frame rate — and is charged that row.

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
