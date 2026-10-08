# Speaker View

> Render an edit with its speakers on screen — a layout, a switch at each speaker change and an emphasis on whoever is talking. The sound is the edit's own, passed through.

**Not priced yet.** Speaker View has no credit price at the moment, so every run that includes it is refused before anything starts — no node upstream runs or is charged — with *"Speaker View is not priced yet"*, naming the node. Run a selection that leaves it out to use the nodes before it. The node, its settings and its checks are all in place; running it opens when its price is set.

**Cloud feature.** Speaker View runs on Nodaro Cloud. On a self-hosted install, connect your instance to nodaro.ai (Integrations → nodaro.ai, or paste an API key) and the node relays to the cloud; without a connection the node saves on the canvas but cannot run. A self-host sends each camera to nodaro.ai, so a private camera file over the 500 MB re-host limit is refused up front, naming the file — use a public URL or a smaller file.

## Overview

[Apply EDL](./apply-edl.md) shows one camera full-frame per segment. Speaker View is the render for edits that need more: both hosts side by side, a vertical clip that follows whoever is speaking, a grid for a panel, a picture-in-picture, with a crop framed on each speaker. It reads the originals on the master clock, so the picture and the sound stay locked, and it hands back the **EDL as it drew it** on its `json` output.

It decides **how** the speakers are shown, never **who** is on screen: [Camera Switch](./camera-switch.md) chooses the camera for each cut, Speaker View lays them out. A typical chain: **Audio Sync** → **Transcribe** with speaker detection → **Edit Plan** → **Camera Switch** → **Speaker View**.

A **Preview** (**Quality** set to **Preview**) is a private 720p render to review before a final is made. In the editor the **Quality** select reads **Final — no review step** and **Preview first — review, then Render final**, the same two options as [Apply EDL](./apply-edl.md#configuration)'s. Where the preview stop rule is on (`PREVIEW_STOP_RULE_ENABLED`), a run stops at a Speaker View set to Preview exactly as it [stops at an Apply EDL Preview](./apply-edl.md#a-run-stops-at-a-preview): the nodes after it are skipped and not billed in that run. **Render final** is in the right-click menu of Speaker View and of the Edit Plan behind it (there is no Render final button on the node itself): it renders Speaker View at Final for that run only, then everything after it, and the node keeps its own **Quality**. See [Render final](./apply-edl.md#render-final).

## Inputs

| Handle | Type | Required | Description |
|--------|------|----------|-------------|
| EDL | json | **Yes** | One edit on the recording's clock — Edit Plan's or Camera Switch's EDL. A clip set is refused here (it fans out one Speaker View run per clip on the canvas). Media resolves from each source's URL; there is no *Sources* input. |
| Transcript | json | When the edit does not name its speakers | The word transcript with speaker labels. Speaker View splits the edit at each speaker's turn and uses the labels when no segment names a speaker. |

When the node wired into **EDL** has not run yet, the panel says so and offers **Run up to here · ≈N**. It runs the nodes before Speaker View that have not run, asking first only when the estimate is above the usual run-confirm threshold, and does not run Speaker View itself. See [Run up to here](../../features/run-results.md#run-up-to-here).

## Outputs

| Handle | Type | Description |
|--------|------|-------------|
| Video | video | The rendered edit. |
| EDL | json | The edit as drawn: split at the speakers' turns, with its layouts, switches and emphasis written in. It is an **EDL, not a transcript** — it never feeds Add Captions' Transcript input. |

## Settings

| Field | Control | Default | Description |
|-------|---------|---------|-------------|
| Aspect ratio | Tiles | the edit's own, else 16:9 | 16:9, 9:16, 1:1 or 4:5. Output size is fixed per aspect: a final is 1920×1080, 1080×1920, 1080×1080 or 1080×1350; a Preview has a 720-pixel short side. |
| Quality | Select | Final | Final, or Preview (a private 720p render to review). |
| Layout | Tiles | Auto (Single on one camera) | Auto, Single, Side by side, Stacked, Grid, Picture in picture. Each tile is drawn at the output's aspect. |
| Switch | Tiles | Cut (Pan on one camera) | What happens at a speaker change: Cut, Pan, Zoom, or a Crossfade chosen from a list of transitions. Cut, Pan and Zoom loop a small animation of what they do. |
| Switch duration | Slider | 600 ms | The tween length of a Pan or Zoom; 0–5000 ms in 50 ms steps. |
| Emphasis | Toggles | Scale | Scale, Border and Dim, alone or together; all off is *none*. |
| Emphasis ease | Slider | 300 ms | 0–5000 ms in 50 ms steps. |
| Border colour | Colour (under *Advanced*) | white | The colour of the Border emphasis, `#RRGGBB`. |
| Framing | **Edit framing…** (the region editor) | full frame | A crop of each camera per speaker, as fractions of the frame (`speakerRegions`). The panel says how many crops are set; see [Framing](#framing-the-region-editor). |

A tile the aspect or the speaker count rules out is greyed. Hover it or move the keyboard focus onto it and it says why ("Side by side shows at most 2 speakers; this edit has 3"); the reasons are also listed under the group, for touch screens. A greyed tile cannot be picked, but a stored value the rules no longer allow is shown as it is and can always be switched off or changed.

### Which choices apply where

The panel greys a choice the aspect or the speaker count rules out and says why; the quick strip removes a layout that is ruled out, but its switch list always lists Cut, Pan and Zoom and greys the ones the rule rules out, with the reason on hover and on keyboard focus. The Crossfade is greyed the same way, as one row (below).

| Layout | At a speaker change | Switch | Emphasis |
|--------|--------------------|--------|----------|
| **Single** | the one slot re-frames to the new speaker | Cut, Pan (between two crops of one camera), Zoom, crossfade | greyed — Single shows one speaker |
| **Picture in picture** | main and inset swap | Cut, Zoom, crossfade; Pan when both are on one camera | Border and Dim (the swap is the Scale) |
| **Side by side**, **Stacked**, **Grid** | the slots stay; the active one is marked | used only where the layout itself changes: Cut or crossfade | Scale, Border, Dim, and combinations |

- **Side by side** is drawn for 16:9 and 1:1; **Stacked** for 9:16, 4:5 and 1:1; **Grid**, **Single** and **Picture in picture** for every aspect.
- **Side by side**, **Stacked** and **Picture in picture** take exactly two speakers; **Grid** takes two to six. The slots are the speakers in order of first appearance.
- A layout the aspect or the speaker count rules out **snaps** to its twin (Side by side ↔ Stacked), else Grid if the count fits, else Single — "Side by side isn't drawn for 9:16 — renders as Stacked". An edit written as JSON snaps the same way.
- **Pan** is a sweep inside one camera; at a speaker change between two cameras it cuts. **Crossfade** is written only where the edit's clock jumps (a stretch of the recording was cut out between the two speakers), never over contiguous speech. Under the Switch tiles the panel counts how many of the edit's speaker changes each one reaches — "Pan applies to 41 of 63 speaker changes; the other 22 are between cameras and cut" — and the Pan tile, and the Pan row in the quick strip, is greyed ("No speaker change can pan here.") only when none of them stays on one camera. Pan and Zoom are greyed under a fixed multi-slot layout (Side by side, Stacked or Grid), because its slots stay where they are. The Crossfade tile, and its row in the quick strip, is greyed the same way when none of them crosses a jump of the clock, saying so on hover and on keyboard focus; a crossfade you already chose is kept as it is. The counts need the edit to name its speakers (Camera Switch does); an edit that does not shows none.

### Framing (the region editor)

**Edit framing…** in the panel opens the region editor over the whole window; the link `?framing=<node id>` opens it too. It needs the edit's cameras and speakers, so run Edit Plan (and Camera Switch) first. On a read-only workflow (shared with you to view, or a Studio workflow) the editor does not open, from the panel or from a link.

- **What it lists.** Each camera of the edit, and under it the speakers it shows once your layout is applied. A camera showing one speaker (a close-up) is shown full frame and has no box until you draw one (**Draw a box**). A camera shared by several speakers (a wide shot) starts with one box per speaker: full height, the output's width, centred at the speaker's share of the frame — the left and right thirds for two speakers at 9:16. **Reset to thirds** brings those back.
- **The frame.** The camera's own video plays under the boxes, with a scrubber in the edit's master time (a camera that started later than the master plays at master time minus its offset). **Jump to *speaker*** seeks to their first turn longer than 3 seconds that the camera covers; it is disabled when there is none. A camera the browser cannot play (for example a `.mkv`) shows its upload's thumbnail instead.
- **What is drawn.** A box is a free rectangle. The renderer crops it to the tile's shape around its centre, so one box serves every layout and aspect; the dashed rectangle inside the selected box is that crop for the layout chosen under **Show as** (each layout the speaker appears in, at your aspect). The output preview shows the crop, and a chip states its size, for example "607 × 1080 → 1080 × 1920 · 1.8× upscale" — amber above 1.5×, where the picture starts to soften.
- **Keys.** Arrows move the box by one camera pixel (Shift: ten), Tab moves through the boxes (each one is selected as it gets focus) and then on to the controls, F shows the selected speaker full frame, ⌘Z / ⇧⌘Z undo and redo inside the editor. **Swap** trades the boxes of a camera's two speakers.
- **Saving.** **Save framing** writes every box shown, as fractions with four decimals; a speaker shown full frame writes nothing. Closing with unsaved changes asks first, and nothing is stored until you save. The boxes a wide shot starts with count as unsaved until you save them: a node whose framing was never saved renders every camera full frame, so closing the editor on a fresh node asks before discarding them. **Copy JSON** in the header copies what Save would write. Crops stored for a speaker this edit no longer shows are kept. On a phone the editor shows one camera (picked from a menu) and one box at a time.

### What the Input section says

| You see | It means |
|---------|----------|
| *Wire an EDL …* | Nothing is wired into **EDL** yet; only the rules the aspect alone decides apply. |
| *Edit Plan hasn't run yet. Layout and framing need its speakers.* | An EDL is wired, but the node feeding it has no result yet; run it first. |
| *Camera Switch clips: 8 clips · 2–3 speakers …* | A clip set from Camera Switch runs Speaker View once per clip, so a setting is offered only when it suits every clip, and a greyed tile names the clip. |
| *This transcript's speakers (speaker_0, speaker_1) don't match the edit's (Host, Guest) …* | Camera Switch renames the speakers; wire its **Transcript** output rather than Transcribe's. |
| *This edit has several cameras but no speaker on any segment …* | Wire Camera Switch between Edit Plan and Speaker View. |
| *Wire a transcript …* / *This transcript has no speaker labels …* | The edit names only some of its speakers and the transcript cannot fill in the rest. |
| *Side by side isn't drawn for 9:16 — renders as Stacked.* | The stored layout snaps to the layout that is drawn, as described above. |

### A camera that starts late

A multi-camera segment that reads a camera before that camera's own start (its offset) does not refuse the edit: it drops the cameras that had not begun and snaps what is left by the rule above, and the notes of the badge say how many segments did. Only a segment whose **own** camera, or whose sound, has not begun is refused.

## What is refused before anything is reserved

The badge and the run use the same rule, so what the badge passes, the run accepts:

- an edit that is not one master-clock EDL with a picture on every segment (a clip set, a rendered output's EDL, a source with no URL);
- an edit the shared EDL validator refuses;
- a framing crop too small to crop (each side must be at least 1% of the frame) or outside the frame;
- a layout, switch, emphasis or colour the renderer does not draw;
- an output over **180 minutes**;
- on **two or more cameras**, speakers it cannot read: no speaker on any segment while the transcript names two or more speakers or none (*"Wire Camera Switch between Edit Plan and Speaker View"*); a partly named edit with no transcript, or a transcript with no speaker labels. A transcript with exactly **one** speaker label passes, and a fully named edit is never refused for its transcript;
- a speaker no camera shows.

## Reviewing a cut

Speaker View is reviewed the way [Apply EDL](./apply-edl.md#reviewing-a-cut) is:

- **Review cut.** A Speaker View fed by an [Edit Plan](./edit-plan.md#reviewing-a-cut) Tighten cut — directly or through Camera Switch — carries a **Review cut** button (**Review clips** for a Clips plan) whatever it shows: a Preview, a Final, or nothing yet. The review judges the edit by **Speaker View's** rule (the list above), not Apply EDL's, so a side-by-side moment from Camera Switch's hints is not an issue there.
- **Clicks land where the take drew them.** In the review, a click on a word seeks the Preview through the EDL the take itself drew (its `json` output, with the turns split and the layouts written). Only the newest take carries that EDL: an older take, or one made before the edit or a setting changed, plays the original instead. Behind Camera Switch, a take is mapped only when the run that made it re-ran Camera Switch too — **Render final** and **Update preview** always do; a take from a Run of Speaker View on its own plays the original.
- **Edited since this preview, Render final and Update preview.** While the take on show is a Preview, the node says **Edited since this preview** when the Edit Plan holds edits that the Preview on show was not cut from, and carries the **Render final** bar (with **Update preview** where `PREVIEW_STOP_RULE_ENABLED` is on), as described for [Apply EDL](./apply-edl.md#render-final). Until Speaker View has a price, that bar, the review's footer and the context menu's **Render final** / **Update preview** are disabled and say *"Not priced yet — runs are refused until its price is set."* — no price is shown.
- **Nothing changed since the last final** is not asked for Speaker View: a Render final always renders again.

## Credit Cost

**Not priced yet** — see the notice above. This page will give the formula, with worked examples, when the price is set.

## API

`POST /v1/speaker-view` with `{ edl, transcript?, quality?, targetAspect?, layout?, switch?: { type, durationMs? }, emphasis?: { style, durationMs? }, accentColor?, speakerRegions? }` — `edl` is one EDL (an object or its JSON string), `layout` one of `auto`, `single`, `side-by-side`, `stacked`, `grid`, `pip`, `switch.type` one of `cut`, `pan`, `zoom` or `xfade:<transition>`, `emphasis.style` a `+`-joined set of `scale`, `border`, `dim` (or `none`). A refusal above is a `400` (`invalid_edl`, `unsupported_setting` or `too_long`). Until its price is set the route answers `503 not_priced`. The finished job's `output_data` has `videoUrl`, `thumbnailUrl`, `json` (the EDL as drawn) and the stamps `quality`, `clipKey`, `planBasis` and `renderBasis`.

## Tips

- Run **Camera Switch** first on a multicam shoot: Speaker View never picks a camera, and refuses a multi-camera edit that names no speaker.
- Turn Camera Switch's **Layout hints** on and set Speaker View's layout to **Auto** to follow its side-by-side moments; Apply EDL refuses a hinted edit.
- Pick the aspect first — it decides which layouts are offered.
