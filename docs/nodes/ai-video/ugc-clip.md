# UGC Clip
> Renders one clip of a UGC video, checks two of its frames, and renders it once more if the check fails.

**Availability:** Nodaro Cloud only.

## Overview

UGC Clip renders one clip of a UGC video: the creator saying that clip's lines. It runs once for each clip [UGC Clips](./ugc-clips.md) made. When the clip is voiced, its voice is made first, and a voice that runs longer than the clip lengthens the clip to fit, up to the video model's longest clip. A voice too long even for that stops the clip before its video renders, with "Clip N's voice runs … so the clip was not rendered. Shorten the lines in this clip and run UGC Clips again." The clip is not charged, and UGC Clip fails as a whole (see [All or nothing](#all-or-nothing)). A long English take rarely gets that far: [UGC Clips](./ugc-clips.md) splits it into two clips instead.

Each render is checked: two of its frames are read beside the creator's image to catch a bad take. If the check fails, the clip is rendered once more and checked again. The new take is kept if it passes; otherwise the first one is kept, and [UGC Cards](./ugc-cards.md)' Notes say what the check found. If the check itself cannot run, the take is kept without it, and the Notes say so.

On a Hebrew video, each render is also checked against the clip's recorded speech. A render with no sound fails that check and is rendered once more; if no render has sound, the clip stops with "Clip N has no sound, so the video cannot be finished. Re-render that clip from its UGC Clip node."

The node shows the clips it rendered, and how many warnings they carry.

### Re-render

The settings list the last run's clips, each with its length and its warnings, and a **Re-render** button for each. A clip you press is marked "Will re-render on the next run". The next run of UGC Clip, or of the workflow, renders that clip again and reuses every other one at no cost.

In the editor, a clip whose content has not changed is not rendered again: the next run hands back the take it already made, at no cost. A clip whose line, creator or voice changed renders again, and so does every clip of a new script or a new creator. A published app's run renders every clip of its own video: two app runs never share a clip, even of the same script. **Retry** of a failed run in the app runner continues that run: the clips it finished are handed back at no cost, and only the clips it did not finish render and are charged (see [Retry of a failed app run](../../api-integration.md#retry-of-a-failed-app-run)). **Start over** runs it from the beginning, so its clips render again.

### All or nothing

If any clip fails, UGC Clip fails as a whole, so a **Bundle** edge after it never receives a partial list: the joined video is never made with a clip missing. The clips that finished are kept and charged; in the editor, the next run reuses them at no cost and renders only what failed. In a server run (a workflow or app run, or one through the API), the failed node's state says what it finished: `iterationTotal` (its clips), `iterationCompleted` (how many finished), `jobIds` (the finished clips' jobs, in the order they finished) and `jobRows` (beside each of those jobs, the clip it made, counted from 0). The run's history lists each finished clip under the failed node by its clip number. It carries no `output`: the node still hands nothing on.

### Wiring

UGC Clip's **Video** output needs a **Bundle** edge ([Edge Modes](../../edge-modes.md#mode-3-bundle-all-at-once)) into [Combine Videos](../processing-video/combine-videos.md), which joins the clips in order: an edge from UGC Clip is **Selected** by default, which would pass on one clip. A video of one clip passes through Combine Videos unchanged, at no cost. The same output also feeds UGC Cards' **Clip notes**, which reads each clip's warnings and real length.

## Configuration

No settings of its own: the settings list the last run's clips, with **Re-render** (above).

## Inputs & Outputs

- **Input** `clip` (**Clip**) — one clip from UGC Clips' **Clips** output. Without it the node fails with "Connect the Clips output of UGC Clips."
- **Output** `video-out` (**Video**) — the finished clip, an ordinary video for any video input.

## Credit Cost

The video model's price for the clip's length, plus the voice when the clip is voiced, plus one frame reading for each render — an [Image to Text](../ai-image/image-to-text.md) call, charged for the tokens it used at its model's rate (≈6 credits<!-- credits: image-to-text:claude-sonnet-5.5 --> typical on Claude Sonnet 5.5). While it renders the node holds twice the expected amount and returns what it did not use. Example: a clip whose video is priced at 1,000 credits<!-- credits: n/a --> and that passes its check on the first render costs about 1,006 credits<!-- credits: n/a --> (1,000 + a typical reading) and holds about twice that while it renders; one that needs its re-render costs about twice as much.

A re-render costs the video's price and its reading again; the voice is made once. A clip that fails is not charged. A clip never costs more than it holds: when its voice lengthens the clip, the longer clip is priced at its new length out of the same hold, and the re-render runs only if what is left still covers one (the Notes say when it could not). A clip handed back from an earlier run costs nothing.

**In a listed price** (an app's or a template's), a UGC video is counted as its runners run it: Keep is off in what ships, so the script and one creator (drawn as an app run draws it) are always in it, at the script's length setting (see [UGC videos in a published app or template](../../api-integration.md#ugc-videos-in-a-published-app-or-template)). A step priced by its input's length (Combine Videos, Trim, Loop or Video SFX) on UGC Clip's output, other than the video's own join, counts UGC Clip as one clip at the longest length any video model makes, however many clips it receives.

## Prices in the editor

Before a run that includes a UGC node, the editor prices the run's UGC part with the server's own figure, for exactly the nodes the run executes, every creator option included: the price it shows is what the run is expected to cost. Your balance is then checked against what the run holds while its clips render, about twice their price; the part not used comes back when they finish. On a Hebrew video the recorded speech decides how many clips there are, so the check holds the most clips any recording the video accepts can be cut into (a recording holds at most 1.2 times the target length, never more than 21 seconds), not the clips the target length usually needs. A balance below that refuses the run before anything starts, with the buy-credits dialog. This holds on every way to start a run: **Run**, **Run from here**, **Run up to here**, **Run selected**, a node's own ▶, **Render final** and **Update preview**. A run with no UGC part is checked as before.

Until the server's figure arrives, the run buttons show the editor's own estimate. When the figure cannot be checked, the run asks before it starts, and says why, and **Render final** and **Update preview** mark their price "(estimate)". A kept creator or script costs nothing, and a kept script is priced at its own length and screenshot cards. Clips that have not changed are reused at no cost: a run whose clips are already made prices only the ones it renders (below); any other run counts every clip, so it may cost less than its price.

### A run whose clips are already made

A run of UGC Clip whose UGC Clips does not run (UGC Clip's own ▶ after pressing **Re-render**, or **Run from here** on it) renders the clips UGC Clips already made, so it is priced from those clips, not from the script's length:

- **Price:** the sum of each clip that renders (its video, its voice when voiced, and its frame reading), plus the finish on a Hebrew video. A clip is not counted only when it is **your own** finished take of exactly that clip, made at the clip's current **Re-render** count, with no **Re-render** pressed on it since: the run hands that take back at no cost. The server checks this against your own clips before it prices the clip at nothing, so a workflow someone else ran (a shared workspace workflow, a copy, an import) prices their takes in full: your run renders those clips again.
- **Hold:** each clip that renders at twice its price, plus the finish.

For example, after a run of three clips in which clip 2 failed, the price is clip 2's alone; press **Re-render** on clip 3 as well, and it is clips 2 and 3.

When the editor cannot tell which takes the run hands back, it counts every clip at full price, and the run may cost less than its price. That happens when a take does not record the job that made it and its Re-render count (a take a server run landed, or one from before this was recorded), when a take was made at another Re-render count than the clip has now, when the last run was of a single clip, when the saved clips cannot be read, or when their price cannot be had in time. A run that also runs UGC Clips makes new clips, so it is priced from the script's length as above.

A published app's run is checked the same way before it starts, against what its UGC video can hold while it renders: see [UGC video nodes](../../api-integration.md#13e-ugc-video-nodes-nodaro-cloud-only). Its clips are not made yet when it starts, so it counts every clip.

## After a run that ended while the editor was closed

When a run ends while its editor is closed, reopening the editor shows that run's results on UGC Creator, UGC Script, UGC Clips, UGC Clip and UGC Cards, and on the UGC video's own join, overlay and captions (the Combine Videos, Video Overlay and Add Captions that belong to the video by their place in it), in place of older ones: the newer run wins. UGC Clip and those three show the newer video first and keep the older ones below it. Every other video node fills only when it is empty.

## Tips

- Watch each clip before you join them; press **Re-render** on the ones you do not like, then run again: only those render.
- A note in UGC Cards such as "Clip 2 may not say its line exactly" points at the clip to re-render.
- Publishing ships no takes — except a template published with **Include this run's results**, which shows each clip's current take as an example (see [UGC videos in a published app or template](../../api-integration.md#ugc-videos-in-a-published-app-or-template)).

## See Also

- [UGC Video From Your Site](../../tutorials.md#ugc-video-from-your-site) — the template that wires the six UGC nodes into a finished video
- [UGC Creator](./ugc-creator.md) · [UGC Script](./ugc-script.md) · [UGC Clips](./ugc-clips.md) · [UGC Cards](./ugc-cards.md)
- [Combine Videos](../processing-video/combine-videos.md) — joins the clips
- [Video Overlay](../processing-video/video-overlay.md#layer-plan-input) — draws the screenshot cards
- [Add Captions](../processing-video/add-captions.md#caption-plan-input) — draws the captions
