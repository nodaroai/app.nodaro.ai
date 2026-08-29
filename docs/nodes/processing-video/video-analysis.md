# Video Analysis

> Break a video down scene-by-scene into a prompt-ready, AI-recreatable JSON breakdown — segmented shots, layered audio, and castable entity slots.

## Overview

**Availability.** Native on Nodaro Cloud. On a self-hosted install the node
appears with a **NODARO** mark and runs through your
[nodaro.ai connection](../../community-cloud-connect.md) — OAuth Connect or a
pasted API key — billed to the connected nodaro.ai account. Without a
connection the node card shows a **Connect nodaro.ai** CTA and a run refuses
with `503 nodaro_connection_required`.

The Video Analysis node ingests a video and returns a structured, scene-segmented
breakdown built for AI re-creation. It cuts the video at natural boundaries into
scenes of **at most 8 seconds** (one image/video generation maps to one scene),
and for each scene emits a self-contained visual description, shot type, camera
movement, its concurrent audio layers, and any transition out. Recurring
people, objects, and places are lifted out as reusable **entity slots** so a
scene can later be re-cast onto your own characters, objects, or locations.

- **Scene-segmented** — every scene is a single castable shot. A scene that
  genuinely can't be cut to 8 seconds or less is kept whole and flagged
  `oversized` (see [Output](#output)).
- **Windowed for long videos** — videos up to 180 seconds are analyzed in a
  single pass. Longer videos (up to the 10-minute cap) are analyzed in
  overlapping ~150-second windows (5s overlap) and merged into one continuous,
  renumbered result.

## Inputs & Outputs

**Inputs:** Video (optional handle) — a wired upstream video, or a YouTube URL
set in config.
**Outputs:** Analysis JSON (`meta` + `slots` + `scenes[]`) on the `json` output
handle, and the same analysis as a plain string on the `text` output handle —
wire `text` directly into any prompt/text input (for example Generate Video
Pro's prompt) to recreate the analyzed video without copy-pasting. The full
result is also stored in the job's `output_data`.

Each entity slot may also carry a `refImageUrl` — a hosted frame from the
analyzed footage where that entity is clearly visible, picked automatically.
[Generate Video Pro](../ai-video/generate-video-pro.md) uses these as identity
references when recreating the video (its **Auto-cast from analysis** option,
on by default), so recreations keep each person and object looking like the
original without you extracting or wiring a single frame.

### Source precedence

You provide the source one of two ways:

- **Wired video** — connect any video producer to the node's video input.
- **YouTube URL** — set `youtubeUrl` in the node config.

**Precedence, not exactly-one:** a wired video input **always wins**. A stale
`youtubeUrl` left in config alongside a wired video never rejects the run and is
ignored — the wired video is analyzed. YouTube URLs must be `youtube.com` /
`youtu.be` hosts; **live streams are rejected** (wait for the stream to end and
the VOD to become available). Any source is capped at **10 minutes (600s)**.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Analysis Quality (`llmModel`) | Select | `pro` | `smart` (highest accuracy — a hybrid pass that blends a native skeleton read with several donor analysis rolls, then always refines the merged result; pick this when the shot list will drive regeneration), `fast` (economy), `pro` (default), or `mixed` / `mixed-fast` (several economy passes combined for completeness). See [Credit Cost](#credit-cost) |
| Result Selection (`selectionMode`) | Select | `choose` | `choose` — the standard result. `combine` — an enhanced result with additional verification for maximum captured detail (slightly slower, recommended). **Does not apply to `smart`** — that tier always refines regardless of this setting |
| Cast variations (`variations`) | Checkbox | off | On — the analysis also detects per-entity appearance **looks** — a plain wardrobe change between scenes (a different outfit at the café, on the boat, at the wedding) counts exactly as much as a dream, flashback, disguise, transformation, or era look — and binds each look to the scenes where it is active (`slots[].variations` + `scenes[].slotVariations`). Off — the result keeps the pre-variations shape. Look extraction runs as its own dedicated pass after the main analysis, so turning it on does not reduce how many entities are extracted |
| Music video (`musicVideo`) | API / MCP only | off | On — the clip is declared a **music video**: the song IS the piece, so all sung lyrics are transcribed verbatim as per-scene `speech` layers (the instrumental bed stays its own `music` layer). Off — the default classification: soundtrack vocals nobody on screen performs are folded into the `music` layer's description, and `speech` carries only words uttered inside the story world. No canvas control yet — pass it in the request body (`musicVideo: true`) or the MCP tool's `music_video` flag |
| Translate speech (`translateSpeechToEnglish`) | Checkbox | off | On — spoken and sung words come back in English. See [Output language](#output-language) |
| Translate on-screen text (`translateOnScreenTextToEnglish`) | Checkbox | off | On — signs, captions, and titles come back in English. Independent of the speech checkbox |
| Analysis Focus (`analysisFocus`) | Text (≤2000 chars) | — | Steer what the model pays attention to, e.g. "focus on the product shots and on-screen text" |
| `promptPrefix` / `promptSuffix` | text | -- | Optional pre/post text wrapped around the prompt at run time (settings panel → **Pre & post text**; hidden from app users; captured by presets). See [Prompt pre & post text](../../prompt-pre-post-text.md). |

**Quality tiers, no model to pick.** You choose a *tier* — `fast` for an
economy analysis, `pro` for higher fidelity, or the `mixed` tiers for our most
advanced, most complete analysis — not a specific model. The underlying
analysis model is selected for you (Video Analysis requires native video *and*
audio understanding, which only a subset of models provide) and is intentionally
not surfaced, so a tier's backing model can improve over time without changing
your workflow.

**Result Selection.** `choose` returns the standard analysis. `combine` runs
additional verification to maximize captured detail — named places, on-screen
text, brands, concurrent audio — and is guaranteed to return at least the
standard result's quality. Use `combine` whenever completeness matters; `choose`
is the faster baseline.

**Not on `smart`.** The `smart` tier ignores `selectionMode` entirely — its
hybrid analysis plan (see [Credit Cost](#credit-cost)) always includes the
equivalent of the `combine` verification pass, so there is nothing extra to
opt into and the field has no effect when this tier is selected.

### Output language

**Both checkboxes are off by default — the analysis keeps the video's original
language.** Speech is quoted word-for-word as spoken, and on-screen text is
transcribed in its original script. That is what you want when you are recreating
the video as it is.

There are **two independent checkboxes**, because they change two different
things about a recreated video — what it *says* and what it *shows*:

| Checkbox | What it translates |
|---|---|
| **Speech** | The spoken and sung words (`content` on `speech` audio layers) |
| **On-screen text** | Signs, captions, and titles transcribed into `visual` |

Ticking them independently is a supported, deliberate use: **English narration
over a Chinese street whose signage stays Chinese** is speech-on, on-screen-off.
The reverse — original dialogue, translated signage — is equally valid.

With either box ticked, the shot descriptions (`visual` prose, `camera`, slot
`description`, `voice`, `label`, music/sfx) are written in English too.

Constant under every combination:

| | Behavior |
|---|---|
| Brand, product, person, and place names | **Never translated.** Transliterated if written in a non-Latin script |
| `language` | Always the language actually **spoken in the footage** — it describes the video, not the translation |
| `slotId`, `role`, `shotType` | Never translated — they are identifiers, not prose |

Two consequences worth knowing before you tick a box:

- **This changes the recreated video, not just what you read.** `visual` is the
  text-to-video generation prompt, so translating a sign means a regenerated shot
  renders that sign in English. That is usually the point — it is how you make an
  English version of a foreign-language video — but it is a real change to the
  output, not a display setting. It is also exactly why the two checkboxes are
  separate.
- **The original wording is not kept anywhere.** The translation replaces it. Re-run
  with the box unticked if you need the source-language transcript back.

**Analysis Focus steers attention, never format.** It biases what the model
attends to; it does **not** change the output JSON shape, the ≤8s scene
segmentation, or the field set. Leave it empty for a general-purpose breakdown.

## Output

The result validates against the shared `videoAnalysisResultSchema`
(`packages/shared/src/video-analysis.ts`) — the single source of truth for this
contract. Top-level keys: `meta`, `look` (optional), `slots`, and `scenes[]`.

### `meta`

| Field | Type | Description |
|-------|------|-------------|
| `durationSec` | number | Probed video duration in seconds. |
| `width` | integer | Frame width in pixels. |
| `height` | integer | Frame height in pixels. |
| `aspectRatio` | string | Snapped to a standard ratio (`16:9`, `9:16`, `1:1`, `4:3`, `3:4`, `21:9`) when within 3%, otherwise a reduced `w:h`. |
| `title` | string, optional | Source title when known (e.g. the YouTube video title). |
| `language` | string, optional | Dominant spoken language when detected. Always the language spoken in the footage — unaffected by either [translation checkbox](#output-language). |

### `look` — the clip-level photography

Optional. The properties that belong to the **whole piece** rather than any one
shot, stated once so every regenerated shot can share them. Before this existed
they were only ever prose inside each scene's `visual`, which meant a 40-scene
analysis re-decided the grade forty times with nothing keeping the answers
consistent — the same drift problem [entity slots](#slots--castable-entity-slots)
solve for people.

| Field | Type | Description |
|-------|------|-------------|
| `style` | string, optional | The rendering **medium** — *"live-action photoreal"*, *"2D anime"*, *"stop-motion claymation"*, *"3D render"*. Orthogonal to everything else here and the most consequential of them: two shots with identical grade, lens, lighting and framing look nothing alike when one is live action and the other an oil painting. |
| `grade` | string, optional | Colour grade / palette — *"muted teal-and-orange, crushed blacks"*. |
| `format` | string, optional | Camera or film **format and stock** — *"anamorphic digital"*, *"16mm film grain"*. |
| `lens` | string, optional | Lens character — *"wide-angle, shallow depth of field throughout"*. |
| `lighting` | string, optional | Overall lighting style — *"hard single-source daylight, deep shadow"*. |
| `genre` | string, optional | What kind of piece this is — *"cinematic trailer"*, *"talking-head vlog"*. |
| `influence` | string, optional | The visual influence the piece clearly evokes — *"shot like Deakins"*, *"Wes Anderson symmetry"*, *"80s Kodachrome editorial"*. Mirrors the **Photographer / Artist** picker. Omitted unless the style is genuinely recognisable: a confident misattribution drags an entire wrong aesthetic into every regenerated shot, so describing the look in `grade`/`lighting` beats guessing a name. |

Every field is independently optional, and the whole object is omitted when the
analyzer read nothing — it says nothing rather than guessing. A shot that
*deviates* from the clip look still describes that deviation in its own `visual`.

It is a sibling of `meta` rather than a member because `meta` is **measured** fact
(ffprobe dimensions, probed duration) while `look` is the model's reading of the
photography.

**Which axis is clip-level and which is per-scene** — the split matters, because a
property stated per scene drifts and a property stated once cannot follow the
footage:

| axis | scope | where |
|------|-------|-------|
| rendering medium | whole clip | `look.style` |
| colour grade | whole clip | `look.grade` |
| lens character | whole clip | `look.lens` |
| camera / film format | whole clip | `look.format` |
| visual influence | whole clip | `look.influence` |
| kind of piece | whole clip | `look.genre` |
| lighting | clip **default**, per-scene deviation | `look.lighting` + the scene's `visual` |
| setting / location | per scene | [entity slots](#slots--castable-entity-slots) |
| atmosphere, mood | per scene | the scene's `visual` |
| framing, viewpoint, movement | per scene | `shotType`, `angle`, `camera` |
| speed, effects, transition | per scene | `speed`, `effects`, `transitionOut` |

Lighting is the one that sits on both: a piece has an overall lighting style, and
individual scenes depart from it. The clip-level value is the default a recreation
applies; a scene that differs says so in its own `visual`.

### `slots[]` — castable entity slots

Recurring people / objects / places extracted once so they can be re-cast with
your own entities.

| Field | Type | Description |
|-------|------|-------------|
| `slotId` | string | Stable lowercase-hyphen id, referenced from a scene's `visual` as `{slot:<slotId>}`. |
| `label` | string | Human-readable name for the recurring entity. |
| `source` | enum | Entity family this slot casts from: `wired-character` / `wired-object` / `wired-location` / `wired-creature`. |
| `role` | string | The entity's role in the video (e.g. "narrator", "hero product"). |
| `description` | string | Self-contained visual description used to render the slot when no cast entity is bound. |
| `variations` | array, optional | The slot's non-default **looks** — see below. Present only on runs that opted into looks and only when at least one exists. |

#### Appearance looks (`variations`)

A slot's `description` is its **default look**. When the same subject
deliberately presents a materially different look in a different narrative
context — dream vs reality, flashback vs present, a disguise, a costume change,
an era jump — the analysis can separate each non-default look into a
`variations` entry instead of averaging them into one description:

| Field | Type | Description |
|-------|------|-------------|
| `variationId` | string | Look id (`dream`, `flashback`, `disguise`, `costume`, `transformation`, `era`, or `alt-N`). At most 4 per slot; never `default`. |
| `label` | string | Short human name for the look (e.g. "Dream self"). |
| `description` | string | A full standalone casting sheet for this look — it restates the subject's identity and replaces the slot `description` wherever the look is active. |
| `refImageUrl` | string, optional | A hosted frame from the footage showing this specific look, picked automatically (per-look auto-cast). |

Every scene where a slot wears a non-default look carries the binding in that
scene's `slotVariations` map (`{"<slotId>": "<variationId>"}`); an unbound scene
means the default look. Downstream, [Generate Video
Pro](../ai-video/generate-video-pro.md) keys identity continuity on
`(slot, look)` so each look stays visually consistent in its own scenes without
bleeding into the others. When more looks are detected than the per-slot cap
allows, the extras are folded into the default look and the fold is recorded on
the result's `variationFolds` so nothing disappears silently.

**Looks are found two ways, and both run.** One pass watches the footage for
wardrobe, hair and makeup changes. A second reads the finished analysis —
scene prose, dialogue and narration — for looks the footage alone does not
show: a time jump, a life stage, a flashback, an era. So a look can be
reported for a subject whose *appearance* never visibly changes in a single
shot, because the writing establishes a different context for it ("twenty
years later…"). The second pass only adds looks the first did not already
find; neither can rename a slot, alter a scene's text, or introduce an entity
the analysis does not have, and the per-slot cap applies to their combined
output. If either pass cannot run, the analysis still completes with whatever
the other found.

Looks are an **opt-in on the API request** (`variations: true`); the platform
node analyzes without them, and consuming apps that support per-look casting
(for example Recast) opt in on your behalf.

### `scenes[]`

| Field | Type | Description |
|-------|------|-------------|
| `sceneNumber` | integer | 1-based scene index across the whole video. |
| `startSec` | number | Scene start in seconds. |
| `endSec` | number | Scene end in seconds (`endSec > startSec`). |
| `label` | string | Short scene label. |
| `shotType` | string | e.g. "wide", "close-up", "over-the-shoulder". |
| `camera` | string | Camera movement (may be empty for a locked-off shot). |
| `visual` | string | Raw visual description carrying `{slot:<id>}` tokens for future casting — **not the field to render from**. |
| `visualResolved` | string | Self-contained, prompt-ready visual description — **the field downstream consumers read**. |
| `oversized` | boolean, optional | Present and `true` when the scene exceeds 8 seconds (couldn't be cut shorter). Still one generation per scene. |
| `transitionOut` | enum, optional | Visible edit **into the next shot**: `cut` · `fade` · `dissolve` · `wipe` · `whip`. Omitted when the cut carries no visible device. `dissolve` (cross-fade between images) is distinct from `fade` (through black or white) — they look nothing alike. |
| `audio` | array | Concurrent audio layers (empty array `[]` = silence) — see below. |
| `angle` | enum, optional | Camera **viewpoint** — where the camera sits relative to the subject. **Absent means eye-level.** See below. |
| `speed` | enum, optional | Time manipulation: `slow-motion` / `ramp-in` / `ramp-out` / `timelapse` / `freeze` / `reverse`. **Absent means normal speed** — there is no `normal` member, so there is exactly one way to say "nothing unusual". |
| `onScreenText` | string, optional | Text burned into this shot's picture — titles, captions, lower-thirds, subtitles — verbatim, in its original script. Absent when the frame carries none. Translated when [Translate on-screen text](#output-language) is on. |
| `effects` | enum[], optional | Effects on this shot's **picture**: `blur` · `pixelate` · `glitch` · `grain` · `vignette` · `flash` · `distortion` · `double-exposure`. An array, since a shot can be grainy *and* vignetted. Absent means a clean image. |
| `slotRefs` | string[] | Slot ids referenced by this scene, derived from its `visual` `{slot:x}` tokens. |
| `slotVariations` | map, optional | `slotId → variationId` for slots wearing a non-default [look](#appearance-looks-variations) in this scene; absent key ⇒ the default look. Present only on runs that opted into looks. |

**`audio`** — an **array of concurrent sound layers**. Real footage stacks sound
(a music bed under dialogue over ambient sfx), so a scene captures every
simultaneous layer as its own entry: a music bed under a character's line over a
water splash is three entries. An **empty array `[]` means genuine silence** —
there is no `silence` mode. Each layer:

| Field | Type | Description |
|-------|------|-------------|
| `mode` | enum | `speech` / `music` / `sfx`. |
| `content` | string | `speech`: the words, verbatim as spoken — or translated when [Translate speech](#output-language) is on; `music` / `sfx`: generation-ready description. |
| `voice` | string, optional | Voice-casting descriptor (`"male, warm, conversational"`) — `speech` layers only. Describes the *voice*, not who owns it. |
| `speakerSlot` | string, optional | `slotId` of the on-screen speaker — `speech` layers only. See below. |

**Soundtrack vocals are `music`, not `speech`.** `speech` is reserved for words
uttered *inside the story world* — spoken, shouted, or sung by a character or an
on-screen performer. A soundtrack song nobody on screen performs (score vocals, a
pop track over a montage) rides the `music` layer, with the vocal folded into its
description as a generation prompt (e.g. *"romantic acoustic pop, warm male vocal
singing 'you had me at hello'"*) — its lyrics are never spread scene-by-scene
across `speech` layers. A character's utterance **over** the song still gets its
own `speech` layer. For actual **music videos** — where the song IS the piece —
set the `musicVideo` flag (see [Configuration](#configuration)) to get every sung
lyric back verbatim as per-scene `speech` layers instead.

**`speakerSlot`** answers *who* is talking, where `voice` only says what the
voice sounds like. Most scenes have one speaker and the pairing is obvious, which
is exactly why the scenes with two speakers across one cut used to be ambiguous;
with this field a recreation can route each line to the right character.

It is **optional and best-effort** — expect it to be absent when the analyzer
cannot attribute a line confidently. Two cases where it is deliberately never
set:

- **The speaker is not on screen.** An unseen narrator or voice-over is never an
  entity slot (a slot is something you *see*), so there is nothing to point at.
  Its casting lives in `voice`.
- **The speaker is visible but not a slot** — a one-off passer-by with a single
  line carries no slot to reference.

When present it always names a slot in the same result's `slots` array;
attribution to an unknown slot, or on a `music` / `sfx` layer, is stripped before
the result is returned.

**Each line appears exactly once.** Reading the `speech` layers in scene order
reproduces the soundtrack with nothing said twice: when an utterance straddles a
cut it is split at the boundary (the first scene keeps the head, the next gets the
tail), and a line playing over a run of montage shots is attributed to the shot
where it begins rather than repeated on every shot it plays over.

**Three independent camera axes.** They used to overlap, which lost information:

| axis | field | vocabulary |
|------|-------|-----------|
| **size** — how much of the subject is in frame | `shotType` | `Wide`, `Medium`, `Medium Close-Up`, `Close-Up`, `Extreme Close-Up`, plus `Two-Shot` / `Insert` / `Aerial` |
| **viewpoint** — where the camera sits | `angle` | `eye-level` · `low` · `high` · `overhead` · `worms-eye` · `dutch` · `over-the-shoulder` · `pov` · `profile` · `from-behind` |
| **movement** — what the camera does | `camera` | free text: `"slow push-in"`, `"handheld drift"`, `"static tripod"` |

The relational viewpoints (`over-the-shoulder`, `pov`) used to be conventions
inside the **`shotType`** list, competing with the sizes for a single slot — so an
over-the-shoulder *medium* had to pick one and discard the other. They now live in
`angle`, which lets both be stated: `shotType: "Medium"` + `angle: "over-the-shoulder"`.

Likewise a true angle had nowhere to go and was improvised into the movement
field (`"camera": "low angle static"` shipped on a real job), which both hid the
angle from anything reading `camera` and polluted the movement vocabulary.

`from-behind` and `over-the-shoulder` also mean **the face is not visible**, which
is what [auto-cast](#auto-cast-reference-frames) needs to know before choosing a
frame as an identity reference.

**Read `visualResolved`, not `visual`.** `visual` retains `{slot:x}` tokens so
the scene can be re-cast onto your own characters / objects / locations later;
`visualResolved` is the token-expanded, self-contained version and is the field
every downstream consumer should render from today.

## Credit Cost

Video Analysis is **dynamically priced** by duration bucket and quality tier. The
bucket is the smallest of **60s / 180s / 360s / 600s** that fits the video's
probed duration; each tier has its own per-bucket price. The table below is
published as `VIDEO_ANALYSIS_BUCKET_CREDITS` in
`packages/shared/src/video-analysis-pricing.ts` (the credit prices users are
charged) — generated and drift-guarded internally, never hand-written.

| Tier | ≤60s | ≤180s | ≤360s | ≤600s |
|------|------|-------|-------|-------|
| `fast` (economy) | 180 | 185 | 514 | 846 |
| `pro` (default) | 215 | 231 | 636 | 1050 |
| `mixed` / `mixed-fast` | 268 | 289 | 724 | 1169 |
| `smart` (highest accuracy) | 410 | 500 | 1259 | 2064 |

The two mixed tiers are variants of the same advanced analysis and share one
price: `mixed` is tuned for maximum result quality; `mixed-fast` for the most
consistent output character run-to-run. Since 2026-08-04 both mixed tiers also
run the cross-scene **continuity review** (previously `smart`-only): a final
reasoning pass over the finished shot list that corrects internally impossible
claims and raises `continuity watch` warnings for suspected persistent-state
omissions (for example, an object handcuffed to a character that silently
disappears from later scenes). Every correction and watch flag is disclosed in
the result's `warnings`.

> These values are the internal pricing formula's current outputs.

> **Hybrid smart plan + measured judge/refine terms, 2026-08-03.** The `smart`
> tier is now a **hybrid plan**: one native skeleton pass blended with several
> economy-transport donor rolls, with the merged result always refined —
> `smart` ignores [`selectionMode`](#configuration) and always applies the
> equivalent of `combine`. Every multi-roll tier (`mixed` and `smart`) now
> carries its own explicit judge and refine terms instead of an implicit share
> of a single-pass budget, trued up from measurement. This is a full reprice —
> every tier and bucket rises, including the economy tiers, so the numbers
> above reflect real, sustainable per-run cost rather than an introductory
> rate.

> **Smart re-based, 2026-07-31.** The `smart` tier's video sampling was re-tuned
> after a measurement campaign found the same analysis quality — and more
> consistent casting — at a much lower sampling cost, so its prices dropped
> 27–47% per bucket at the time (superseded by the 2026-08-03 reprice above).
> The other tiers ticked up 3–6% from a re-measurement of fixed analysis
> overhead. Analyses also now always report a camera `angle` per scene.

> **Credit re-denomination, 2026-07-30.** A credit is now worth a tenth of what
> it was, so every number in this table is ~10× its old value — the price in
> real terms did not rise. It is not exactly 10× because the formula rounds up
> to a whole credit: with finer credits there is less to round away, so each
> bucket was re-derived from the formula rather than multiplied. That rounding
> is why the ≤60s `fast` bucket is 23 rather than 30.

> **Repriced 2026-07-28.** Video Analysis now runs on the model provider's own
> API rather than through a reseller, which is what lets it send real media to
> the model instead of a link. Those calls cost roughly 3.3–3.5× more per token,
> and the prices above are the same formula re-run against them — the margin on
> this node is unchanged.

Longer videos cost more because they are analyzed in more overlapping windows (a
video over 180s is split into ~150-second windows), and higher tiers cost more
per window.

Every tier also analyzes each window **several times independently** and keeps
(or merges) the best result — three passes on `fast` and `pro`, and six on the
mixed tiers (three of each model, so their readings can be compared and
combined). `smart` runs its own hybrid roll plan — a native skeleton pass plus
several economy-tier donor rolls — and always refines the merged result. That
repetition is the main reason a tier costs what it does, and it is why the
mixed and smart tiers sit well above a single-model tier.

**±3-second duration tolerance.** Credits are reserved up front from the bucket
that fits the probed (metadata) duration. After download, the worker re-probes
the true duration and re-checks the bucket with a **±3-second grace**
(`VIDEO_ANALYSIS_DURATION_TOLERANCE_SEC`) — `ffprobe` floats routinely run a
fraction of a second over a nominal length, and zero tolerance would wrongly
bump a genuine 1:00 / 3:00 / 6:00 / 10:00 video into the next (pricier) bucket.

**Missing-duration fallback.** If the duration can't be determined at submit
time, the ceiling bucket (≤600s) price is reserved. In practice the route probes
duration first and rejects un-probeable sources, so this fallback is only a
safety net.

## Limits

- **Maximum duration:** 600 seconds (10 minutes) for any source. Enforced
  strictly at submit time, then re-checked worker-side after download (±3s
  grace, as above).
- **YouTube hosts only:** `youtube.com` / `youtu.be`. Other URL hosts are
  rejected.
- **No live streams:** a YouTube live stream is rejected up front — analyze the
  VOD once the stream ends.
- **Windowing:** videos over 180 seconds are analyzed in overlapping ~150-second
  windows (5s overlap) and merged; ≤180s runs as a single pass.

## Best Practices

- The default `pro` tier suits most breakdowns — higher-fidelity scene and entity
  detail. Drop to the `fast` tier for a cheaper, quicker pass when you can trade
  some fidelity.
- Set **Analysis Focus** to bias the model toward what matters for your
  re-creation (product shots, on-screen text, a specific character) — but don't
  expect it to change the JSON shape.
- Render scenes from `visualResolved`. Only touch `visual` / `slotRefs` if you
  are building a casting layer that re-binds `{slot:x}` tokens to your own
  entities.

## Common Use Cases

- Reverse-engineer a reference video into a shot-by-shot recreation plan.
- Extract a reusable cast of entity slots from a video to re-shoot with your own
  characters, objects, and locations.
- Produce prompt-ready per-scene descriptions to feed image/video generation
  nodes.
- Pull each scene's layered audio (speech quotes plus music/sfx descriptions —
  every concurrent layer) for a matching soundtrack pass.

## See Also

- [AI Audit](./video-audit.md) — to have a finished analysis re-verified
  against the footage, wire it into AI Audit. It re-watches the clip, applies
  only video-verified corrections, and discloses every change (and every
  declined change) in a report. The corrected analysis comes back in this
  same shape, so anything already wired to this node's output accepts an
  audited one identically.
