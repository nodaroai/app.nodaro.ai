# UGC Clip
> Renders one clip of a UGC video, checks two of its frames, and renders it once more if the check fails.

**Availability:** Nodaro Cloud only.

## Overview

UGC Clip renders one clip of a UGC video: the creator saying that clip's lines. It runs once for each clip [UGC Clips](./ugc-clips.md) made. When the clip is voiced, its voice is made first, and a voice that runs longer than the clip lengthens the clip to fit.

Each render is checked: two of its frames are read beside the creator's image to catch a bad take. If the check fails, the clip is rendered once more and checked again. The new take is kept if it passes; otherwise the first one is kept, and [UGC Cards](./ugc-cards.md)' Notes say what the check found.

The node shows the clips it rendered, and how many warnings they carry.

### Re-render

The settings list the last run's clips, each with its length and its warnings, and a **Re-render** button for each. A clip you press is marked "Will re-render on the next run". The next run of UGC Clip, or of the workflow, renders that clip again and reuses every other one at no cost.

In the editor, a clip whose content has not changed is not rendered again: the next run hands back the take it already made, at no cost. A clip whose line, creator or voice changed renders again, and so does every clip of a new script or a new creator. A published app's run renders every clip of its own video.

### All or nothing

If any clip fails, UGC Clip fails as a whole, so a **Bundle** edge after it never receives a partial list: the joined video is never made with a clip missing. The clips that finished are kept and charged; in the editor, the next run reuses them at no cost and renders only what failed.

### Wiring

UGC Clip's **Video** output needs a **Bundle** edge ([Edge Modes](../../edge-modes.md#mode-3-bundle-all-at-once)) into [Combine Videos](../processing-video/combine-videos.md), which joins the clips in order: an edge from UGC Clip is **Selected** by default, which would pass on one clip. A video of one clip passes through Combine Videos unchanged, at no cost. The same output also feeds UGC Cards' **Clip notes**, which reads each clip's warnings and real length.

## Configuration

No settings of its own: the settings list the last run's clips, with **Re-render** (above).

## Inputs & Outputs

- **Input** `clip` (**Clip**) — one clip from UGC Clips' **Clips** output. Without it the node fails with "Connect the Clips output of UGC Clips."
- **Output** `video-out` (**Video**) — the finished clip, an ordinary video for any video input.

## Credit Cost

The video model's price for the clip's length, plus the voice when the clip is voiced, plus one frame reading (3 credits) for each render. While it renders the node holds twice the expected amount and returns what it did not use. Example: a clip whose video is priced at 1,000 credits and that passes its check on the first render costs 1,003 credits and holds 2,006 while it renders; one that needs its re-render costs 2,006.

A re-render costs the video's price and its reading again; the voice is made once. A clip that fails is not charged. A clip never costs more than it holds: when its voice lengthens the clip, the longer clip is priced at its new length out of the same hold, and the re-render runs only if what is left still covers one (the Notes say when it could not). A clip handed back from an earlier run costs nothing.

**In a listed price** (an app's or a template's), a UGC video is counted as its runners run it: Keep is off in what ships, so the script and one creator (drawn as an app run draws it) are always in it, at the script's length setting (see [UGC videos in a published app or template](../../api-integration.md#ugc-videos-in-a-published-app-or-template)). A step priced by its input's length (Combine Videos, Trim, Loop or Video SFX) on UGC Clip's output, other than the video's own join, counts UGC Clip as one clip at the longest length any video model makes, however many clips it receives.

## Prices in the editor

Before a run that includes a UGC node, the editor prices the run's UGC part with the server's own figure, for exactly the nodes the run executes, every creator option included: the price it shows is what the run is expected to cost. Your balance is then checked against what the run holds while its clips render, about twice their price; the part not used comes back when they finish. A balance below that refuses the run before anything starts, with the buy-credits dialog. This holds on every way to start a run: **Run**, **Run from here**, **Run up to here**, **Run selected**, a node's own ▶, **Render final** and **Update preview**. A run with no UGC part is checked as before.

Until the server's figure arrives, the run buttons show the editor's own estimate. When the figure cannot be checked, the run asks before it starts, and says why, and **Render final** and **Update preview** mark their price "(estimate)". A kept creator or script costs nothing, and a kept script is priced at its own length and screenshot cards. Clips that have not changed are reused at no cost, so a run may cost less than its price.

A published app's run is checked the same way before it starts, against what its UGC video can hold while it renders: see [UGC video nodes](../../api-integration.md#13e-ugc-video-nodes-nodaro-cloud-only).

## After a run that ended while the editor was closed

When a run ends while its editor is closed, reopening the editor shows that run's results on UGC Creator, UGC Script, UGC Clips, UGC Clip and UGC Cards, and on the UGC video's own join, overlay and captions (the Combine Videos, Video Overlay and Add Captions that belong to the video by their place in it), in place of older ones: the newer run wins. UGC Clip and those three show the newer video first and keep the older ones below it. Every other video node fills only when it is empty.

## Tips

- Watch each clip before you join them; press **Re-render** on the ones you do not like, then run again: only those render.
- A note in UGC Cards such as "Clip 2 may not say its line exactly" points at the clip to re-render.
- Publishing ships no takes — except a template published with **Include this run's results**, which shows each clip's current take as an example (see [UGC videos in a published app or template](../../api-integration.md#ugc-videos-in-a-published-app-or-template)).

## See Also

- [UGC Video From Your Site](../../tutorials.md#ugc-video-from-your-site) — the template that wires the five UGC nodes into a finished video
- [UGC Creator](./ugc-creator.md) · [UGC Script](./ugc-script.md) · [UGC Clips](./ugc-clips.md) · [UGC Cards](./ugc-cards.md)
- [Combine Videos](../processing-video/combine-videos.md) — joins the clips
- [Video Overlay](../processing-video/video-overlay.md#layer-plan-input) — draws the screenshot cards
- [Add Captions](../processing-video/add-captions.md#caption-plan-input) — draws the captions
