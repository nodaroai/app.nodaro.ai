# Speaker View

> Render an edit with its speakers on screen — a layout, a switch at each speaker change and an emphasis on whoever is talking. The sound is the edit's own, passed through.

**Cloud feature.** Speaker View runs on Nodaro Cloud. On a self-hosted install, connect your instance to nodaro.ai (Integrations → nodaro.ai, or paste an API key) and the node relays to the cloud; without a connection the node saves on the canvas but cannot run. A self-host sends each camera to nodaro.ai, so a private camera file over the 500 MB re-host limit is refused up front, naming the file — use a public URL or a smaller file.

## Overview

[Apply EDL](./apply-edl.md) shows one camera full-frame per segment. Speaker View is the render for edits that need more: both hosts side by side, a vertical clip that follows whoever is speaking, a grid for a panel, a picture-in-picture, with a crop framed on each speaker. It reads the originals on the master clock, so the picture and the sound stay locked, and it hands back the **EDL as it drew it** on its `json` output and the wired **transcript remapped through that edit** on its `transcript` output, ready for captions.

It decides **how** the speakers are shown, never **who** is on screen: [Camera Switch](./camera-switch.md) chooses the camera for each cut, Speaker View lays them out. A typical chain: **Audio Sync** → **Transcribe** with speaker detection → **Edit Plan** → **Camera Switch** → **Speaker View**.

Instead of an edit it can also take a plain **Video**: the whole clip is cut at each speaker's turns, so a vertical clip that shows only whoever is talking needs no Edit Plan and no Camera Switch — see [A video instead of an edit](#a-video-instead-of-an-edit). Not available until Speaker Frames is priced.

With [Speaker Frames](./speaker-frames.md) wired into **Face tracks**, each speaker's crop follows their face instead of a fixed box — see [Face tracking](#face-tracking).

A **Preview** (**Quality** set to **Preview**) is a private 720p render to review before a final is made. In the editor the **Quality** select reads **Final — no review step** and **Preview first — review, then Render final**, the same two options as [Apply EDL](./apply-edl.md#configuration)'s. Where the preview stop rule is on (`PREVIEW_STOP_RULE_ENABLED`), a run stops at a Speaker View set to Preview exactly as it [stops at an Apply EDL Preview](./apply-edl.md#a-run-stops-at-a-preview): the nodes after it are skipped and not billed in that run. **Render final** is in the right-click menu of Speaker View and of the Edit Plan behind it (there is no Render final button on the node itself): it renders Speaker View at Final for that run only, then everything after it, and the node keeps its own **Quality**. See [Render final](./apply-edl.md#render-final).

## Inputs

| Handle | Type | Required | Description |
|--------|------|----------|-------------|
| EDL | json | **Yes**, unless a Video is wired | One edit on the recording's clock — Edit Plan's or Camera Switch's EDL. A clip set is refused here (it fans out one Speaker View run per clip on the canvas). Media resolves from each source's URL; there is no *Sources* input. |
| Video | video | **Yes**, unless an EDL is wired | A plain video, instead of an edit. Wire exactly one of **EDL** and **Video**; both together are refused. The **Transcript** input is then required. See [A video instead of an edit](#a-video-instead-of-an-edit). |
| Transcript | json | When the edit does not name its speakers (always, with a Video) | The word transcript with speaker labels. Speaker View splits the edit at each speaker's turn and uses the labels when no segment names a speaker. |
| Face tracks | json | No | [Speaker Frames](./speaker-frames.md)' **Face tracks** output — only that node connects here, and it is the only way tracks get in (there is no inline `tracks` field on the node). Each speaker's crop then follows their face; see [Face tracking](#face-tracking). |

When the node wired into **EDL** has not run yet, the panel says so and offers **Run up to here · ≈N**. It runs the nodes before Speaker View that have not run, asking first only when the estimate is above the usual run-confirm threshold, and does not run Speaker View itself. See [Run up to here](../../features/run-results.md#run-up-to-here).

## Outputs

| Handle | Type | Description |
|--------|------|-------------|
| Video | video | The rendered edit. |
| EDL | json | The edit as drawn: split at the speakers' turns, with its layouts, switches and emphasis written in. With face tracks, a slot that followed a face carries `follow` (the camera, the track it followed and the motion) and its `region` is the framing a render without tracks would use (Glide) or the tracked crop it used (Static). It is an **EDL, not a transcript** — it never feeds Add Captions' Transcript input. |
| Transcript | json | The transcript wired into **Transcript**, remapped through the edit as drawn — the same remap [Apply EDL](./apply-edl.md)'s Transcript output uses. Words in removed material are dropped, a word that straddles a cut is clipped to its kept part (a word running across a speaker switch keeps its full length whatever the Switch setting, since the recording carries on through it — only a jump in the recording, where a stretch was cut out between the two speakers, clips it), and the rest move to where the video plays them, crossfades included. Wire it into [Add Captions](./add-captions.md)' Transcript input to caption the render without transcribing it again. Empty when no transcript was wired: an Add Captions wired to it then works as if nothing were wired (it transcribes the video it receives, or refuses for want of a caption source when auto-transcribe is off). |

Each take keeps its own EDL and Transcript: picking an older take in the results restores the ones that take was rendered with.

## Settings

| Field | Control | Default | Description |
|-------|---------|---------|-------------|
| Aspect ratio | Tiles | the edit's own, else 16:9 (9:16 with a Video) | 16:9, 9:16, 1:1 or 4:5. Output size is fixed per aspect: a final is 1920×1080, 1080×1920, 1080×1080 or 1080×1350; a Preview has a 720-pixel short side. |
| Quality | Select | Final | Final, or Preview (a private 720p render to review). |
| Layout | Tiles | Auto (Single on one camera) | Auto, Single, Side by side, Stacked, Grid, Picture in picture. Each tile is drawn at the output's aspect. |
| Switch | Tiles | Cut (Pan on one camera of an edit; Cut with a Video) | What happens at a speaker change: Cut, Pan, Zoom, or a Crossfade chosen from a list of transitions. Cut, Pan and Zoom loop a small animation of what they do. |
| Switch duration | Slider | 600 ms | The tween length of a Pan or Zoom; 0–5000 ms in 50 ms steps. |
| Emphasis | Toggles | Scale | Scale, Border and Dim, alone or together; all off is *none*. |
| Emphasis ease | Slider | 300 ms | 0–5000 ms in 50 ms steps. |
| Border colour | Colour (under *Advanced*) | white | The colour of the Border emphasis, `#RRGGBB`. |
| Framing | **Edit framing…** (the region editor) | full frame | A crop of each camera per speaker, as fractions of the frame (`speakerRegions`). The panel says how many crops are set; see [Framing](#framing-the-region-editor). |
| Motion | Static / Glide (under *Face tracking*) | Glide once face tracks are wired | How a tracked crop moves: **Glide** follows the face, **Static** frames each segment once from it. Greyed — *"Glide follows face tracks — wire Speaker Frames."* — while nothing is wired into **Face tracks** (hover it or move the keyboard focus onto it and it says why); without tracks the node renders exactly as before. See [Face tracking](#face-tracking). |

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
- **Saving.** **Save framing** writes every box shown, as fractions with four decimals; a speaker shown full frame writes nothing. A box saved exactly as the editor drew it (the thirds a wide shot starts with) is marked as a default (`defaultRegionKeys`): it frames the speaker, but never names a face track — only a box you set does (see [Face tracking](#face-tracking)). A box with no mark that is exactly a default box for its camera — full height, at its speaker's default position, for any output shape — counts as a default too: framing saved before the mark existed, and boxes written through the API or MCP. Closing with unsaved changes asks first, and nothing is stored until you save. The boxes a wide shot starts with count as unsaved until you save them: a node whose framing was never saved renders every camera full frame, so closing the editor on a fresh node asks before discarding them. **Copy JSON** in the header copies what Save would write. Crops stored for a speaker this edit no longer shows are kept. On a phone the editor shows one camera (picked from a menu) and one box at a time.

### Face tracking

Wire [Speaker Frames](./speaker-frames.md)' **Face tracks** output into Speaker View's **Face tracks** input, or press **Add face tracking** in the panel: it adds a Speaker Frames node wired to the same edit and the same transcript Speaker View reads, and connects its tracks, as one undo step. Speaker Frames must read the **same transcript** as Speaker View (Camera Switch's renamed one), so its tracks carry the edit's speaker names.

- **What follows a face.** Each slot that shows a speaker on a camera follows that speaker's face track there. A crop you set on the slot itself in the EDL (`slots[].region`, or a single-slot `segment.region`) still wins; where the track has nothing (a gap of more than 2 seconds, a stretch the detector missed), the crop is placed from where that speaker's face is elsewhere in the same clip, else your **Edit framing…** crop (or the default thirds); a camera you unticked in Speaker Frames always uses your framing.
- **Motion.** **Glide** (set when tracks are first wired; a choice you made is never overwritten) moves the crop smoothly with the face and holds still while the face stays near the middle, at one crop size per run of a speaker on a camera. **Static** frames each segment once from the face and keeps that framing over the next segments while the face stays put. Either way the size never pumps.
- **Who a track is.** A track is named, in this order: by Speaker Frames; through the current speaker names (so renaming speakers in Camera Switch after Speaker Frames ran re-maps its tracks); by a correction on the Speaker Frames node (below), which follows a rename the same way; and, for a track still unnamed, by a box you drew in **Edit framing…** — when the middle of the face lies inside exactly one drawn box on that camera. A default box never names a track: one saved as the editor drew it (the thirds), or one exactly equal to the default thirds on that camera — the camera's shape is read from its face tracks, and the boxes on one camera are taken in the order they are saved (camera, then speaker), so an exact default written through the API or MCP counts too. An unnamed track is never used for a named speaker.
- **Correcting a track.** **Edit framing…** draws the faces Speaker Frames tracked over the camera, as dotted boxes labelled with the track and its speaker. Click a face's label on the frame, or use the list under it, to pick who it is — a speaker, **Nobody**, or **As detected** to drop a correction — and **Save framing** writes the corrections on the Speaker Frames node (`trackAssignments`), where everything that reads its tracks applies them. Each correction keeps the transcript's own speaker label beside the name you picked, so renaming that speaker in Camera Switch later moves the correction to the new name. Nothing re-runs.
- **Render final and Update preview read the saved tracks.** They re-run Camera Switch, never Speaker Frames: the Preview and the Final use the same tracks. A Speaker Frames that has no output yet (it failed, or you ran Speaker View on its own before it) is refused with *"Face tracks are wired, but Speaker Frames has no output yet — run Speaker Frames first, or remove the wire to render without face tracking."* — never rendered as if nothing were wired.
- **Coverage.** Tracks are judged by what they cover, never by whether the edit changed: re-running Camera Switch or tweaking the edit keeps them. The badge notes a speaker whose on-screen time on a camera is less than 60 % covered — *"Host" on "Wide": tracked 41 % — the rest uses the static framing* — and the render falls back to your framing there. The finished EDL's notes say how much of each speaker was tracked, auto-framed or statically framed.
- **The check can be stricter than the render for an edit with unnamed segments.** Speaker View splits a segment that names no speaker at the transcript's turns, and which cameras the render then follows can depend on that split. The badge, Run and a self-hosted install's route do not repeat the split: for such an edit (a transcript with speaker labels is wired) they count every camera a slot could follow as followed, so they can refuse face tracks that don't cover a camera nodaro.ai would not have followed, but never pass tracks it refuses. An edit that names a speaker on every segment (a Camera Switch edit) is checked exactly.
- **On a self-hosted install** the track file is sent to nodaro.ai with the render, byte for byte, as a camera file is, up to the 64 MiB a track file may be (other uploads stay at 50 MB); nothing is sent when no tracks are wired.

### A video instead of an edit

**Not available yet:** a Speaker View fed a video runs only once [Speaker Frames](./speaker-frames.md) is priced too. Until then the node's badge says *"Speaker View from a video is not available yet. Use an edit as the input instead."*, **Add Transcribe** is not offered, and a run with a video wired is refused before anything runs or is charged. A Speaker View fed an edit is not affected.

Wire a **Video** into **Video** and a diarized **Transcript** into **Transcript**, and Speaker View cuts the whole clip itself. The clip becomes a one-source, one-segment edit, and the plugin's turn split cuts it at each speaker's turns, exactly as it cuts any edit that names no speaker. The clip's own sound plays untouched.

- **The transcript is required.** Without speaker labels there are no turns to follow. When no transcript is wired the panel says so and offers **Add Transcribe**: one click inserts a [Transcribe](../ai-text/transcribe.md) node with speaker detection (ElevenLabs), wires the video into it and its transcript into **Transcript**, as one undo step. A transcript that names no speaker is refused with *"This transcript has no speaker labels. Turn on speaker detection in Transcribe."*
- **The length is measured once, on the server, in the background.** Before the run Speaker View asks the server how long the picture really runs — it downloads the file and reads the end of the picture track from its own packets, never the duration the container declares — and both the editor's run and the server's run cut the clip by that one number. The check works for a file of any size: the editor starts it, shows *"Checking the video before it runs…"* and waits for it, so a big file is never one long request (Stop ends the check). The same pass reads the picture's size and looks at a few frames for faces. A file whose end cannot be measured is refused, with a sentence, before anything is charged; the answer is cached for an hour, so a second run of the same video starts at once.
- **Defaults.** A Speaker View fed a video defaults to **9:16** and **Cut** wherever it was written — the canvas, an agent or a template — and a speaker's crop follows their face once [Speaker Frames](./speaker-frames.md) is wired (**Add face tracking** wires the same video into it). With one speaker label the clip lists no speaker on its source; with two or more, it lists them.
- **A video no wider than the target is refused, whatever produced it.** A source already at or narrower than the target aspect (within 1%) has no extra width to follow a speaker across, so it is refused before any charge: *"This video is 1080×1920, already as narrow as 9:16 or narrower …"*. A video that exists when the run starts (an Upload, a result saved on a node the run does not execute) is measured first, before any node runs. A video the run itself produces (Generate Video, Trim) is measured the moment it exists, and every paid node that feeds Speaker View — Transcribe included — waits for it and is not charged if the video is refused. Only a Speaker View the run executes is judged: a Run selected, Run from here or run-up-to-a-node that leaves it out is not refused on its account. The editor asks before it sends the run: a video that already exists is measured (the check is cached, so a second run is instant) and refused in the editor, and a Sub-workflow node run on the canvas orders and checks its inner nodes the same way. A video whose size the editor cannot read is judged by the measurement alone.
- **A low-resolution video still renders.** The output size is fixed per aspect, so a small source is enlarged: a 640×360 clip at 9:16 is cut at 202×360 and enlarged 5.3× to 1080×1920. The badge and the run warn above 2.5× (a 1080p or 1440p video stays quiet at 9:16; 720p and below warns), naming the numbers.
- **Refuse a clip with no face (`requireFaces`).** A Speaker View with `requireFaces` set (a template sets it; there is no control for it on the node, and it can be written through the API or MCP) refuses a video in which a few sampled frames, spread across the clip, show no face: *"No faces were found in this video, so there is nobody for Speaker View to follow …"*, before anything is charged. A clip whose faces appear only between the sampled frames can be refused, and a host that cannot look for faces never refuses. Without it a faceless clip renders and the note below says the centre of the frame is used.
- **No framing set.** With no face tracks wired and no box drawn for a speaker in **Edit framing…**, the renderer uses the centre of the frame for that speaker. The badge warns — *"No framing set for Alex, Sam: the centre of the frame is used."* — without blocking the run. A speaker whose face is not visible in a stretch gets their drawn box there, else the centre of the frame, and the finished EDL's notes say so.
- **What it cannot judge before the run.** The editor never downloads the video to judge it, so the 180-minute limit is checked at the run, from the measured length. The size warnings need the producer to have saved a size (an upload does).
- **No Edit Plan means no plan to review.** **Review cut** and the plan-based staleness checks have nothing to read; **Render final** renders Speaker View at Final and everything after it.
- **A run is refused up front** — nothing upstream runs or is charged — when an edit and a video are both wired, when no transcript is wired, or when the video is too narrow (or, with `requireFaces`, has no face). The refusal names the Speaker View by its name on the canvas, and it applies to a Speaker View inside a Sub-workflow node as well.

### What the Input section says

| You see | It means |
|---------|----------|
| *Wire an EDL …* | Nothing is wired into **EDL** (or **Video**) yet; only the rules the aspect alone decides apply. |
| *Input: a video. It is cut at each speaker's turns …* | A Video is wired in place of an edit. |
| *Speaker View needs a transcript with speaker detection …* + **Add Transcribe** | A Video is wired and no transcript is. |
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

- an edit and a video wired together, neither wired, a video with no transcript or with a transcript that names no speaker, a video whose end cannot be measured, and a video no wider than the target aspect;
- an edit that is not one master-clock EDL with a picture on every segment (a clip set, a rendered output's EDL, a source with no URL);
- an edit the shared EDL validator refuses;
- a framing crop too small to crop (each side must be at least 1% of the frame) or outside the frame;
- a layout, switch, emphasis or colour the renderer does not draw;
- an output over **180 minutes**;
- on **two or more cameras**, speakers it cannot read: no speaker on any segment while the transcript names two or more speakers or none (*"Wire Camera Switch between Edit Plan and Speaker View"*); a partly named edit with no transcript, or a transcript with no speaker labels. A transcript with exactly **one** speaker label passes, and a fully named edit is never refused for its transcript;
- a speaker no camera shows;
- face tracks that are not Speaker Frames' output (a box body pasted in, a list), that name a camera the edit does not have or are labelled in other speaker names than the edit's (*"wire Speaker Frames to the same transcript as Camera Switch"*), or that never sampled a camera a slot follows (*"Face tracks don't cover "Wide" — re-run Speaker Frames on this edit."*); a **Motion** other than Static or Glide;
- face tracks wired in while Speaker Frames has no output (*"Face tracks are wired, but Speaker Frames has no output yet — …"*);
- face tracks for a camera the render follows whose file or offset changed since Speaker Frames ran (*"Face tracks for "Wide" were made from a different file — re-run Speaker Frames on this edit."*), or tracks no Speaker Frames run of your account made. Only cameras a slot follows are checked — the same cameras the coverage refusal above reads: a camera the edit lists but never shows, or one shown only by slots with their own crop in the EDL, renders from its static framing and is not checked. This check reads the Speaker Frames job behind the tracks, so it is made by the editor's Run, by a workflow run and by the `POST /v1/speaker-view` route, on nodaro.ai and on a self-hosted install alike (a self-hosted install makes it against its own Speaker Frames run before relaying the render).

## Reviewing a cut

Speaker View is reviewed the way [Apply EDL](./apply-edl.md#reviewing-a-cut) is:

- **Review cut.** A Speaker View fed by an [Edit Plan](./edit-plan.md#reviewing-a-cut) Tighten cut — directly or through Camera Switch — carries a **Review cut** button (**Review clips** for a Clips plan) whatever it shows: a Preview, a Final, or nothing yet. The review judges the edit by **Speaker View's** rule (the list above), not Apply EDL's, so a side-by-side moment from Camera Switch's hints is not an issue there.
- **Clicks land where the take drew them.** In the review, a click on a word seeks the Preview through the EDL the take itself drew (its `json` output, with the turns split and the layouts written). Only the newest take carries that EDL: an older take, or one made before the edit or a setting changed, plays the original instead. Behind Camera Switch, a take is mapped only when the run that made it re-ran Camera Switch too — **Render final** and **Update preview** always do; a take from a Run of Speaker View on its own plays the original.
- **Edited since this preview, Render final and Update preview.** While the take on show is a Preview, the node says **Edited since this preview** when the Edit Plan holds edits that the Preview on show was not cut from, and carries the **Render final** bar (with **Update preview** where `PREVIEW_STOP_RULE_ENABLED` is on), as described for [Apply EDL](./apply-edl.md#render-final). Each button shows its price: the render at Final or at the preview rate, in the render's [tier](#credit-cost), with every node the run re-runs before it.
- **Nothing changed since the last final** is not asked for Speaker View: a Render final always renders again.

## Credit Cost

Priced **per minute of rendered output**, at the rate of the render's **Quality** and its **tier** — how many speakers it puts on screen at once:

| Tier | When | Preview (`proxy`) | Final |
|------|------|-------------------|-------|
| Standard | at most **two** pictures on screen on every segment — Single, Side by side, Stacked or Picture-in-picture with two speakers, a Grid of two, Camera Switch's two-up hints — and no zoom | 2 | 10 |
| Complex | **three to six** pictures on screen on any segment — a Grid of three or more, a three-up hint — or any **zoom**: the Zoom switch where one picture is re-framed (Single, Picture-in-picture, Auto's one-camera segments), or a zoom the edit carries itself | 3 | 12 |

- **Final:** `rate × ceil(output seconds ÷ 60)` — minimum 1 minute
- **Preview (`proxy`):** the same, at the preview rate

One tier for the whole render: a single segment with three speakers on screen puts the render in Complex. The tiles are counted on the edit as laid out — after the layout snaps for the aspect and the speaker count, and after a camera that has not begun yet is dropped from a segment — so a Grid of two speakers is Standard, Side by side, Stacked or Picture-in-picture over three or more speakers is drawn as a Grid and is Complex, and a Zoom switch under Side by side or Grid, which draws nothing, adds nothing. Pan, Cut, the crossfades and the emphasis do not change the tier.

| Edit | Tier | Minutes billed | Final | Preview (`proxy`) |
|------|------|----------------|-------|-------------------|
| 40 s, two speakers side by side | Standard | 1 | 10 | 2 |
| 12 min 00 s, two speakers side by side | Standard | 12 | 120 | 24 |
| 12 min 00.5 s, the same | Standard | 13 | 130 | 26 |
| 8 min 10 s, Single with the Zoom switch | Complex | 9 | 108 | 27 |
| 45 min 30 s, a Grid of three | Complex | 46 | 552 | 138 |

**Reserved on the edit, charged on the render.** The credits are reserved when the render starts, from the edit as wired in (its crossfades already subtracted). Speaker View then splits the edit at the speaker turns, and a crossfade switch (`xfade:…`) written where the recording jumps overlaps the two pictures, so the finished cut can be shorter. You are charged the **rendered cut's own minutes** at the same rate — never more than was reserved — and the rest is released: an edit of 20 min 00 s whose 19 crossfade switches of 4 s render 18 min 44 s, at Final in Standard, reserves 20 × 10 = 200 and is charged 19 × 10 = 190.

With [a video instead of an edit](#a-video-instead-of-an-edit), the edit is the whole clip, so the render is reserved and billed at the clip's measured length, rounded up to whole minutes: a 45 min 30 s upload under Single at Final is 46 × 10 = 460.

A Clip Pack renders each clip on its own, billed at that clip's length and tier, as [Apply EDL](./apply-edl.md#credit-cost) does. A preview and its final are two separate renders, each billed at its own rate.

The four rates are four price rows — `speaker-view` and `speaker-view:proxy` (Standard), `speaker-view:complex` and `speaker-view:complex:proxy` (Complex) — and nothing links them. An administrator who changes one in the admin panel's model prices (`/admin/models`) should change the others with it, keeping each preview below its final and Standard below Complex.

### What the estimate shows before you run

The cost on the node, the **Run** button, the run-confirm dialog and the **Render final** / **Update preview** buttons is an **estimate** at the rate of the node's **Quality** and tier, × the render's minutes, leaning high:

- **The tier** is the run's own when the edit wired in is known and says who speaks — the plan Camera Switch or Edit Plan holds now, or an EDL set on the node, whose segments name their speakers (or a transcript typed into the node names them). Otherwise the number of speakers is not known — the node that makes the edit runs again in this run or has nothing saved, or the edit names no speakers and its transcript arrives by wire — and the settings decide. Only **Single** without the Zoom switch is quoted at Standard then. Side by side, Stacked and Picture-in-picture are quoted at Complex, because with three or more speakers they are drawn as a Grid; so are Auto, Grid and any Zoom. A quote can therefore be higher than the run, never lower.
- **The minutes** follow the same rules as [Apply EDL's estimate](./apply-edl.md#what-the-estimate-shows-before-you-run), so a cut that is about to be re-planned is priced at the episode's length, and the reserve is the edit's length before the turns are split.
- **With a video instead of an edit** there is no edit before the run: the settings decide the tier, and the minutes are the clip's length, at most 180 — an upload's own length, a render's estimated length, or the length a Trim, Loop or Combine Videos passes on. A video whose length is not known before the run (a link, or a step that has not run yet) is quoted at the 180-minute ceiling, and a published app or template whose user replaces the recording lists it per minute of the recording.

## API

`POST /v1/speaker-view` with `{ edl | videoUrl, transcript?, quality?, targetAspect?, layout?, switch?: { type, durationMs? }, emphasis?: { style, durationMs? }, accentColor?, speakerRegions?, tracks?, motion? }` — send exactly one of `edl` (one EDL, an object or its JSON string) and `videoUrl` (a public http(s) link to a video). With `videoUrl` the `transcript` is required and must name its speakers; the server measures the clip once, builds the one-clip edit from it and renders that, so the route answers `400 invalid_input` (both or neither), `400 transcript_required`, `422 no_speakers`, `422 video_unreadable` (the length could not be measured), or `400 source_not_wider` before anything is created; `targetAspect` defaults to 9:16 with a `videoUrl`. **`videoUrl` is not available yet:** until Speaker Frames is priced it answers `503 video_mode_not_live` before anything is measured or created. `layout` one of `auto`, `single`, `side-by-side`, `stacked`, `grid`, `pip`, `switch.type` one of `cut`, `pan`, `zoom` or `xfade:<transition>`, `emphasis.style` a `+`-joined set of `scale`, `border`, `dim` (or `none`). `tracks` is [Speaker Frames](./speaker-frames.md)' output descriptor (`url`, `sha256`, `bytes` and the per-camera track summaries — never the boxes); its tracks' `speaker` and `attribution` are the labels the render uses, overriding the stored file's by track id, while everything else must match the stored file. `motion` is `static` or `glide` (default `glide`; ignored without `tracks`). A refusal above is a `400` (`invalid_edl`, `unsupported_setting`, `too_long` or `invalid_tracks`); the file-and-offset check is made by the editor's Run, by a workflow run and by this route, on nodaro.ai and on a self-hosted install alike. The render reserves and charges as in [Credit Cost](#credit-cost). The finished job's `output_data` has `videoUrl`, `thumbnailUrl`, `json` (the EDL as drawn), `transcript` (the wired transcript remapped through that EDL; absent when none was wired) and the stamps `quality`, `clipKey`, `planBasis` and `renderBasis`.

## Tips

- Run **Camera Switch** first on a multicam shoot: Speaker View never picks a camera, and refuses a multi-camera edit that names no speaker.
- Turn Camera Switch's **Layout hints** on and set Speaker View's layout to **Auto** to follow its side-by-side moments; Apply EDL refuses a hinted edit.
- **Back to Apply EDL.** The panel's **Back to Apply EDL** replaces this node with an [Apply EDL](./apply-edl.md#replace-with-speaker-view) in place, as one undo step — the reverse of Apply EDL's **Replace with Speaker View**, with the same confirm. The EDL and Transcript wires stay, the `transcript` output wire moves to Apply EDL's `json`, a `json` (EDL) output wire is dropped and listed, and the quality, a label you chose, an EDL or transcript typed into the node and the published app's items carry over. This node's Preview and Final history and its layout settings do not; Undo brings them back.
- Pick the aspect first — it decides which layouts are offered.
