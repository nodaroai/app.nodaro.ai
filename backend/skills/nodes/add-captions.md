---
node_type: add-captions
generated_at: 2026-10-06T06:58:00.834Z
generated_from: 4c2a25d1c
---

# Add Captions

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `add-captions`
**Category:** processing
**Credit cost:** `30-50` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `in`, `transcript`, `captionPlan`
**Outputs (source handles):** `video`

**Required data fields:**
- `label: string`
- `style: CaptionStyle`
- `position: "bottom" | "top" | "center"`
- `fontSize: number`
- `color: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `currentJobProgress?: number`
- `passThroughWarning?: PassThroughWarning`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedVideoUrl?: string`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`
- `autoTranscribe?: boolean`
- `transcribeProvider?: "whisper" | "incredibly-fast-whisper" | "elevenlabs-stt"`
- `wordLevel?: boolean`
- `look?: CaptionLookId`
- `fontWeight?: number`
- `fontFamily?: SupportedFontName`
- `strokeColor?: string`
- `strokeWidth?: number`
- `highlightColor?: string`
- `animate?: boolean`
- `uppercase?: boolean`
- `positionY?: number`
- `maxWordsPerLine?: number`

**Default data:**
```json
{
  "label": "Add Captions",
  "style": "subtitle",
  "position": "bottom",
  "fontSize": 32,
  "color": "#ffffff",
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

Burn captions into a video (`add_captions` over MCP). `style` picks one of two render paths:

- **Static** — `subtitle`, the DEFAULT when `style` is omitted. Give it `text` and that text IS the caption: burned as-is as ONE static block for the whole video, never transcribed over. Plain, that is the cheap FFmpeg drawtext burn — no timing, no look. Add any styling lever and the SAME static block is drawn by Remotion instead (wrapped to the frame width, with the look applied — `clean` unless you name one) and bills at the kinetic rate. Give it a TIMED source instead — `captions[]`, a wired transcript, or no `text` at all (it then auto-transcribes the speech) — and it renders timed phrase lines through Remotion, also at the kinetic rate.
- **Kinetic** — `word-highlight`, `tiktok-words`, `karaoke`, `bouncy`, `word-pop`: word-timed, rendered by Remotion. You get one only by passing `style`. Any call carrying `segments[]` is a kinetic (Remotion) render too, whatever its styles.

MCP arguments are snake_case (`font_size`, `position_y`, `auto_transcribe`). The SDK spells every field camelCase (`fontSize`, `positionY`, `autoTranscribe`). REST is camelCase too EXCEPT two fields that stay snake_case on the wire: `auto_transcribe` and `transcribe_provider` (a camelCase `autoTranscribe` sent to REST is silently dropped). One carve-out: a caption entry is `{ text, startMs, endMs }` — camelCase on EVERY surface, also inside `segments[]` — while a segment's own range is `start_ms` / `end_ms` over MCP.

### Picking a kinetic style — each has its own visibility model

All five show ONE thing at a time and HOLD it until the next one starts (at most 1.5 s into silence), so the frame never goes blank mid-sentence. What differs is the unit and the motion:

- **`word-highlight`** — the safe choice for a talking clip of any length. One balanced LINE; the highlight moves word to word.
- **`karaoke`** — the same lines, but each word WIPES from the rest colour to the spoken colour across its own window.
- **`bouncy`** — the same lines again, with each word springing as it is spoken.
- **`tiktok-words`** — short PAGES instead of fitted lines: a run ends at a sentence end, a pause, or `max_words_per_line`. The spoken word is recoloured whenever the look has a highlight colour (the default look does).
- **`word-pop`** — exactly one WORD, at 1.4x `font_size`, springing in as it starts. `max_words_per_line` is inert here.

### The look in one field

`look` presets the typography. UNSET = `outline` on a kinetic style: Montserrat 900, UPPERCASE, white on a black outline auto-sized to the font, yellow (`#FFE600`) spoken word — the TikTok / CapCut read with nothing else to set. On `subtitle` an unset `look` is `clean` (Inter, no outline, the caller's casing): pass `look: "outline"` to opt a subtitle into the preset, or add individual levers on top of the plain face. A plain-text `subtitle` with no lever at all is the FFmpeg burn and has no look. `look: "clean"` opts out (Inter, no outline, no casing). A named look and explicit levers always win. `font_family`, `font_weight` (100–900 in 100s), `stroke_color`, `stroke_width`, `highlight_color` and `uppercase` each override ONE field of the chosen look and leave the rest: with the default kinetic look, `highlight_color` alone keeps the caps and outline and only recolours the spoken word. `stroke_width: 0` removes the outline.

`highlight_color` recolours the word being spoken — token by token for `tiktok-words`, the cursor word for `word-highlight` / `karaoke`. It and `animate` are the only two levers that need a kinetic style; everything else here (`look`, `font_family`, `font_weight`, `stroke_*`, `uppercase`, `position_y`, `max_words_per_line`) ALSO styles `subtitle`, which then renders through Remotion instead of FFmpeg and bills at the kinetic rate.

`animate: false` makes a kinetic style STAND STILL: the grouping and the spoken-word highlight stay, the per-word motion goes. Set `highlight_color` to the same value as `color` as well and the line is completely still.

### How many words are on screen at once

`max_words_per_line` (1–20) caps the WORDS a caption LINE — or a `tiktok-words` page — may hold. It is a CEILING on top of the rules that already close a line (the frame-width budget, a sentence end, a pause), never a floor: a line that the width budget closes at three words stays at three under `max_words_per_line: 6`. `1`–`2` is the punchy one-or-two-words-at-a-time CapCut read; leave it unset to fill the width.

The cap counts whitespace-separated words, not caption entries, so "no line holds more than N words" is true for ANY input. A line (or page) closes before another entry would push its word count past N. An entry that alone holds more than N words — a phrase-level `captions[]` entry, or a phrase from an engine without word timings — is split into consecutive sub-phrases of at most N words, and the entry's time span is divided between them in proportion to their character length. Per-word input is untouched: every entry is one word already.

It applies wherever words are grouped — `word-highlight`, `karaoke`, `bouncy`, `tiktok-words`, and a `subtitle` that routes to Remotion — and is inert on `word-pop`, which shows exactly one word by design. The one exception to the splitting rule is the static `subtitle` `text` block: there the lever only sets the line breaks — the text is broken into lines of at most N words and stays ONE static block for the whole video; it does not become timed pages. A segment inherits the top-level value unless it sets its own.

### Where the words come from — choose by how much the on-screen text matters

When a call carries more than one, the precedence is fixed: `captions[]` > a wired Transcript > `text` on `subtitle` > auto-transcription.

1. **`captions[]` — you own the text.** One entry per WORD. Use it whenever the text MUST be right: brand and product names, scripted ads, anything a client signs off. Supplying it means this node runs no speech-to-text of its own. Take the timings from `transcribe` and correct the words (recipe below).
2. **Auto-transcribe** (`auto_transcribe`, on by default whenever the call names no other source — a kinetic render with no `captions[]`, or a `subtitle` with no `text`) — one call, but the text is whatever the engine heard. Fine for casual speech, wrong for names. The engine is `incredibly-fast-whisper` unless `transcribe_provider` names another. `auto_transcribe: false` with no source at all is a 400.
3. **`text`** — what it is depends on the style. On a top-level `subtitle` (no `segments[]`) it IS the caption: burned as-is as ONE static block shown for the whole video, never transcribed over — with or without styling levers, whichever renderer draws it; `\n` forces a line break. Omit `text` to caption the speech instead. On a kinetic style it is only a FALLBACK: it is used when transcription returns nothing or `auto_transcribe` is `false`, and its words are then spread evenly across the clip as synthetic timings, not synced to the speech. With `segments[]` a top-level `text` is a fallback too: a segment with no words of its own takes the shared source (`captions[]` > transcript > transcription) and falls to `text` only when the transcription is empty.
4. **A wired Transcript** — canvas / REST only: the `transcript` input handle (REST field `transcript`, plus `wordLevel`), fed from the `json` output of a `transcribe` or `apply-edl` node. Valid on `subtitle` too (it then renders as timed phrase lines through Remotion, and it outranks `text`). The MCP tool has no such argument — pass `captions[]`.

### Recipe — TikTok-style captions from my own script

1. `transcribe` the clip — pass the video's URL (`outputUrl` from `get_job`) as `audio_url` — and wait for the job.
2. Read `words` from its output (`json.words` is the same list) — already `{ text, startMs, endMs }` per word.
3. Correct only the misheard `text` values against your script. Keep every `startMs` / `endMs`, and keep the single leading space each word after the first carries.
4. Burn them in — leaving `look` unset already gives the outline look:

```json
{
  "video_asset_id": "<video job id>", "style": "word-highlight", "font_size": 72, "position_y": 65,
  "max_words_per_line": 2,
  "auto_transcribe": false,
  "captions": [
    { "text": "Nodaro", "startMs": 120, "endMs": 560 },
    { "text": " makes", "startMs": 560, "endMs": 840 }
  ]
}
```

### Recipe — a big intro phrase, then a word-by-word body (`segments[]`)

```jsonc
{
  "video_asset_id": "<video job id>", "style": "word-highlight", "font_size": 64,
  "captions": [ /* every word of the clip, as above */ ],
  "segments": [
    { "start_ms": 0, "end_ms": 2500, "style": "karaoke", "position": "top", "font_size": 96, "text": "STOP SCROLLING" },
    { "start_ms": 2500, "end_ms": 24000 }   // the clip's own length in ms — never past it
  ]
}
```

The intro carries its own words. The body names none, so it takes the shared `captions[]` (or the auto-transcript) filtered to its range, and inherits the top-level style, size and look.

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `add_captions`

**Input parameters:**
- `text`
- `captions`
- `auto_transcribe`
- `transcribe_provider`
- `video_url`
- `video_asset_id`
- `style`
- `position`
- `font_size`
- `color`
- `background_color`
- `look`
- `font_family`
- `font_weight`
- `stroke_color`
- `stroke_width`
- `highlight_color`
- `uppercase`
- `position_y`
- `animate`
- `max_words_per_line`
- `segments`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- **Only `highlight_color` and `animate` are refused on `subtitle`.** They need a spoken-word cursor and per-word motion, which a static block has neither of, so on `style: "subtitle"` with no `segments[]` either one is a 400 `validation_error` — never a silent no-op. Every OTHER lever is accepted there and changes the render: a `subtitle` carrying `look`, `font_family`, `font_weight`, `stroke_color`, `stroke_width`, `uppercase`, `position_y` or `max_words_per_line` leaves the FFmpeg drawtext path for Remotion, and bills at the kinetic rate for doing so — its `text`, if it has one, is still the same static block, and its unset `look` is `clean`, not `outline`. `color` / `background_color` work on every style and change nothing about the path. With `segments[]` the whole render is Remotion anyway, so any style takes any lever.
- **A caption entry carries two optional fields beyond the word and its window, and the render reads neither.** `timestampMs` is the word timestamp slot of the caption shape: it is accepted and stored, but nothing in the render reads it — every style, `tiktok-words` included, times its tokens from `startMs` / `endMs`, so a carefully computed `timestampMs` changes nothing. `confidence` is metadata the renderer ignores as well. Both default to `null` — omit them.
- **`font_weight` is a request, not a guarantee.** The face has to ship that weight; when it does not, the line renders at the nearest weight that is loaded, with no warning. `Montserrat` covers 100–900; a one-weight display face gives you the same look at every number.
- **`font_size` is measured against the look's face.** It is px in the source video's own frame (default 32 — small on a 1080-wide vertical clip). `word-highlight` fits a line to ~85 % of the frame width, and `outline` (wide, heavy, caps) spends ~30 % more width per character than `clean`: at 1080 px wide and `font_size: 72` a line holds ~17 characters under `outline`, ~22 under `clean`, ~24 under `outline` + `font_family: "Bebas Neue"`. To fit more words per line: `look: "clean"`, a condensed face (`Bebas Neue`, `Anton`, `Oswald`), or a smaller `font_size`.
- **An over-wide caption entry is split, not clipped.** On `word-highlight`, `karaoke` and `bouncy` a single `captions[]` entry wider than the line budget (a phrase rather than a word) is cut into consecutive lines that fit, its time span divided by character length — per-word entries remain the better input, because they carry real timings. `subtitle` wraps its block instead, and an entry containing `\n` keeps your breaks.
- **`word-highlight` is line-based.** A line closes on a sentence end (`.` `!` `?` `…`), a pause ≥ 0.5 s, the width budget, or `max_words_per_line` — whichever comes first; a phrase split for width is re-balanced so no word is widowed. The line stays up until the next line starts, at most 1.5 s into silence. A word's `startMs` / `endMs` is its SPOKEN window: it times the highlight (which rests on the last-spoken word through a pause), not whether text is on screen — do not stretch `endMs` to "fill the gaps".
- **Right-to-left.** Hebrew and Arabic captions lay out RTL on every style. The row direction is the MAJORITY language of the whole caption list, not its first token, so a Hebrew clip that opens with a Latin brand name still reads right-to-left; a Latin token inside a Hebrew line (or the reverse) keeps its own direction and its space. `Rubik` / `Heebo` / `Cairo` / `Tajawal` cover the scripts.
- **Word delimiter and order.** Every word after the first carries ONE leading space — exactly what `transcribe` returns, so keep it when you correct a word. A bare word is accepted too: every kinetic style canonicalises the delimiter before rendering, `tiktok-words` included (it used to page ON that space, so bare words collapsed into one page holding the whole clip). Entries are read in TIME order by every style — an out-of-order array is sorted on a copy, and an entry whose text is blank is dropped rather than rendered as a phantom word.
- **Position (kinetic).** `top` = the block's TOP edge 12 % down, growing downward; `bottom` = the block's BOTTOM edge at 82 % of the height (clear of the TikTok / Reels UI), growing upward; `center` = 50 %. `position_y` (0–100) is the block's CENTRE and overrides `position`: ~65 sits below a face and above the app UI, while 100 centres the text ON the bottom edge, half off-screen.
- **`segments[]` cascade.** A segment with no `look` inherits the top-level look AND every top-level lever. A segment that names its OWN `look` starts fresh from that preset — the top-level `font_family` / `font_weight` / `stroke_*` / `highlight_color` / `uppercase` do NOT carry over — yet it still inherits `style`, `font_size`, `color`, `background_color`, `position`, `position_y` and `max_words_per_line`. A segment that sets its own `position` does NOT inherit the top-level `position_y` (an inherited value never beats a placement the segment asked for); a segment with no placement of its own inherits both. Overlapping segments are a 400.
- **A segment's `captions[]` use ABSOLUTE video-timeline ms**, not ms relative to `start_ms`. A WORD-level caption belongs to the segment that contains its START — the same rule that deals shared words to segments, so a word never straddles two treatments. A PHRASE-level caption (its text holds more than one word) that straddles a segment boundary is split AT the boundary instead: each segment gets the same text with `startMs` / `endMs` clipped to its own window, so the phrase renders once per window, in that window's style, and never twice at the same instant. A clipped part shorter than 250 ms is dropped — unless dropping it would lose the phrase entirely, in which case the longest part is kept. Keep every `end_ms` / `endMs` within the clip: the output is lengthened to cover the latest one. A `subtitle` segment shows its `text` (or the range's shared words) as one phrase block; `\n` forces a line break. Because that block is ONE entry spanning the range, a `max_words_per_line` on such a segment splits it by character proportion across the range — the shared words' own timings are not used; give the segment its own `captions[]` when the lines must follow the speech.
- **`transcribe_provider: "whisper"` returns no word timings.** It is refused — a 400 before any credit is reserved — only when a KINETIC render (a kinetic style, or a kinetic segment that falls back to the shared transcription) has transcription as its only caption source; with `text` there, the transcription is skipped and the text is spaced evenly. On `subtitle`, and on `subtitle` segments, `whisper` is accepted: phrase timing is all a subtitle needs, and its phrases burn in as timed lines. Leave the field unset, or name a word-timed engine (`elevenlabs-stt`, `incredibly-fast-whisper`).
- **`null` is unset.** In workflow node data a lever written as `null` is treated exactly like an omitted one: it styles nothing, and it does not move a `subtitle` to Remotion or to the kinetic rate.
- **Billing.** Any kinetic style, any call with `segments[]`, and any `subtitle` that carries a styling lever or a timed source (`captions[]`, a wired transcript, or auto-transcription because it has no `text`) bills at the kinetic rate. Only a plain-text `subtitle` with no styling lever bills the static rate; the look levers add nothing on top of the kinetic rate. Supplying `captions[]` skips this node's built-in transcription — a separate `transcribe` call is its own job.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "add-captions-1",
  "type": "add-captions",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Add Captions",
    "style": "subtitle",
    "position": "bottom",
    "fontSize": 32,
    "color": "#ffffff",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
