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
- **Output** `video-out` (**Video**) — the finished clips, in order; a Bundle edge into Combine Videos joins them. A single-video wire (anything other than a Bundle edge, such as Mix Audio's `in`) carries the clip shown on the node.

## Credit Cost

Free of its own (0 credits). On a Hebrew video it runs one finish job, 33 credits<!-- credits: ugc-finish -->. On an English video it runs nothing.

### When it stops

On a Hebrew video, a clip with no sound stops the finish job: there is no speech in it to lay back or check. The job fails with "Clip *n* has no sound, so the video cannot be finished. Re-render that clip from its UGC Clip node." The finish job's credits are refunded. Re-render that clip on [UGC Clip](./ugc-clip.md#re-render), then run again.

## Notes

- Publishing ships no finished clips — except a template published with **Include this run's results**, which shows them as an example. On a Hebrew video they are traced to the finish job that made them, and through it to the clips it was given (see [UGC videos in a published app or template](../../api-integration.md#ugc-videos-in-a-published-app-or-template)).

## See Also

- [UGC Clips](./ugc-clips.md), [UGC Clip](./ugc-clip.md), [UGC Cards](./ugc-cards.md)
- [UGC Video From Your Site](../../tutorials.md#ugc-video-from-your-site) — the template that wires the six UGC nodes into a finished video
