# Edit Plan

> Turn a timed transcript into an edit decision list (EDL) plan: tighten a recording, find short clips, or mark chapters.

**Cloud feature.** Edit Plan runs on Nodaro Cloud. On a self-hosted install, connect your instance to nodaro.ai (Integrations → nodaro.ai, or paste an API key) and the node relays to the cloud; without a connection the node saves on the canvas but cannot run.

## Overview

The Edit Plan node reads a **timed transcript** of a recording and produces an **edit decision list (EDL)** — a compact, JSON description of an edit that the [Apply EDL](./apply-edl.md) node renders into a finished cut. Edit Plan reads the transcript (and optional silence ranges), never the pixels, so it plans quickly and cheaply and hands the actual rendering to a downstream node.

It has three modes:

- **Tighten** — remove silence, filler words and false starts, and emit **one** EDL that is a cleaned-up version of the whole recording.
- **Clips** — find the strongest short, shareable moments and emit **one EDL per clip**. The node's output fans out, so each clip becomes its own downstream render (wire the output into an Apply EDL node and every clip renders in parallel).
- **Chapters** — mark chapter boundaries with titles and emit a `{ startMs, title }` list.

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
| EDL | json | The edit plan. **Tighten** → one EDL object; **Clips** → a list of EDLs that fans out one downstream render per clip; **Chapters** → a `{ version, chapters }` object. Wire it into Apply EDL to render. |

Once the node has a plan, it shows a badge: **Well-formed EDL**, or the number of issues. A Clips plan is checked clip by clip. Click the badge to see each issue and warning, in the validator's own words. The badge checks the plan's structure only. Apply EDL can still refuse a well-formed plan it cannot draw, for example one with a layout or one over 180 minutes; the Apply EDL node's own badge shows that before you run (see [The render check in the panel](./apply-edl.md#the-render-check-in-the-panel)). Warnings never make a plan fail the check: they flag values a newer version may accept, such as an unknown layout id.

The plan a workflow run makes (Run, Run from here) lands on the node like one from running the node alone, also when the run finished while the editor was closed. A Run from here that starts after Edit Plan leaves the plan the node holds untouched. See [Run results on the canvas](../../features/run-results.md).

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Mode | Select | tighten | `tighten` (clean up the whole recording), `clips` (find N short clips), or `chapters` (mark chapters). |
| Tier | Select | standard | Reasoning tier: `economy` (fastest, cheapest), `standard`, or `premium` (highest fidelity). Affects both quality and credit cost. |
| Instructions | Text | -- | Free-text steer for the plan (e.g. "keep the intro tight, drop the sponsor read"). |
| Style guide | Text | -- | Longer editorial guidance the plan should follow. |
| Clips: count | Number | -- | **Clips mode only.** How many clips to find (1–50). |
| Clips: target length (s) | Number | -- | **Clips mode only.** Target clip length in seconds (5–180). |
| Target aspect | Select | -- | Intended delivery aspect (`16:9`, `9:16`, `1:1`, `4:5`) — informs clip framing. |
| Platform | Text | -- | Intended platform hint (informs pacing and length). |
| Sources: role | Select (per source) | auto | `master audio`, `camera`, `wide`, `screen`. The plan follows the **master's clock**: the source marked *master audio*, otherwise the first source in the list. |
| Sources: offset (s) | Number (per source) | -- | Seconds this recording started **after** the master (negative = before). Leave empty to use Audio Sync's measurement when its Offsets are connected (otherwise 0). A value you type always wins over a measured one. The master's own offset must be 0. |
| `promptPrefix` / `promptSuffix` | text | -- | Optional pre/post text wrapped around the instructions at run time (settings panel → **Pre & post text**; hidden from app users; captured by presets). See [Prompt pre & post text](../../prompt-pre-post-text.md). |

## Credit Cost

Edit Plan is priced **per source-minute × tier**, plus a flat component for the extra per-clip work in Clips mode. The source duration is rounded up to a bucket (15 / 30 / 60 / 90 / 120 / 180 minutes) — the credit id carries that bucket.

- **Per source-minute (by tier):** economy `2`, standard `4`, premium `8` credits per minute.
- **Clips flat (by tier, added once in Clips mode only):** economy `10`, standard `20`, premium `40` credits.
- **Formula:** `credits = per_minute(tier) × bucket_minutes + (mode === "clips" ? clips_flat(tier) : 0)`

| Example | Bucket | Formula | Credits |
|---------|--------|---------|---------|
| Tighten · standard · 45-min episode | 60 min | `4 × 60` | 240 |
| Chapters · economy · 20-min episode | 30 min | `2 × 30` | 60 |
| Clips · premium · 90-min episode | 90 min | `8 × 90 + 40` | 760 |

The reserve is taken from the recording's own duration; on Nodaro Cloud the exact amount is settled against your account.

### What the estimate shows before you run

The cost on the node, the **Run** button and the run-confirm dialog is an **estimate**, bucketed on the length of the **master source** — the source with the *master audio* role, otherwise the first source in the node's order. It reads that source's own recorded length:

- **Uploaded audio or video, and generated video** carry their length, so the estimate lands on the real bucket.
- **A YouTube link extracted through [Reference Audio](../input/reference-audio.md)** records the extracted file's length at extraction, so it lands on the real bucket too.
- **A source with no recorded length** — a direct audio link, or a Reference Audio node extracted before lengths were recorded — estimates at the **largest bucket (180 minutes)**. Re-extracting a YouTube source records its length.

The estimate never borrows a length from the wired transcript: a transcript on the canvas is from the *previous* run, and after you swap in a longer episode it would under-quote the new one. When the length is unknown the estimate deliberately over-quotes instead — it is what the balance check before a run compares against, so a run is refused up front rather than failing partway after earlier nodes were charged. Whatever the estimate showed, what you are **charged is always checked against the recording's real duration**: the server measures the master itself before it reserves, and a run whose master cannot be measured is refused and refunded rather than charged on a guess.

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

`POST /v1/edit-plan` with `{ mode, planTier, transcript, sources: [{ id?, url, kind?, role?, speakers?, offsetMs? }], … }` — source ids up to 200 characters. Each source carries its own `offsetMs`: apply an Audio Sync result to the sources first. The [SDK](../../sdk-reference.md) (`client.edit.editPlan({ offsets })`), the [CLI](../../cli.md) (`nodaro edit plan --offsets`) and MCP (`plan_edit` with `offsets`) do that for you, with the checks above. The route itself refuses, before measuring or charging, a raw `offsets` field (`422 offsets_not_applied`) and an offset on the master or on the transcript's own source (`422 master_offset`).

## Common Use Cases

- Tighten a long podcast or interview recording into a clean cut before rendering.
- Auto-find shareable short clips from an episode and render each one in parallel.
- Generate chapter markers with titles for a long-form upload.

## Tips

- Wire a **Transcribe** node's `json` output into **Transcript**, and (for tighten) a **Silence Detect** node into **Silence**, then wire Edit Plan's **EDL** output into an **Apply EDL** node to render the result.
- In **Clips** mode, one Edit Plan node feeds many renders: the output fans out, so a single Apply EDL downstream renders every clip.
- Use **economy** tier for a fast first pass; switch to **premium** for the final plan.
