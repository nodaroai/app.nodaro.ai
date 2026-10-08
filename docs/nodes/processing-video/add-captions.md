# Add Captions

> Generate and overlay captions on video.

## Overview

The Add Captions node automatically generates captions from video audio (or takes word-timed captions, or one fixed `text`, that you supply) and overlays them on the video. Choose a static subtitle or one of five animated "kinetic" styles, with customizable position, font size, and color. The kinetic styles take a **look** — a one-field preset that bundles font, outline, casing and spoken-word colour into the TikTok/Reels read — and the same styling levers (font, weight, outline, casing, vertical position, a words-per-line cap, and `look` itself) apply to `subtitle` too. The kinetic styles also carry an **`animate`** switch that can freeze their per-word motion.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Style | Select | subtitle | Caption display style (see below) |
| Look | Select | outline (kinetic) / Plain (subtitle) | Every style. `outline` or `clean`; a `subtitle` also offers **Plain** (no preset) and starts there (see [Kinetic style look](#kinetic-style-look)) |
| Position | Select | bottom | Where captions appear |
| Font Size | Number | 32 | Text size in pixels (12-200) |
| Color | Color picker | #FFFFFF | Caption text color |
| Font | Select | from look | Every style. Overrides the look's font face |
| Font weight | Select | Auto (from look) | Every style. 100–900, in 100s; **Auto** follows the look's own weight |
| Uppercase | Switch | from look | Every style. Render the captions in UPPERCASE |
| Outline colour / Outline width | Color picker / Number | from look | Every style. The outline around the text; width 0–40 px — empty follows the look, `0` = no outline. A colour once picked shows an **Auto** button that hands it back to the look (a colour with no width draws nothing, yet would still count as a styling lever on a `subtitle`) |
| Vertical position | Slider | Auto (uses Position) | Every style. The caption block's **centre** as % of the frame height (0–100); once set it overrides Position, and **Auto** hands placement back to Position (see [Position Options](#position-options)) |
| Max words per line | Number | empty (fit the width) | Every style except `word-pop` (always one word, so the field is hidden there). Caps the words on one caption line or page, 1–20 (see [Max words per line](#max-words-per-line)) |
| Spoken-word colour | Color picker | from look | **Kinetic styles only.** Colour of the word being spoken |
| Animate | Switch | on | **Kinetic styles only.** Turn off to freeze the per-word motion (see [The `animate` lever](#the-animate-lever-kinetic-styles)) |

Look, Font, Font weight, Uppercase, Outline colour/width, Vertical position and Max words per line apply to **every** style, `subtitle` included (Max words per line is simply inert on `word-pop`); only **Spoken-word colour** and **Animate** are kinetic-only. Setting any of the every-style levers on a `subtitle` switches its render from the cheap FFmpeg path to Remotion, so that subtitle **bills at the kinetic price** (see [Kinetic style look](#kinetic-style-look)).

### Caption Styles

- **subtitle** — Standard subtitle appearance. Given `text`, it is one fixed block shown for the whole video, never transcribed over — the cheap FFmpeg burn when plain, the same block drawn by Remotion when it carries a styling lever. Given timed captions, a wired transcript, or no `text` at all (it then auto-transcribes), it shows one held phrase line at a time (Remotion)
- **word-highlight** — One line at a time, the spoken word highlighted (see [Line grouping](#line-grouping))
- **karaoke** — One line at a time, filled progressively word by word
- **tiktok-words** — TikTok/CapCut-style 1–4 word "pages" that pop in; a page never spans a sentence end or a pause
- **word-pop** — One word at a time, springing in; each word stays up until the next one starts
- **bouncy** — One line at a time, each word bounces as it's spoken

The five animated styles (everything except `subtitle`) are **kinetic** styles, rendered with Remotion.

<a id="line-grouping-word-highlight"></a>

### Line grouping

`word-highlight`, `karaoke` and `bouncy` — and a **timed** `subtitle` (one built from `captions[]`, a wired transcript or auto-transcription; a `text` subtitle is one fixed block instead) — show **one line at a time**: not one word at a time, and not the whole transcript as one block. (`karaoke` and `bouncy` used to draw every word of the clip as a single block; they now hold one line at a time under exactly the `word-highlight` rules.) The words are grouped into lines at render:

- A line takes as many words as fit **~85 % of the frame width** at the chosen `font_size` and the look's font face (so a wide, heavy, uppercase face gets fewer words per line than a narrow one — see [font_size is measured against the look's face](#kinetic-style-look)).
- On `word-highlight`, `karaoke` and `bouncy`, a single caption entry that is itself wider than that budget — a phrase-level `captions[]` entry — is split into consecutive lines that fit, its time span divided between them in proportion to their character length (it used to render as one line cut off at both frame edges). A `subtitle` block wraps inside itself instead and is never split this way, and an entry containing `\n` keeps the caller's own breaks.
- A line also **closes early** on a sentence-ending word (`.`, `!`, `?`, `…`) or on a pause of **0.5 s or more** between two words.
- With [`max_words_per_line`](#max-words-per-line) set, a line also closes once it holds that many words — a cap **on top of** the width budget, never instead of it.
- When a phrase is too long for one line it is split into **balanced** lines rather than filled greedily, so its last word is never stranded alone (`OK SO I BUILT` / `A WORLD IN` / `NODARO STUDIO.`, not `… IN NODARO` / `STUDIO.`). Words are never moved across a sentence end or a pause, and balancing never pushes a line past the width budget or the word cap.
- A line stays on screen for up to **1.5 s** after its last word, and the next line takes over the instant *it* starts — so the pauses *inside* a line and the ordinary pause *before* the next one are both bridged with no blank frame. A silence longer than 1.5 s (including at the end of the clip) clears the caption until the next line starts.
- Inside the visible line the **per-word effect moves word to word** — the highlight on `word-highlight`, the fill on `karaoke`, the bounce on `bouncy`: a word's `startMs`/`endMs` decide which word is active, **not** whether text is on screen. During a pause, the last word spoken stays active. A `subtitle` line has no per-word effect; it is simply held.

This is the CapCut read: the caption never blinks out between words, and a long sentence never overflows into a second wrapped line.

The two styles that don't draw lines follow the same phrasing and the same hold:

- **`word-pop`** — a word stays on screen **until the next word starts** (at most **1.5 s** past its own end) instead of blanking in the gap between two words. A longer silence clears it.
- **`tiktok-words`** — a page **never spans a sentence end or a pause of 0.5 s or more**, holds at most `max_words_per_line` words when that is set, and stays up **until the next page starts** (at most **1.5 s** past its last word).

> This is the *render-side* grouping and it always applies. It is separate from `wordLevel: false` on a wired [transcript](#transcript-input), which groups words into lines in the **caption list itself** before rendering.

### Max words per line

`max_words_per_line` (integer **1–20**, optional) caps how many **words** one caption **line** — or one `tiktok-words` **page** — may hold. It is applied **on top of** the rules above: a line still closes at ~85 % of the frame width, at a sentence end, and at a pause of 0.5 s or more; the cap only ever makes lines *shorter*. **1–2** gives the punchy CapCut read; leave it unset to fit as many words as the width allows.

The cap counts **whitespace-separated words, not caption entries**, so "no line holds more than N words" is true for **any** input:

- A line (or page) closes before adding another entry would push its word count past N.
- An entry that alone holds more than N words — a phrase-level `captions[]` entry, or a phrase from an engine without word timings (`whisper`) — is split into consecutive sub-phrases of at most N words, and the entry's time span is divided between them in proportion to their character length.
- Per-word input is untouched: every entry is already one word.
- The one exception is a plain-text `subtitle` (`text`): there the lever only sets the **line breaks** — the text is broken into lines of at most N words and stays **one static block** for the whole video. It does not become timed pages.

| Style | Effect of `max_words_per_line` |
|-------|--------------------------------|
| `word-highlight`, `karaoke`, `bouncy` | No line holds more than N words |
| `tiktok-words` | No page holds more than N words |
| `subtitle` | No phrase line holds more than N words — including phrase-level entries, which are split (above). On a `text` subtitle it sets the line breaks of the one static block instead. It is a **styling lever**: a `subtitle` carrying it renders via Remotion and **bills at the kinetic price** |
| `word-pop` | None — the style is always one word at a time |

On the kinetic styles the lever adds **no credits**. The same lever is `maxWordsPerLine` in the REST body and the [SDK](../../sdk-reference.md#addcaptionsinput), `max_words_per_line` in the MCP `add_captions` tool, and `--max-words-per-line <n>` in the [CLI](../../cli.md).

**Worked example.** With `style: "word-highlight"` and no cap, each line fills to the width budget — `OK SO I BUILT` / `A WORLD IN` / `NODARO STUDIO.` in the [Line grouping](#line-grouping) example above. Add the cap:

```json
{
  "video_url": "…",
  "style": "word-highlight",
  "max_words_per_line": 2
}
```

Now no line holds more than two words — `OK SO` / `I BUILT` / `A WORLD` / … — each held until the next one starts. A phrase with an odd word count leaves one single-word line at its end (`STUDIO.` here), and sentence ends and ≥0.5 s pauses still close a line early too. The same request with `style: "tiktok-words"` caps every page at two words instead.

### Kinetic style look

The kinetic styles carry a **look** — a named preset that bundles the visual levers so a caption reads well from one field:

| `look` | What it renders |
|--------|-----------------|
| `outline` (default) | Heavy geometric sans (Montserrat 900), UPPERCASE, white text on a thick black outline, yellow spoken word — the TikTok/CapCut read |
| `clean` | Inter, no outline or casing |

The **spoken-word colour** (`highlight_color`, yellow under `outline`) only shows on the styles that mark one word at a time — `tiktok-words`, `karaoke`, `word-highlight`. `subtitle` (a whole phrase) and `word-pop` (a single word on screen) have no separate "spoken" word to recolour, so the look's outline/font/casing apply but the caption stays one colour.

**On the kinetic styles an unset `look` renders as `outline`** — that is the default kinetic look; pass `look: "clean"` to turn the preset off and keep only your own explicit levers. **On `subtitle` an unset `look` renders as `clean`** — the plain read: a pinned neutral sans (Inter), no outline, no casing. The outline house-style is opt-in on a subtitle — pass `look: "outline"` for the whole preset, or add individual levers (`stroke_width`, `uppercase`, `font_family`, …) on top of the plain face.

**`font_size` is measured against the LOOK's face.** The same number renders wider or narrower depending on which face the look pins: the default `outline` look is **Montserrat 900 UPPERCASE**, roughly **30 % wider per character** than `clean` (Inter, mixed case). So the same `font_size` fits noticeably **fewer words per line** under `outline` — on `word-highlight`, where words are grouped to fit the frame, that shows up directly as shorter lines. Pass `look: "clean"` for the narrower face, pick a condensed face with `font_family` (`Bebas Neue`, `Anton`, `Oswald` are all narrower still), or lower `font_size`.

The explicit levers below **override individual fields of the chosen look** (they are added to it, not a replacement — e.g. with the default `outline`, setting only `highlight_color` keeps Montserrat / caps / outline and just recolours the spoken word). **Most of them — `font_family`, `font_weight`, `stroke_color`/`stroke_width`, `uppercase`, `position_y`, `max_words_per_line`, and `look` — also apply to the static `subtitle` style.** Only `highlight_color` and `animate` stay **kinetic-only** and are rejected (`400`) on `subtitle` — a subtitle has no per-word spoken cursor to recolour and no motion to switch off. On the kinetic styles the levers add **no credits**; on `subtitle`, adding any styling lever switches the render from the cheap FFmpeg path to Remotion, so a styled `subtitle` **bills at the kinetic price** (`color` and `background_color` alone don't — FFmpeg honours those):

| Lever | Applies to | Description |
|-------|-----------|-------------|
| `font_family` | all styles | A font face (e.g. `Montserrat`, `Anton`, `Bebas Neue`, `Oswald`, `Poppins`; `Rubik`/`Heebo`/`Cairo`/`Tajawal` cover Hebrew & Arabic). Hebrew and Arabic captions lay out right-to-left: the row direction follows the **majority** language of the whole caption list, so a Latin brand name at the start of a Hebrew clip does not flip its lines |
| `font_weight` | all styles | CSS numeric weight 100–900 (in 100s). The chosen face must ship that weight or it renders at the nearest loaded one |
| `stroke_color` + `stroke_width` | all styles | The black (or any colour) outline TikTok/Reels captions use; `stroke_width` in px |
| `highlight_color` | **kinetic only** — `tiktok-words` (also recolours the active word in `word-highlight` / `karaoke`) | Colour of the word being spoken |
| `uppercase` | all styles | Render captions in UPPERCASE |
| `position_y` | all styles | Vertical position of the caption block's **center** as % of height; overrides `position` (see [Position Options](#position-options)). ~65 sits below the face, above the app's own bottom UI |
| `max_words_per_line` | all styles (inert on `word-pop`) | Integer 1–20. Caps the words on one caption line / `tiktok-words` page, on top of the ~85 % width budget, sentence ends and ≥0.5 s pauses. 1–2 = the punchy CapCut read; unset = fit the width (see [Max words per line](#max-words-per-line)) |
| `animate` | **kinetic only** | Per-word **motion** switch, default `true`. `false` freezes the motion while keeping grouping, line-holding and the highlight colour (see [The `animate` lever](#the-animate-lever-kinetic-styles)) |

**Outline width.** When the `outline` look supplies the stroke, its width auto-sizes to the text: `max(2, round(fontSize × 0.1))` px, painted half outside the glyph (`paint-order: stroke fill`) so the visible rim is ~5% of the font size. At `font_size: 64` that is a 6 px stroke; at `font_size: 32` it is a 3 px stroke. Set `stroke_width` explicitly to override it (`stroke_width: 0` = no outline).

#### The `animate` lever (kinetic styles)

`animate` (default `true`) is the per-word **motion** switch for the kinetic styles. Setting `animate: false` freezes the movement while keeping everything else — the line grouping, the line-holding, and the spoken-word highlight **colour** all stay; only the motion stops:

| Style | What `animate: false` freezes |
|-------|-------------------------------|
| `word-highlight` | the active word's size hop |
| `karaoke` | the progressive sweep |
| `tiktok-words` | the page's spring-in |
| `word-pop` | the single word's spring-in (the word just appears, and is still held until the next one) |
| `bouncy` | each word's bounce as it's spoken |

The words still appear on cue and the active word is still recoloured — you get a still, styled caption whose text changes rather than animating. For a **fully static** line with no per-word colour change either, also set `highlight_color` to the same value as `color`. `animate` is **kinetic-only** — it is rejected (`400`) on `subtitle`, which has no motion to switch off.

> The canvas config panel exposes the whole lever set: Style, Look, Position, Font Size, Color, Font, Font weight, Uppercase, Outline colour and width, Vertical position and Max words per line on **every** style (`subtitle` included; Max words per line is hidden on `word-pop`, where it does nothing), plus Spoken-word colour and Animate on the kinetic styles. The same levers are available via the API, MCP, the [CLI](../../cli.md) and the [SDK](../../sdk-reference.md) (`client.media.addCaptions(...)`). Per-segment captions (`segments[]`) remain API / MCP / SDK / CLI only.

### Supplying your own captions (API / MCP)

Instead of `auto_transcribe`, you can pass a `captions[]` array. For the **kinetic** styles this is **word-timed: one entry per word** (a bare word is fine — words are auto-spaced, so `"face"`, `"doesn't"`, `"drift."` render as `face doesn't drift.`). Each entry:

| Field | Required | Meaning |
|-------|----------|---------|
| `text` | yes | The word (or, for `subtitle`, a line) |
| `startMs` / `endMs` | yes | The word's **spoken** window. It always drives highlight / animation timing; what it means for **visibility** depends on the style (below) |
| `timestampMs` | no (default null) | A word-timestamp slot kept for shape compatibility — **nothing in the render reads it**. Every style, `tiktok-words` included, times its words from `startMs`/`endMs` |
| `confidence` | no (default null) | Transcription confidence — metadata, ignored by rendering |

**What `startMs`/`endMs` control, per style:**

| Style | On screen when | The word's window decides |
|-------|----------------|---------------------------|
| `word-highlight`, `karaoke`, `bouncy` | Its **line** is on screen, from the line's first `startMs` until the next line starts — or, if that is more than 1.5 s away, until 1.5 s past the line's last `endMs`. See [Line grouping](#line-grouping) | Which word is **highlighted / filled / bouncing**, and where lines break |
| `subtitle` | Its **line** is on screen, grouped and held exactly as above, with no word marked. (A `text` subtitle — with or without styling levers — is one fixed block for the whole video instead) | Where lines break |
| `word-pop` | From the word's own `startMs` until the next word starts — or, if that is more than 1.5 s past its `endMs`, until 1.5 s past its `endMs` | When the word pops in |
| `tiktok-words` | Its **page** (1–4 combined words — never across a sentence end or a ≥0.5 s pause, and at most `max_words_per_line` words) is on screen until the next page starts — or, if that is more than 1.5 s away, until 1.5 s past the page's last word | Page boundaries and the spoken token |

### The auto-transcribe engine (`transcribe_provider`)

The node transcribes the video's audio itself unless something else already supplies the words: `captions[]`, a wired `transcript`, `text` on a `subtitle`, `auto_transcribe: false`, or — for a `segments[]` render — every segment carrying its own `text`/`captions`. When a call carries more than one source, the precedence is `captions[]` > wired `transcript` > `text` on `subtitle` > auto-transcription. `transcribe_provider` chooses the engine: `incredibly-fast-whisper` (the default), `elevenlabs-stt`, or `whisper`.

**What `text` does depends on the style.**

- **On `subtitle`** (top level, no `segments[]`) `text` **is** the caption. It is burned as-is as **one static block shown for the whole video** and is **never transcribed over**, whichever renderer draws it; `\n` is a forced line break. With no styling lever it is the FFmpeg burn. With any styling lever (`look`, `font_family`, `font_weight`, `stroke_color`, `stroke_width`, `uppercase`, `position_y`, `max_words_per_line`) it is the Remotion render at the kinetic price — the **same** static block, wrapped to the frame width. Omit `text` to caption the speech instead: a `subtitle` with no `text`, no `captions[]` and no transcript auto-transcribes.
- **On a kinetic style** `text` does **not** suppress transcription. It is the *fallback* source, used only when the transcription returns no words or `auto_transcribe` is `false`; it is then spread evenly across the video as synthetic word timings, not synced to the speech.
- **With `segments[]`** a top-level `text` is that same fallback: a segment with no `text`/`captions` of its own takes the shared source (`captions[]` > transcript > transcription), and `text` is used only when the transcription is empty.

`auto_transcribe: false` with no caption source at all is a `400`.

A **kinetic** style is word-timed, so the engine must be one that returns **word timestamps**. `whisper` cannot (see [Transcribe](../ai-text/transcribe.md#word-timestamps-which-engine-can-do-it)). Pairing it with a kinetic render therefore behaves in one of two ways:

- **With another caption source available** — `text`, `captions[]`, a wired `transcript`, `auto_transcribe: false`, or self-sourced segments — the request is accepted and the transcription is **skipped**: nothing is sent to the engine (so nothing is transcribed or billed for it) and the render uses that other source. With only `text`, that means evenly-spaced synthetic captions off the text, exactly as this node behaved before word timings existed.
- **With no other caption source at all**, transcription is the render's only possible source and an engine that cannot feed it makes the call impossible: it is **rejected up front with `400 validation_error` on `transcribe_provider`**, before any credits are reserved.

**`subtitle` + auto-transcribe works with any engine.** A subtitle draws whole phrase lines and never marks a single word, so it needs **phrase timing only** — `transcribe_provider: "whisper"` is fine on a `subtitle`: the phrase segments Whisper returns burn in as timed subtitle lines, grouped and held as described in [Line grouping](#line-grouping). Only the kinetic styles need a word-capable engine (`incredibly-fast-whisper` or `elevenlabs-stt`). An auto-transcribed `subtitle` renders via Remotion and bills at the kinetic price whichever engine transcribes it. A `text` subtitle never transcribes: with no styling lever it stays one fixed overlay on the cheap FFmpeg path, and with one it is the same fixed block drawn by Remotion at the kinetic price.

In a `segments[]` render the same rule is applied per segment: only a **kinetic** segment that falls back to the shared transcription needs word timings. A `subtitle` segment, and any segment carrying its own `text`/`captions`, puts no demand on the engine.

> This is about the node's **own** auto-transcription. A *wired* [transcript](#transcript-input) is different: it must carry words whatever the style, so a workflow that feeds this node a Whisper transcript is refused before it runs (one exception: a chain that crosses a sub-workflow boundary) — see [Transcribe](../ai-text/transcribe.md#a-whisper-transcript-wired-into-add-captions-is-refused-before-the-run).

### Transcript input

Instead of transcribing in-place, you can **wire an upstream Transcript into the node's `transcript` input** (the JSON handle) — the word-timed output of a [Transcribe](../ai-text/transcribe.md) node, the remapped transcript from an [Apply EDL](apply-edl.md) render or a [Speaker View](speaker-view.md) render (its `transcript` output), or the `json` output of a [Text to Dialogue](../ai-audio/text-to-dialogue.md) node on a model that returns timings (every dialogue model: per-word timings with each line's voice as the speaker, so the dialogue is captioned without transcribing it again). The node reshapes that transcript's words into the caption list and burns them in, so **captions stay aligned to a re-cut timeline**: an Apply EDL render remaps every word through the cut, and the captions follow (aligned to within ~80 ms across a crossfade boundary).

Only a Transcript can be wired here. An [Edit Plan](edit-plan.md) or [Camera Switch](camera-switch.md) `edl` output is an edit list, not a transcript, so the editor refuses the connection (with a message saying so) and an MCP, API or Copilot write that includes it drops the edge and reports why. Camera Switch's `transcript` output is a Transcript and connects, and so is Speaker View's `transcript` (its `json` is the EDL it drew and is refused). The reverse is refused too: a Transcript output (Transcribe's `json`, Text to Dialogue's `json`, Camera Switch's `transcript`, Apply EDL's `json`, Speaker View's `transcript`) cannot feed an `edl` input such as Apply EDL's or Camera Switch's.

A wired transcript is a **timed** caption source. It works with any style: on a **kinetic** style the words drive the per-word animation, and on `subtitle` a wired transcript now routes the render to Remotion and burns the words as **timed phrase lines** (so a timed `subtitle` bills at the kinetic price). A transcript that has no words is rejected up front, before any credits are reserved. The same check runs on the **workflow graph** before a run starts: a Transcribe node on the `whisper` engine (which returns phrase segments but no words) whose `json` output reaches this input — directly, or through Apply EDL or Speaker View — stops the run before anything executes or bills, with a message naming the node, so the transcription is never paid for a render that could only fail. That holds for a chain inside a sub-workflow too, at any depth; the one case the check cannot see is a chain that **crosses** a sub-workflow boundary (Transcribe on one side, Add Captions on the other), which is refused at this node after the transcription has run (see [Transcribe](../ai-text/transcribe.md#a-whisper-transcript-wired-into-add-captions-is-refused-before-the-run)).

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `transcript` | JSON (handle) | — | An upstream Transcript (`{ version, words[], segments? }`). Object or JSON string. |
| `wordLevel` | Boolean | `true` | `true` = one caption **per word** (karaoke / word-highlight). `false` = words **grouped into lines** (a line closes on a speaker change, a sentence-ending word, a silence gap, or a maximum word count). |

> `wordLevel` only matters when a transcript is wired and a kinetic style is selected. Word-level is the default because the per-word kinetic styles highlight one word at a time; turn it off for calmer, line-at-a-time captions. [`max_words_per_line`](#max-words-per-line) is a separate, render-side cap, and it counts **words** either way: with `wordLevel` off, a grouped line that holds more than N words is split into sub-phrases of at most N words.

### Per-segment captions (API / MCP)

Apply **different caption treatments to different time ranges of the same video in one call** — e.g. a large uppercase phrase at the top for the intro, then one word at a time at the bottom for the body — by passing `segments[]`. When `segments` is present the whole render goes through the animated engine (so any `style`, including `subtitle`, and any look lever is valid on a segment).

Each segment:

| Field | Required | Meaning |
|-------|----------|---------|
| `start_ms` / `end_ms` | yes | The time range the segment covers. Segments must **not overlap**. |
| `style`, `position`, `font_size`, `color`, `background_color`, `look`, `font_family`, `font_weight`, `stroke_color`, `stroke_width`, `highlight_color`, `uppercase`, `position_y`, `animate`, `max_words_per_line` | no | Style/look overrides; each **inherits the top-level value** when omitted (see the cascade note below) |
| `text` or `captions[]` | no | The segment's own words. If omitted, it uses the shared `captions[]`/`auto_transcribe` **filtered to its range**. `captions[]` timings are **absolute video-timeline ms** (not relative to the segment) — a word outside the segment's own range is not shown. A `subtitle` segment built from `text` or the shared transcript renders as **one phrase block** spanning its range (not one word at a time; use `\n` in `text` to force line breaks) — a `max_words_per_line` on a segment's own `text` only sets the line breaks of that block, as on a top-level `text` subtitle, and on a block built from the shared transcript it splits the block in proportion to character length across the range, not by the shared words' own timings; a subtitle segment given its own `captions[]` renders those entries verbatim, with their timings. |

**Captions across a segment boundary.** A word-level caption belongs to the segment that contains its **start**, so a word never appears under two treatments. A **phrase-level** caption (its text holds more than one word) that straddles a segment boundary is split **at the boundary**: each segment gets the same text with `startMs`/`endMs` clipped to its own window, so the phrase renders once per window, in that window's style, and never twice at the same instant. A clipped part shorter than **250 ms** is dropped — unless dropping it would lose the phrase entirely, in which case the longest part is kept.

**Look cascade (important).** `color`, `background_color`, `position`, `position_y`, `animate` and `max_words_per_line` are base fields — a segment inherits the top-level value for these when it doesn't set its own (so one top-level `max_words_per_line` caps every segment, and a segment can set its own to override it). One nuance: `position_y` overrides `position`, so a segment that sets its **own** `position` does **not** inherit the top-level `position_y` (an inherited value never beats a placement the segment asked for). The **look-specific** levers (`font_family`, `font_weight`, `stroke_color`/`stroke_width`, `highlight_color`, `uppercase`) behave differently: a segment **without** its own `look` inherits the top-level ones, but a segment that names its **own** `look` starts fresh from that preset and does **not** inherit the top-level look levers — so a top-level `highlight_color` will **not** carry onto a segment that sets `look`. Set that lever on the segment too if you want it there.

Example — the intro/body split (a large outlined phrase at the top, then one word at a time at the bottom). Both segments get the `outline` look; the intro renders as one phrase block because its style is `subtitle`:

```json
{
  "video_url": "…",
  "look": "outline",
  "segments": [
    { "start_ms": 0,    "end_ms": 3000,  "style": "subtitle", "position": "top",    "font_size": 96, "text": "Same face, every shot. No re-prompting." },
    { "start_ms": 3000, "end_ms": 20000, "style": "word-pop", "position": "bottom", "font_size": 48 }
  ]
}
```

Because a segment without its own `look` inherits the top-level one, setting `look: "outline"` once at the top applies Montserrat 900, caps and the black outline to **both** segments. (The yellow spoken-word colour doesn't show here — neither `subtitle` nor `word-pop` marks a single word; it would appear on `tiktok-words` / `karaoke` / `word-highlight`.)

Per-segment captions render through the animated engine, so they bill at the kinetic rate.

### Output frame rate

A caption render that goes through Remotion — every kinetic style, a styled / timed / auto-transcribed `subtitle`, and any `segments[]` render — **keeps the source video's frame rate**: the source rate is rounded to a whole number (23.976 → 24, 29.97 → 30, 59.94 → 60) and kept within **15–60 fps**. It used to render at a fixed 30 fps whatever the source, which re-timed every frame of a 24 or 60 fps clip. Three cases still render at the historical 30 fps: a source whose frame rate can't be read; a **variable-frame-rate** source (its average and nominal frame rates differ by more than 10 %); and a clip long enough that its duration × the source frame rate would exceed the render's frame cap (108,000 frames — at 60 fps, a clip longer than 30 minutes). The plain-text `subtitle` path (FFmpeg) has always kept the source frame rate.

### Position Options

`position` anchors the caption **block**, and a named slot anchors the edge nearest the frame edge — so a block that wraps to more than one line grows *inward* and never clips off-screen. This is the authoritative mapping, and it is **identical on both render paths** — the FFmpeg plain-text `subtitle` burn and the Remotion render (every kinetic style, any styled/timed `subtitle`, per-segment captions) — so a caption sits in the same place whichever engine draws it:

| Value | Where the block sits |
|-------|----------------------|
| `top` | The block's **top edge** at **12 %** of the frame height; extra lines grow **downward** |
| `bottom` (default) | The block's **bottom edge** **18 % above the bottom** — i.e. at **82 %** of the height, clear of the TikTok/Reels bottom UI; extra lines grow **upward** |
| `center` | The block is **centred** at **50 %** of the height |
| `position_y: N` | The block's **CENTRE** at **N %** of the height, overriding `position`. It is the centre, not an edge — `position_y: 85` puts the **centre** at 85 %, so the block's bottom hangs below that |

**Worked example.** On a 1920-tall frame, `position_y: 83.5` puts the block **centre** at ~1603 px (0.835 × 1920); a single line at the default `font_size` then has its bottom edge near ~1620 px — well below centre but still clear of the very bottom.

## Caption plan input

Add Captions has a **Caption plan** input for captions that are already timed: the opening line, where it ends, and the timed words of the rest of the video. When a plan is wired:

- The opening line is drawn with the **Hook Plate** look; the rest uses this node's own caption style. Apply a caption preset to the node to restyle the rest — the opening line stays Hook Plate.
- The plan replaces the node's own text, segments and wired transcript.
- It always uses the styled caption renderer, so it bills at the kinetic price (see [Kinetic style look](#kinetic-style-look)).
- **An empty plan passes the video through**: when the plan has nothing to caption, the node outputs its video unchanged, at no cost.

## Inputs & Outputs

**Inputs:** Video with audio (required); an optional Transcript (JSON) on the `transcript` handle
**Outputs:** `video-out` — video with burned-in captions
## Best Practices

- Use "subtitle" style for professional content
- Use "word-highlight" for social media content (increases engagement)
- Place captions at the bottom for landscape video, center for portrait/social
- Choose a font size appropriate for the output resolution (larger for 480p, standard for 1080p)

## Common Use Cases

- Add subtitles to talking head or narration videos
- Create engaging social media videos with word-by-word highlights
- Add accessibility captions to any video content
- Generate karaoke-style lyrics over music videos

## Tips

- Captions are auto-generated from the video's audio track — ensure audio is clear
- For more precise captions, use Transcribe first, edit the text, then use Forced Alignment
- White text with a dark video background is most readable; use colored text for light backgrounds
