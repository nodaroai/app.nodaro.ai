# Edit Plan

> Turn a timed transcript into an edit decision list (EDL) plan: tighten a recording, find short clips, mark chapters, or cut a short trailer.

**Cloud feature.** Edit Plan runs on Nodaro Cloud. On a self-hosted install, connect your instance to nodaro.ai (Integrations → nodaro.ai, or paste an API key) and the node relays to the cloud; without a connection the node saves on the canvas but cannot run.

## Overview

The Edit Plan node reads a **timed transcript** of a recording and produces an **edit decision list (EDL)** — a compact, JSON description of an edit that the [Apply EDL](./apply-edl.md) node renders into a finished cut. Edit Plan reads the transcript (and optional silence ranges), never the pixels, so it plans quickly and cheaply and hands the actual rendering to a downstream node.

It has four modes:

- **Tighten** — remove silence, filler words and false starts, and emit **one** EDL that is a cleaned-up version of the whole recording.
- **Clips** — find the strongest short, shareable moments and emit **one EDL per clip**. The node's output fans out, so each clip becomes its own downstream render (wire the output into an Apply EDL node and every clip renders in parallel).
- **Chapters** — mark chapter boundaries with titles and emit a `{ startMs, title }` list.
- **Trailer** — build **one** short teaser EDL from the recording's strongest moments, in timeline order, joined with crossfades. The **Target aspect** setting is written into the EDL as a framing hint for the formats that follow (Apply EDL itself does not read it).

### Trailer length

A trailer's length is **fixed at 20–40 seconds**. There is no length setting: the Clips **count** and **target length** do not apply to a trailer. When the recording has fewer than 20 seconds of strong moments, the trailer still ships, shorter than 20 seconds, with a note in the EDL's `meta.notes` saying so (for example *"Only 14 s of strong moments were found; the trailer is shorter than 20 s."*). When no usable moment is found at all, the run fails and is refunded.

The **Trailer + Formats** template in the template marketplace is a trailer chain, ready to fill: Episode Recording → Transcribe (with speaker detection) → Edit Plan in Trailer mode (standard tier) → Apply EDL → [Combine Videos](./combine-videos.md), which plays an optional intro-card video before the trailer with no frames trimmed off either clip (left empty, the trailer passes through unchanged and is not charged) → three [Social Media Format](./social-media-format.md) nodes, padded rather than cropped: a 9:16 story or reel, a 1:1 square post and a 4:5 portrait post. Make the intro card the same size as the recording, or Combine Videos letterboxes one of the two to fit the other.

### When Trailer is greyed out

Trailer needs a server that can plan it. The editor asks the server which modes it plans ([`GET /v1/edit-plan/capabilities`](../../api-integration.md#edit-plan-modes)) and, until the server lists `trailer`, shows the Trailer option greyed out with the reason: **needs a plugin update** on nodaro.ai, and on a self-hosted install connected to nodaro.ai **Available once nodaro.ai supports it** or, when the install can't reach nodaro.ai, **Couldn't reach nodaro.ai — try again later**. A node already saved in Trailer mode (imported, or written into the workflow by an agent or the API) keeps its mode and shows a notice with the reason: on nodaro.ai, that it needs a plugin update and cannot plan a trailer yet; on a connected self-hosted install, **Available once nodaro.ai supports it** or **Couldn't reach nodaro.ai — try again later**. Its run is refused before anything is charged, however it starts (the canvas Run, a workflow or app run, the REST API, or the MCP `plan_edit` tool), except on a self-hosted install connected to nodaro.ai that can't reach it, where the job is retried instead (see below). Every refusal carries the same message: *Trailer mode is not available on this server yet. Choose another mode, or try again after the next update. You were not charged.*

- **On nodaro.ai**, Trailer is refused until the server plans trailers. A workflow or app run that has already reserved credits has the reservation refunded. The MCP `plan_edit` tool also names the modes the server plans.
- **On a self-hosted install (Community, Business) connected to nodaro.ai**, Edit Plan runs on nodaro.ai and is charged to the connected nodaro.ai account, so the install offers the modes nodaro.ai plans: Trailer becomes available as soon as nodaro.ai plans trailers. The install asks nodaro.ai which modes it plans and reuses the answer for up to a minute. The editor asks the install again when you open an Edit Plan node's settings or come back to the browser tab, at most once a minute, so a change shows up without reloading the page. Trailer is refused there only when nodaro.ai answers that it does not plan trailers yet; nodaro.ai's own check refuses the run. When nodaro.ai can't be reached, the editor offers only Tighten, Clips and Chapters, but a run in Trailer mode is not refused: the outage is temporary, so the job is retried under the usual job retry policy, and fails with *could not reach nodaro.ai* only when nodaro.ai still can't be reached on the last attempt. Nothing is relayed to nodaro.ai until the install has asked it which modes it plans, so nothing is charged to the connected nodaro.ai account for a failed attempt.
- **On a self-hosted install that is not connected**, Edit Plan cannot run at all (see **Cloud feature** above), and the Trailer option stays greyed out.

### An unknown mode

A mode that is not one of the four above (for example a misspelt `"Clips"`, or a mode written by a newer tool) is refused in the same places and in the same words, naming the mode it got. It is never planned as Tighten.

Because the plan is just data, an agent or you can decide *what* the edit is; the render happens downstream.

## Inputs

| Handle | Type | Required | Description |
|--------|------|----------|-------------|
| Transcript | json | **Yes** | The timed, word-level transcript. Wire it from a Transcribe node's `json` output. |
| Silence | json | No | Silence ranges from a Silence Detect node — helps the tighten pass cut dead air precisely. |
| Offsets (Audio Sync) | json | No | Multicam: an [Audio Sync](../processing-audio/audio-sync.md) node's Offsets output. Each source's measured offset is applied before the plan runs — see [Multicam](#multicam-recordings-on-different-clocks). |
| Sources | video/audio | **Yes** | The media the edit draws from (1–6). Each connected source becomes an EDL source; set each one's role and offset in the config panel. |

## Outputs

| Handle | Type | Description |
|--------|------|-------------|
| EDL | json | The edit plan. **Tighten** and **Trailer** → one EDL object; **Clips** → a list of EDLs that fans out one downstream render per clip; **Chapters** → a `{ version, chapters }` object. Wire it into Apply EDL to render. |

Once the node has a plan, it shows a badge: **Well-formed EDL**, or the number of issues. A Clips plan is checked clip by clip. Click the badge to see each issue and warning, in the validator's own words. The badge checks the plan's structure only. Apply EDL can still refuse a well-formed plan it cannot draw, for example one with a layout or one over 180 minutes; the Apply EDL node's own badge shows that before you run (see [The render check in the panel](./apply-edl.md#the-render-check-in-the-panel)). Warnings never make a plan fail the check: they flag values a newer version may accept, such as an unknown layout id.

The plan a workflow run makes (Run, Run from here) lands on the node like one from running the node alone, also when the run finished while the editor was closed. A Run from here that starts after Edit Plan leaves the plan the node holds untouched. See [Run results on the canvas](../../features/run-results.md).

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Mode | Select | tighten | `tighten` (clean up the whole recording), `clips` (find N short clips), `chapters` (mark chapters), or `trailer` (one 20–40 s teaser; greyed out until the server can plan it — see [When Trailer is greyed out](#when-trailer-is-greyed-out)). |
| Tier | Select | standard | Reasoning tier: `economy` (fastest, cheapest), `standard`, or `premium` (highest fidelity). Affects both quality and credit cost. |
| Instructions | Text | -- | Free-text steer for the plan (e.g. "keep the intro tight, drop the sponsor read"). |
| Style guide | Text | -- | Longer editorial guidance the plan should follow. |
| Clips: count | Number | -- | **Clips mode only.** How many clips to find (1–50). Not used by Trailer. |
| Clips: target length (s) | Number | -- | **Clips mode only.** Target clip length in seconds (5–180). Not used by Trailer, whose length is fixed at 20–40 s. |
| Target aspect | Select | -- | **Clips and Trailer modes.** Intended delivery aspect (`16:9`, `9:16`, `1:1`, `4:5`) — informs framing, and is written into the EDL as a hint. |
| Platform | Text | -- | Intended platform hint (informs pacing and length). |
| Sources: role | Select (per source) | auto | `master audio`, `camera`, `wide`, `screen`. The plan follows the **master's clock**: the source marked *master audio*, otherwise the first source in the list. |
| Sources: offset (s) | Number (per source) | -- | Seconds this recording started **after** the master (negative = before). Leave empty to use Audio Sync's measurement when its Offsets are connected (otherwise 0). A value you type always wins over a measured one. The master's own offset must be 0. |
| `promptPrefix` / `promptSuffix` | text | -- | Optional pre/post text wrapped around the instructions at run time (settings panel → **Pre & post text**; hidden from app users; captured by presets). See [Prompt pre & post text](../../prompt-pre-post-text.md). |

## Credit Cost

Edit Plan is priced **per source-minute × tier**, plus a flat component for the extra scoring work in Clips and Trailer modes. The price is two rows per mode and tier: a **rate** per source minute and a **flat** part (`edit-plan:<mode>:<tier>:per-minute` and `edit-plan:<mode>:<tier>:flat`).

- **Per source-minute (by tier):** economy `2`, standard `4`, premium `8` credits per minute.
- **Flat (by tier, added once in Clips and Trailer modes):** economy `10`, standard `20`, premium `40` credits. Tighten and Chapters have no flat part. Trailer uses the same flat as Clips, so a Trailer plan costs the same as a Clips plan of the same recording and tier.
- **Formula:** `credits = flat(mode, tier) + per_minute(tier) × N`, where **N** is the number of minutes charged.

**How N is counted.** On a server whose Edit Plan charges **per started minute**, N is the recording's started minutes: `N = ceil(seconds / 60)`, from 1 to 180 (a 44-minute-12-second episode is 45 minutes). On a server that has not switched yet, N is the **step** the length rounds up to: 15, 30, 60, 90, 120 or 180 minutes. The credit id a run reserves carries N (`edit-plan:<mode>:<tier>:<N>m`). Per started minute is never more than the step, and equals it when the length is exactly a step. `GET /v1/edit-plan/capabilities` says which one the server uses (`perMinute`), and every estimate follows it.

| Example | Per started minute | Credits | At the step | Credits |
|---------|--------------------|---------|-------------|---------|
| Tighten · standard · 45-min episode | `4 × 45` | 180 | `4 × 60` | 240 |
| Chapters · economy · 20-min episode | `2 × 20` | 40 | `2 × 30` | 60 |
| Clips · premium · 90-min episode | `40 + 8 × 90` | 760 | `40 + 8 × 90` | 760 |
| Trailer · standard · 60-min episode | `20 + 4 × 60` | 260 | `20 + 4 × 60` | 260 |
| Trailer · economy · 25-min episode | `10 + 2 × 25` | 60 | `10 + 2 × 30` | 70 |

The price shown when neither the mode nor the length is known is the largest any run can cost, **1,480** (premium Clips or Trailer at 180 minutes).

The reserve is taken from the recording's own duration; on Nodaro Cloud the exact amount is settled against your account. When that duration cannot be measured at reserve time (the file cannot be reached) and the source node records none, the reserve falls back to the transcript's length, and then always uses the **step**, even on a server that charges per started minute: the transcript ends with the last word, so music or silence after it would put the started minutes under the file's real length and the run would be refused.

### What the estimate shows before you run

The cost on the node, the **Run** button and the run-confirm dialog is an **estimate** of N for the length of the **master source** — the source with the *master audio* role, otherwise the first source in the node's order. It reads that source's own recorded length:

- **Uploaded audio or video, and generated video** carry their length, so the estimate counts the real N.
- **A YouTube link extracted through [Reference Audio](../input/reference-audio.md)** records the extracted file's length at extraction, so it counts the real N too.
- **A source with no recorded length** — a direct audio link, or a Reference Audio node extracted before lengths were recorded — estimates at the **maximum, 180 minutes**. Re-extracting a YouTube source records its length.

The estimate never borrows a length from the wired transcript: a transcript on the canvas is from the *previous* run, and after you swap in a longer episode it would under-quote the new one. When the length is unknown the estimate deliberately over-quotes instead — it is what the balance check before a run compares against, so a run is refused up front rather than failing partway after earlier nodes were charged. Whatever the estimate showed, what you are **charged is always checked against the recording's real duration**: the server measures the master itself before it reserves, and a run whose master cannot be measured is refused and refunded rather than charged on a guess.

The listed price of a published template, app or component has no recording to read, so it lists Edit Plan **per minute of the recording**: the flat part of Clips and Trailer modes as a fixed figure, plus the tier's per-minute rate. A standard Trailer plan lists `20` plus `4` per minute; a standard Tighten plan lists `4` per minute. The listing shows its fixed parts and its per-minute parts as one figure each, for example **82 + 14/min**. On a server that charges per started minute, that is exactly what a run of a recording that long is charged (at the started minutes). On a server that still charges the step, a recording whose length falls between two steps costs more than the per-minute figure: a 45-minute episode is charged at the 60-minute step (standard Tighten: `4 × 60 = 240`, where `4 × 45` is `180`). When the workflow holds a recording whose length is known and that the app's user cannot replace, the listing counts Edit Plan at that recording's length (its started minutes, or its step). A recording exposed as an app input, and every upload in a template, is replaced by the user's own, so its saved length is not counted: the listing stays per minute.

## Multicam: recordings on different clocks

When a conversation is recorded on several devices — a mic recorder plus one or more cameras — each file starts at a different moment. Wire every recording into both an [Audio Sync](../processing-audio/audio-sync.md) node and Edit Plan's **Sources**, and Audio Sync's **Offsets** output into Edit Plan's **Offsets** input. Use the **same upstream nodes** in both: offsets are matched to sources by node.

Before the plan runs, each source's measured offset is written onto it, lined up to the **master's clock** (the *master audio* source, else the first source). Audio Sync's reference does not need to be the master: the offsets are re-based onto it. The plan is timed on the master's clock, so the cuts do not move. Apply EDL then reads each camera at the right moment.

Edit Plan **stops before charging**, rather than planning a cut that would be out of sync, when:

- a source was **not measured** by Audio Sync — wire it into Audio Sync, or set its offset by hand (`0` if it started with the master);
- a source's match is **weak** (confidence below 0.5, including a camera with no usable sound) — set its offset by hand;
- the **master** was not measured (or measured weakly) while another source uses a measured offset;
- the master has a hand-set offset other than 0;
- the **transcript was made from a recording that is off the master's clock** — transcribe the master, or mark that recording as master audio (the canvas traces a Transcribe node back to the recording it was fed, including through Extract Audio);
- the Offsets input is wired but Audio Sync produced no result.

A hand-set offset always wins, so it is the fix for any single source audio could not line up.

**Which camera each cut shows.** Each cut goes on the **first camera, in source order, that has picture for all of it**. A cut that no single camera covers is split where cameras start and stop. A gap of up to half a second right after a camera stops, which no other camera filmed, is held on that camera's last frame. A stretch that **no camera filmed** (a camera started after the mic, or stopped before it) is left out of the plan and listed in its dropped cuts with the reason `no-picture` — so Apply EDL never gets a cut it cannot render. In Clips mode, a clip at least half filmed keeps its filmed part; a clip filmed less than half is left out and the next-best filmed clip takes its place. Edit Plan measures each camera's length for this before planning, and stops before charging when no camera has picture anywhere in the recording (usually an offset in the wrong units or sign). To choose the camera by **who is speaking**, add a [Camera Switch](./camera-switch.md) node after Edit Plan.

**Sound.** Every cut keeps the sound of the plan's clock — the *master audio* source, or the first source — whichever camera it shows, so the soundtrack never switches mics at a camera change. (Past the end of the clock recording, should the plan run longer, a cut keeps its camera's own sound.) Chapters mode shows no picture, so cameras are not measured for it.

## Reviewing a cut

<a id="reviewing-a-cut"></a>A **Tighten** plan is a proposal. Review it before you render: read the transcript with every cut struck through, hear any cut, restore what the plan removed, cut what it kept, and render from the same screen. Your changes are saved on the Edit Plan and are what every render of that plan cuts.

Reviewing is for a Tighten plan or a Clips plan that feeds an [Apply EDL](./apply-edl.md) render; a Clips plan opens the clip review described under [Reviewing clips](#reviewing-clips). A plan that has not run, and a chapter list, have nothing to review yet.

### Four ways in

- **Review cut** on the render's node. It is there whatever the render shows: a Preview, a Final, or no render yet. (Render final and Update preview on the node still appear only under a Preview.)
- **Expand** on the Edit Plan. It opens the review at the render the plan feeds. When no render consumes the plan, Expand opens the plan's JSON as before; with the review open, the same JSON is under the **JSON** switch.
- **Review cut** (for a Clips plan, **Review clips**) in the right-click menu of the render and of the Edit Plan. A plan that feeds several renders lists one entry per render, by name.
- **A link.** The address carries `?review=` and the id of the render or the Edit Plan (a plan opens at the first render it feeds). Reloading the page, or sending the link to someone who can open the workflow, reopens the review. Closing it removes the parameter, and opening or closing replaces the history entry, so Back does not walk through reviews.

When one plan feeds several renders, the arrow in the header chooses which render you are reviewing (for example a video cut and an audio master). The edits are the plan's, so they apply to every render of it; the choice decides which render's take, price, rule and **Render final** you see.

### What the screen shows

- **Title and badges.** `Review cut · <plan> → <render>`, a **Preview** or **Final** badge for the take on show, and the render's own validity badge: the same check the [Apply EDL panel](./apply-edl.md#the-render-check-in-the-panel) runs, over the cut as you have edited it.
- **Player.** **Preview** plays the render's take. **Original** plays the source file around a cut, with a second and a half on either side, so you can hear what the plan removed. With no take yet (or a take that has expired), the player says so, and Original still works.
- **Transcript.** Every word, in speaker paragraphs, with the time of each paragraph. A cut word is struck through in the colour of its reason (silence, filler, false start, tangent, no picture, or a manual cut of yours). Pauses show as chips with their length. Long cuts collapse into one line you can open. Without a transcript on the Edit Plan's Transcript input, the review lists the cuts by time instead.
- **Cuts by reason.** One row per reason with its count and total time. Each row's box cuts or restores every span of that reason at once.
- **Map.** A strip over the whole source marking where the cuts fall; click or drag to move the transcript there.
- **Footer.** Undo and redo, `Cut length · source · removed` (the cut length shows with a leading "≤" while a default crossfade shortens it), **Update preview** and **Render final** with their prices.

### Cutting and restoring

- **Click a kept word** to move the player there. **Click a cut word** (or a pause chip) for the cut: its reason and length, **Hear it**, **Restore**, and **Restore all** for its reason.
- **Select words** (drag, or click and Shift-click) for **Play selection**, **Cut selection** and, when the selection touches cut words, **Restore selection**. Selections snap to whole words. **Delete** cuts the selection and **R** restores it.
- **A restore can be refused.** A span stays cut when putting it back would make a cut the render cannot make: for example the time has no picture, no camera filmed it, or the cut would run past the render's length limit. The popover says why, in the render's own words. A cut is never refused.
- **Undo and redo** (⌘/Ctrl+Z, Shift+⌘/Ctrl+Z, or the footer buttons) hold up to 200 steps per Edit Plan in this browser tab. Closing the review by accident costs nothing: reopen it and the history is still there. Reloading the page, or planning again, clears it.
- **Reset to plan** (the **...** menu) discards your edits. The same happens by itself when your cut is back to exactly the plan's: an unedited plan never shows as edited.

### Your edits stay on the Edit Plan

- The review writes your cut to the Edit Plan as you work, a moment after you stop. The Edit Plan node shows an **Edited** chip while your edits are applied, and what it hands downstream, the validity badge and the Apply EDL estimate describe the edited cut. The plan the planner made is kept, so **Reset to plan** and the **JSON** switch's **As planned** view are always there.
- A render cuts the edited plan whether it runs in the editor or on the server. Your edits are written before **Render final**, **Update preview**, closing the review, or leaving the page.
- Edits belong to the plan they were made on. If the Edit Plan plans again, the review says "Your edits were made on an earlier plan and no longer apply" and offers **Discard them**. A run that would plan again asks first, and says how many spans you restored and dropped (see [Apply EDL](./apply-edl.md)).
- **Edits lock** while a run that includes the render or the Edit Plan is in progress ("Rendering final... edits locked"), and on a workflow you can only view (a read-only one). Playing, finding and listening to the original still work.

### A preview that is behind your edits

A Preview records which plan and which render settings it was cut from. When you have changed the cut since, the review says "This preview was made before your latest changes. Until you update it, clicking a word plays from the original.", and the render's node shows **Edited since this preview**. Click **Update preview** to render the edited cut. A Preview made before previews carried that record is treated the same way once the plan holds an edit. Behind a Camera Switch, a click on a word always plays from the original: the take's own timeline is the switched cut, which the review cannot map back to the plan.

### Rendering from the review

**Render final** and **Update preview** in the footer run exactly what the node's buttons run, with the same checks (Apply EDL's rule, a newer run, nothing changed since the last final) and the same confirm; see [Render final](./apply-edl.md#render-final) and [Update preview](./apply-edl.md#update-preview). **Update preview** exists only where the [stop rule](./apply-edl.md#a-run-stops-at-a-preview) is on; with it off the review has **Render final** alone. The review opens on a render with no Preview too. The footer holds both buttons, and says why, when:

- **Nothing is kept.**
- **Fix n issues first**: the render's rule refuses the cut as it stands. The issues are listed under **Issues**, in the validator's own words.
- **Load the newer run first**: a run finished that this canvas does not show. The check waits at most 15 seconds, then lets the run go with a warning.

### Keys

| Key | Does |
|-----|------|
| Space | Play or pause the player |
| Delete | Cut the selection |
| R | Restore the selection |
| ⌘/Ctrl+Z, Shift+⌘/Ctrl+Z | Undo, redo |
| ⌘/Ctrl+F | Find in the transcript |
| ⌘/Ctrl+C | Copy the selected words |
| Escape | Close the innermost layer first: a cut's popover, the selection bar, find, an open collapsed cut, then the review |

## Reviewing clips

<a id="reviewing-clips"></a>A **Clips** plan is a proposal too. Review it before you render: see one card per clip, drop the ones you do not want, rewrite a hook, and render the clips you kept from the same screen. A clip set opens the same way a cut does (see [Four ways in](#four-ways-in)), but the node's button and the menu entry read **Review clips**, and the screen is a grid of clips instead of a transcript.

### What the screen shows

- **Title and summary.** `Review clips · <plan> → <render>`, the render's own validity badge (the check the [Apply EDL panel](./apply-edl.md#the-render-check-in-the-panel) runs, over every clip a run would send) and the count: `8 clips · 6 kept · 6:41`.
- **One card per clip the render receives.** Each card shows a **Preview** or **Final** badge (or **Dropped**), the clip's number, its length, its title, where it sits in the source, its hook, a **Keep** switch and a line saying where the clip stands: no preview yet, rendering, failed, final. Press the picture to play the clip; one clip plays at a time. An audio render shows an audio tile instead of a picture; press its play button and the player appears, again one at a time.
- **Which clips get a card.** The clips the wire between the Edit Plan and the render sends it. A selector on that wire (a range, a list, one item) sends fewer than the plan holds; a muted line counts the rest ("2 clips not sent to this render by its wire's selection"), so a Keep switch is never shown for a clip the render would not read.
- **Show.** **All**, **Kept** and **Dropped**, each with its count. **Keep all** and **Drop all** in the header set every clip the render receives.
- **JSON.** The header's **Clips | JSON** switch shows the clip set as you have edited it and as the planner made it.

### Keeping and dropping

**Keep** off drops a clip: its card dims, its hook turns read-only, and **Render final** leaves it out (and does not bill it). Turn it on to keep it again. The change is saved on the Edit Plan at once. A dropped clip that already has a final keeps the final's card: "Final (not in this set)".

### Hooks are text only

Edit a clip's hook in its card. **Edited · Reset** appears under it and shows the planner's hook; **Reset** gives that hook back, and emptying the box stores an empty hook. The title cannot be edited.

A hook is text only: editing one does not re-render the clip, and it does not make the clip's final count as changed. The hook travels with the clip as `meta.hook`, for the nodes that read it (Extract Field, publishing). **Render final does not re-run those nodes** unless they come after the render: a node that reads the Edit Plan directly picks the hook up the next time it runs.

### The takes on each card

Each card shows the clip's latest take, matched to the clip by what it was made from, so a re-plan or a drop never puts one clip's video on another clip's card. A Preview made before a re-plan that changed the clip's cut says **Preview predates this plan**. A Preview that failed says **Preview failed. It still renders at Render final.** A clip that was not in the last preview run says **No preview yet**. Finals of clips the plan no longer has are listed under **From earlier plans**, collapsed.

### Rendering from the review

The footer names what **Render final** runs: "Render final: Render Clip ×6 → Caption Clip ×6." It renders the clips you kept, and only those. A second Render final re-renders and re-bills **every kept clip**, changed or not; the footer says how many have not changed ("4 of 6 unchanged; all 6 re-render and are billed again"), and the button shows the price: `Render final · 6 clips · ≈420`. The run uses the same checks and the same confirm as the node's button (Apply EDL's rule, a newer run, nothing changed since the last final; see [Render final](./apply-edl.md#render-final)). The footer holds the button, and says why, when:

- **Nothing is kept.**
- **Fix n issues first**: the render's rule refuses a clip as it stands. The issues are listed in the validator's own words.
- **Load the newer run first**: a run finished that this canvas does not show.

A hook you typed a moment ago is written before the run, so the run reads it. **Close** and Escape write it too. The review has no **Update preview**; use the node's button or the context menu.

While a run that includes the render or the Edit Plan is in progress, edits lock ("Rendering final... clip 3 of 6 · edits locked"), and on a workflow you can only view. Playing clips still works.

### Your edits stay on the Edit Plan

The review writes your Keep and hook choices to the Edit Plan, and a render cuts the edited clip set whether it runs in the editor or on the server. The Edit Plan shows an **Edited** chip while they apply. A review that keeps every clip and rewrites no hook is no edit: it clears itself, so an unedited plan never shows as edited. Edits belong to the plan they were made on: if the Edit Plan plans again, the review says "Your edits were made on an earlier plan and no longer apply" and offers **Discard them**, and a run that would plan again asks first and says how many clips you dropped and how many hooks you edited (see [Apply EDL](./apply-edl.md)).

## API

`GET /v1/edit-plan/capabilities` lists the modes this server plans, who answered, and whether Edit Plan is charged per started minute (`{ modes: [...], source, perMinute }`; see [Trailer greyed out](#when-trailer-is-greyed-out) and [Edit Plan modes](../../api-integration.md#edit-plan-modes)).

`POST /v1/edit-plan` with `{ mode, planTier, transcript, sources: [{ id?, url, kind?, role?, speakers?, offsetMs? }], … }` — source ids up to 200 characters. Each source carries its own `offsetMs`: apply an Audio Sync result to the sources first. The [SDK](../../sdk-reference.md) (`client.edit.editPlan({ offsets })`), the [CLI](../../cli.md) (`nodaro edit plan --offsets`) and MCP (`plan_edit` with `offsets`) do that for you, with the checks above. The route itself refuses, before measuring or charging, a raw `offsets` field (`422 offsets_not_applied`) and an offset on the master or on the transcript's own source (`422 master_offset`).

## Common Use Cases

- Tighten a long podcast or interview recording into a clean cut before rendering.
- Auto-find shareable short clips from an episode and render each one in parallel.
- Generate chapter markers with titles for a long-form upload.
- Cut a short teaser trailer of an episode for social media.

## Tips

- Wire a **Transcribe** node's `json` output into **Transcript**, and (for tighten) a **Silence Detect** node into **Silence**, then wire Edit Plan's **EDL** output into an **Apply EDL** node to render the result.
- In **Clips** mode, one Edit Plan node feeds many renders: the output fans out, so a single Apply EDL downstream renders every clip.
- Use **economy** tier for a fast first pass; switch to **premium** for the final plan.
