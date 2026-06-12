# Prompt Snippets

Prompt snippets are reusable inline **text fragments** — "Identity Lock",
"Golden Hour", "Slow Dolly-In" — that you drop into a prompt while you write,
either with a `/` slash menu or a snippets button next to the field. A snippet
is just text: inserting one types its words into your prompt at the caret.

> **Snippets vs presets.** A **preset** reconfigures the whole node — it sets
> the provider, resolution, aspect ratio, and other fields at once. A
> **snippet** changes nothing but the text you are writing: it composes *inside*
> the prompt (or negative prompt) you are already editing. Use a preset to set
> up a node; use a snippet to enrich the wording of a single field.

## What you see is what runs

Snippets insert **plain text** into the prompt. There is no hidden marker, no
template, no runtime lookup — the snippet's words become part of
`prompt` exactly as shown, and that exact string is what gets sent to the model.
Because of this:

- The final-prompt view, the AI prompt helper, published apps, the SDK, and
  workflow export/import all see the same plain text — nothing special to strip.
- Sharing or exporting a workflow carries the inserted text verbatim. The person
  who imports it does **not** need your snippet library; the words are already
  in the prompt.

## The `/` slash menu

Type `/` in any prompt field to open the snippet menu inline, without leaving
the keyboard (it coexists with the `@` mention and `{` variable triggers).

- **Trigger rules.** `/` only opens the menu at the **start of a line** or
  **immediately after whitespace**. It never triggers mid-word, so typing a URL
  like `https://…` does not pop the menu.
- **Filtering.** Keep typing after `/` to filter. The query matches a snippet's
  **name, description, and category** (case-insensitive). **Name-prefix matches
  rank first**, then other matches.
- **Keyboard.** ↑ / ↓ move the selection; **Enter or Tab** inserts the
  highlighted snippet; **Esc** dismisses the menu. The menu **auto-hides when
  nothing matches**. Up to **50 results** are shown.
- **Layout.** Your own snippets appear first, then factory snippets grouped by
  category with section headers. Each row shows the snippet name and a dimmed
  preview of the text it inserts.

**Insertion separator.** A snippet is inserted at the caret with a smart leading
separator so the result reads cleanly:

- nothing when you are at the start of a line or right after a space;
- a single space when the preceding character is sentence punctuation (`. , ; : ! ?`);
- `", "` when you are gluing the snippet onto the end of a word.

## Pills

In a **positive prompt field**, an inserted snippet renders as a compact
**amber pill** (a small `</>` icon plus the snippet’s name) instead of the
raw words. The pill is purely a way to *see and manage* the fragment — it is
**not** stored. The prompt behind it is always the snippet's plain text:

- **The stored prompt is always the plain text.** Copying the prompt yields the
  fragment's words, the final-prompt view shows the real string, and
  export/import/SDK all see plain text. There is no hidden marker.
- **Hover** a pill to see its full text in a tooltip (the pill itself shows just
  the name to stay compact).

**Click a pill** to open its menu:

- **Swap** — pick any **same-category** snippet from the list to replace this
  one in place (e.g. swap "Golden Hour" for "Neon Noir" within *Lighting*). The
  prompt text updates atomically.
- **◀ / ▶ cycle** — when the category has more than one snippet, the arrows step
  through the same-category variations one at a time — the quick "compare
  results" loop without reopening the list.
- **Edit as text** — unwraps the pill back into editable plain text so you can
  tweak the wording. (It will re-pillify on the next reload if the edited text
  still exactly matches a snippet — display state is derived by matching, by
  design.)
- **Remove** — deletes the whole fragment, plus a dangling leading separator
  (a `", "` or space the insertion added) so you are not left with a stray comma.

**Backspace** at a pill deletes the **whole** pill in one keystroke (it is a
single atomic unit, not character-by-character text).

**Pills are a display layer over matching text.** When a workflow loads, any
plain text that exactly matches a snippet in your current pool is shown as a
pill. Two consequences follow:

- If you **edit the underlying snippet** in your library, old occurrences in
  existing prompts **revert to plain text** (the words no longer match the new
  snippet) — nothing breaks; the prompt still contains exactly what it always
  did.
- A pill whose snippet was deleted still renders from its own stored name and
  text; only the swap/cycle options go quiet.

**Negative-prompt fields stay text-only** — no pills. Snippets you insert there
(via the `/` menu or the button) are plain text exactly as shown, with the same
separator rules.

## The Snippets button

Next to the AI prompt-helper button on a prompt field's label row there is a
small **`</>` snippets button**. It opens the same searchable snippet menu as a
popover anchored to the field. Selecting a snippet **appends** it to the end of
the field's current text (the `/` menu is what inserts at an arbitrary caret
position), using the same separator rules.

The popover footer has two actions:

- **New snippet** — opens the Manage dialog with the create form expanded. If
  you had **text selected** in the field when you clicked the button, that
  selection prefills the new snippet's text.
- **Manage** — opens the Manage dialog to edit or delete your snippets.

## Negative-prompt fields

Negative-prompt fields get the **same `/` menu**, showing snippets whose target
is **negative** (bare comma lists like `morphing, warping, flickering` — never
"no X" phrasing, per current model guidance). Insertion is plain text with the
same separator rules.

Some fields are **audio-tag fields** — the text fields on text-to-speech and
Suno music nodes that use `[tag]` autocomplete. Those keep `/` for inserting
**audio tags** and do **not** show prompt snippets.

## Final-prompt view (per field)

Every prompt and negative-prompt field has its own **Show final prompt** toggle.
In its label row, next to the `</>` snippets button, is a small **Eye** button.
Click it and the field swaps from the editor to a read-only rendering of the
**assembled final prompt** — exactly what the model will receive once the editor
folds in everything around your words. The button becomes a **Pencil** ("Edit
prompt"); click it again to swap back to editing. Editing is untouched: pills,
the `/` menu, the snippets button, and the AI helper all work exactly as before
in edit mode.

There is no separate "Final prompt" block anymore — this inline view per field
replaces it, and the **Copy** button and legend now live inside it.

### What the final view shows

In place of the editor, the field renders the assembled text read-only, with a
**Copy** button (top-right) that copies the **plain text** — no color markup
ever reaches the clipboard or the model. If the field is empty, the editor's
placeholder shows muted and the toggle stays available.

On nodes with **provider-aware assembly** — the **Generate Image** and **Modify
Image** config panels, plus the ⌘E quick-edit modal — the text is color-coded by
where each piece came from, with a small legend underneath. Each color marks one
origin:

| Color | Origin | What it is |
|-------|--------|------------|
| _(no tint)_ | **Your text** | Exactly what you typed. |
| Sky&nbsp;blue | **Variable** | A resolved `{Node Label}` value pulled from an upstream node. |
| Indigo | **Picker** | A cinematography / parameter-picker fragment from a connected node (e.g. a Setting or Camera Motion node). |
| Amber | **Snippet** | An inserted snippet's text (matched back to your snippet pool). |
| Violet | **References** | The identity / reference directive block added for connected character or reference images. |
| Grey | **Style** | The auto-appended `Style: …` suffix. |
| Rose | **Negative** | The negative-prompt content — either its own field, or an `Avoid: …` suffix folded into the prompt for providers that have no separate negative field. |

The **legend** lists only the origins actually present (a prompt that is purely
your own text shows no legend). The negative field on these surfaces gets the
same variable- and snippet-highlighting.

On **every other node** (the video panels, audio, music, script, the text-input
node, and the ⌘E modal for a provider-less node) the final view shows the same
read-only assembled text with **fewer provenance colors**: your `{variables}`
resolve to their upstream values (sky blue), inserted snippets are highlighted
(amber), any connected cinematography / parameter-picker fragments are tinted
(indigo), a wired identity-lock clause reads as a **References** span (violet),
and an appended `Style: …` suffix is greyed — exactly as on the provider-aware
surfaces, for whichever of those are actually present. What these nodes don't
show is the full reference-directive block (the "Use these characters:" wrap)
and byte-exact model assembly — both require the per-provider builder that only
image generation runs today. Same toggle, same Copy button. (If a piece can't be
matched back cleanly, the field falls back to plain text rather than mis-tint.)

The **video panels** (Image to Video, Text to Video, Generate Video, Video to
Video, Motion Transfer, Speech to Video, Extend Video, Video Retake, Kling 3.0
Studio) go one step further on the **negative**: their final view reports the
**true negative routing** for the chosen video model. Kling and Wan family models
accept a real negative parameter, so your negative is sent natively and the prompt
is left untouched; every other video model has no native negative field, so your
negative is folded into the prompt as a trailing `Avoid: …` clause (rose-tinted
inside the prompt view). The routing matches exactly what the model receives at
generation time.

### Negative-prompt fields

A negative field's final view shows the **resolved negative** — your text with
`{variables}` expanded — and a one-line caption telling you **how it is routed**
for the selected provider, because not every model has a separate negative input:

- **Sent natively as the provider's negative prompt** — the provider takes a
  real `negative_prompt` parameter (e.g. Imagen 4, Ideogram, Qwen for images;
  the Kling and Wan families for video).
- **Appended to the prompt as "Avoid: …"** — the provider has no native negative
  field, so the editor folds your negative into the prompt as a trailing
  `Avoid: …` clause (it then also appears, rose-tinted, inside the prompt view).
  This covers most image models and every non-Kling/Wan video model.

The resolved negative is shown in **both** routings — the caption is what tells
you where it actually goes.

### It's a display layer, and the canvas remembers it

The colors and the assembled rendering never change the string sent to the model
— Copy always yields the plain text. The per-field mode is remembered **per node**
(saved with the workflow), so a field you flipped to the final view stays that
way across closing and reopening the panel and across a reload, and each field's
mode is independent of the others.

## Scoping: which snippets a field sees

Every snippet declares:

- a **target** — `prompt` or `negative` (which field's menu it appears in), and
- one or more **node modalities** — `image`, `video`, `audio`, `text`.

A node declares its modality once, so a field only ever shows snippets that
match both its target and the node's modality. A "Slow Dolly-In" video snippet
never clutters an image prompt; a negative-only scrub never shows in a positive
prompt field.

### Factory catalog (v1)

Nodaro ships **67 built-in factory snippets** covering **image and video**
(positive and negative), mined from our factory presets and current model
prompting guides. Audio and text catalogs are intentionally empty in v1 — those
fields show your custom snippets only. The categories:

| Category | Count | Examples |
|---|---|---|
| Identity & Consistency | 5 | **Identity Lock** (preserve the exact same face… do not alter identity), **Wardrobe Lock** |
| Quality | 5 | **Cinematic Quality**, **Editorial Photo** |
| Lighting | 8 | **Golden Hour** (warm golden-hour sunlight, long soft shadows…), **Neon Noir** |
| Camera & Lens | 9 | **85mm Portrait** (85mm lens at f/1.8, creamy bokeh…), **Kodak Portra Look** |
| Composition | 6 | **Rule of Thirds**, **Full Body in Frame** |
| Realism | 5 | **Real Skin Texture** (visible pores, fine lines… no airbrushing), **Film Grain** |
| Text Rendering | 2 | **Legible Sign Text** (a sign that reads "YOUR TEXT"…), **Clean Typography** |
| Camera Motion *(video)* | 7 | **Slow Dolly-In** (slow steady dolly-in toward the subject…), **Orbit Shot** |
| Motion Quality *(video)* | 6 | **Natural Physics**, **I2V Fidelity Lock** |
| Audio & Dialogue *(video)* | 3 | **No Subtitles** ((no subtitles, no on-screen text, no captions)), **Silence Lock** |
| Negative — Image *(negative)* | 7 | **Anatomy Cleanup** (deformed hands, extra fingers…), **Watermark Scrub** |
| Negative — Video *(negative)* | 4 | **Artifact Scrub** (morphing, warping, flickering…), **Identity Drift Scrub** |

Factory snippets are built in and **not editable**.

## Custom snippets

Create, edit, and delete your own snippets in the **Manage dialog** (reached from
the snippets button footer). Each snippet has:

- **Name** — required, up to **80 characters**, unique across your snippets
  (saving a duplicate name shows "A snippet with that name already exists").
- **Description** — optional, up to **300 characters**. It is searched by the
  menu, so a good description helps you find the snippet by `/`.
- **Text** — required, up to **2000 characters**. This is the exact fragment
  inserted into the prompt.
- **Target** — `prompt` or `negative`.
- **Media** — multi-select over `image` / `video` / `audio` / `text`. Leaving it
  **empty means the snippet applies to all node types**.
- **Category** — optional free text. It groups the snippet in the menu; if you
  leave it blank, your snippets appear under **"My snippets"** at the top of the
  menu.

**Text restrictions.** Snippet text **may not contain `{`, `}`, `@`, or line
breaks.** Those characters are reserved in the prompt editor — `{` … `}` forms a
`{NodeLabel}` variable token and `@` starts an `@mention` — so a snippet
containing them could be misread as a token rather than literal text. (Pasting
multi-line text into the field collapses the line breaks to spaces.)

Your custom snippets always sort to the **top of the menu**, under "My snippets"
or your own category name, ahead of the factory catalog.

## Using snippets from code

Snippets are an **editor-managed** feature. The REST API exposes **read-only**
access:

- `GET /v1/prompt-snippets` — your custom snippets.
- `GET /v1/prompt-snippets/factory` — the built-in factory catalog.

Creating, editing, and deleting snippets is done in the editor; those write
endpoints reject programmatic (API-token / OAuth) callers. Because snippets land
as plain text, no snippet-aware API is needed to *run* a workflow that uses them
— the prompt already contains the words.

## See also

- [Node Reference](./nodes/README.md) — the prompt and negative-prompt fields per node
- [API Integration](./api-integration.md) — REST endpoints and authentication
- [SDK Reference](./sdk-reference.md) — TypeScript client
