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
