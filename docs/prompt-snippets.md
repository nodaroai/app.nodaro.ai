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

- The final-prompt preview, the AI prompt helper, published apps, the SDK, and
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

## The Snippets button

Next to the AI prompt-helper button on a prompt field's label row there is a
small **scissors button**. It opens the same searchable snippet menu as a
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
