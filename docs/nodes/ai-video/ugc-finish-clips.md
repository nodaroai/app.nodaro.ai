# UGC Finish
> Takes every clip of a UGC video at once and hands them on in order, ready to join.

**Availability:** Nodaro Cloud only.

## Overview

UGC Finish sits between [UGC Clip](./ugc-clip.md) and the join ([Combine Videos](../processing-video/combine-videos.md)). It takes all the clips at once, in clip order, and hands them on in the same order.

On a Hebrew video, whose clips are cut from one recorded speech, it lays that speech back over each clip and trims the pauses between words, so the joined video sounds like one take. That is one job with a flat price. On an English video the clips pass through unchanged, at no cost.

## Configuration

No settings.

## Inputs & Outputs

- **Input** `clips` (**Clips**) — UGC Clip's **Video** output, as a Bundle edge (every clip at once).
- **Input** `plan` (**Script**) — UGC Clips' **Script (sized)** output.
- **Output** `video-out` (**Video**) — the finished clips, in order; a Bundle edge into Combine Videos joins them.

## Credit Cost

Free of its own (0 credits). On a Hebrew video it runs one finish job, 30 credits. On an English video it runs nothing.

## See Also

- [UGC Clips](./ugc-clips.md), [UGC Clip](./ugc-clip.md), [UGC Cards](./ugc-cards.md)
- [UGC Video From Your Site](../../tutorials.md#ugc-video-from-your-site) — the template that wires the six UGC nodes into a finished video
