# Node Presets

A **preset** is a named snapshot of a node's configuration — its prompt, model, provider, and all
parameter/input fields. Save a configuration once, then load it onto any node of the same type in
one click. Presets make it easy to reuse a "look" or a use-case setup across your workflows.

Presets work for **every node type** in the editor, and any new node type gets them automatically.

## Factory vs. custom presets

- **Factory presets** ship with Nodaro for the most-used nodes. They're read-only starting points,
  grouped into folders so related ideas live together.
- **Custom presets** are the ones you create. They're private to your account and sync across your
  devices.

### Generate Image factory catalog

**Generate Image** ships a large curated catalog organized into folders, with multiple **variants of
the same idea**:

| Folder | Examples |
|--------|----------|
| **Reference Sheet** *(connect a photo)* | **Character Board**, **Location Board**, **Product Board**, **Outfit Board**, **Scene Board**, **Creature Board** — dense multi-panel reference sheets generated from one connected photo |
| **Photography & Cinematic** | Cinematic Still / Widescreen (21:9), Studio & Golden-Hour Portrait, B&W, Macro, Food, Aerial, Landscape |
| **Characters** | **Character Sheet** family — Turnaround (3-view), Action Poses ×4, Expressions ×6 / ×16, Outfit Variations, With Text Labels, Chibi — plus Portrait, Full-Body Hero, Creature, Avatar |
| **Product & Commerce** | Product on White, Lifestyle, Flat-Lay, Packaging / Device Mockup, Beauty Hero |
| **Branding & Logos** | Wordmark / Emblem / Mascot logo, App Icon, Monogram |
| **Marketing & Social** | YouTube Thumbnail, Instagram Post, Story/Reel, Ad Creative, Quote Card, Web Banner |
| **Print & Posters** | Movie Poster, Event Poster, Book Cover, T-Shirt/POD, Die-Cut Sticker, Album Cover |
| **Illustration & Art Styles** | Anime, Comic, Manga, Watercolor, Oil, Flat Vector, Isometric, Pixel Art, Pixar-3D, Coloring Page, Tattoo Flash, Concept Art |
| **Film & Storyboard** | Storyboard Frame, Cinematic Keyframe, Matte Painting, Mood Board Tile, Establishing Shot |
| **Architecture & Interiors** | Exterior, Interior, Real Estate Hero, Skyscraper |
| **Icons, Game Assets & Textures** | Game Icon, Seamless Texture / Pattern, Emoji Set, Pixel Sprite |
| **Portrait Transformations** *(needs a reference photo)* | **Timeless Soul** age progression (Five Ages, Three-Age Triptych, B&W), Decade Timeline ('80s–2020s), Four Seasons, Times of Day, Sports Jersey Portrait |

Each preset pre-selects the **best provider and aspect ratio** for its job (e.g. text-strong models
for logos and thumbnails) and includes **`{placeholder}` slots** in the prompt — fill them in (for
example `{character description}` or `{brand}`) before you run. Placeholders now support **default
values** with the `{token || default}` syntax (e.g. `{brand || a modern tech startup}`), so a preset
renders into a sensible image even if you run it unedited — the fallback is used until you type your
own value (shipped in [PR #3250](https://github.com/nodaroai/app.nodaro.ai/pull/3250)).

> **Selective stylization** ("make the person a cartoon but keep the background photoreal") is a
> transform effect. The **Stylized Subject** folder ships *Cartoon Person · Real World*, *Caricature
> · Real Photo*, *Anime Person · Real Background*, *Real Person · Cartoon World*, and *Claymation ·
> Real Set*. It appears on **both Generate Image** (connect a reference image so the model edits it)
> **and Modify Image** — the two share one catalog while Modify Image is being phased out in favor of
> Generate Image.

> **Portrait Transformations** are also reference-photo transforms. The **Timeless Soul** age
> progression rebuilds the person in a connected reference into a single studio composite showing
> them at several ages (5, or 3 for the triptych), lined up shoulder-to-shoulder. The look rides on
> an *identity-lock* clause — same eyes, brow, nose, ears, and bone structure across every figure, so
> it reads as one person aging rather than several different people. Feed it a clean, front-facing,
> evenly-lit portrait for the tightest identity. The same identity-lock drives the sibling presets:
> **Decade Timeline** (aging + period-accurate styling across the '80s–2020s) ages the subject, while
> **Four Seasons** and **Times of Day** hold the subject at one age and vary only wardrobe/lighting.

### Generate Video factory catalog

**Generate Video** ships a cinematography-driven catalog. Camera moves are written as composable
prompt fragments (you can stack them), and each preset pre-selects a fitting provider + aspect ratio
+ a provider-valid duration (social presets default to 9:16). Consistent with the Generate Image
catalog, every video preset now ships a tuned **`negativePrompt`** (to suppress common motion
artifacts — warping, flicker, morphing) and uses the **`{token || default}`** placeholder syntax for
its `{placeholder}` slots, so each preset renders into a sensible clip even if you run it unedited —
the fallback is used until you type your own value.

| Folder | Examples |
|--------|----------|
| **Camera Moves** | Slow Push-In, Dolly Out, 360° Orbit, Arc, Crane Up, Tracking Follow, Slow Pan, Tilt-Up Reveal, Whip Pan, Dolly Zoom (Vertigo) |
| **Shot Types & Angles** | Establishing Wide, Medium, Close-Up, Macro, Low-Angle Hero, Overhead Top-Down, FPV Drone |
| **Cinematic & Specialty** | Handheld Doc, Slow Motion, Timelapse, Hyperlapse, Bullet Time, Rack Focus |
| **Social & Reels** (9:16) | Vertical Hero, Talking Head, Product Reveal, Trend Quick-Cut, POV Walk |
| **Product & Ads** | Product Hero, 360 Spin, Liquid Splash, Unboxing, Lifestyle Ad |
| **Motion Graphics & Logo** | Logo Sting, Title Reveal, Particle Background, Loop Background |
| **B-Roll & Nature** | Clouds Timelapse, Water Slow-Mo, Forest Drift, Aerial Landscape, Ocean Loop |
| **Animation & Style** | Anime Motion, 3D Cartoon, Claymation, Living Watercolor |
| **Looping & Backgrounds** | Subtle Motion, Living Wallpaper |
| **Viral & Effects** *(best with an input image)* | Frozen in Ice, Superhero Transformation, Elevator Doors Reveal, POV Skydive, Underwater POV |

### Music factory catalogs

Both music nodes ship presets organized along the three axes professional libraries use — **Use-Case**,
**Mood / Score**, and **Genre**:

- **Generate Music** (structured): each preset sets `genre` + `mood` + `instrumental` + a descriptive
  prompt (duration capped at 30s). Folders: *By Use-Case* (Lo-fi Study, Podcast Intro, Cinematic
  Trailer, Corporate, Vlog, Ambient Loop, EDM Drop, Game Loop), *By Mood / Score* (Uplifting,
  Emotional, Tense, Epic, Happy, Dark, Romantic), *By Genre* (Lo-fi, EDM, Rock, Jazz, Orchestral,
  Synthwave, Funk, Ambient Cinematic).
- **Suno Generate** (style-prompt): each preset fills Suno's free-text **style** box using Suno's own
  formula — *genre + mood + instrumentation + named tempo/BPM + instrumental/vocals + structure*.
  Setting a style auto-enables Suno custom mode. *By Use-Case* and *By Genre* presets are instrumental
  and run as-is; the **Vocals & Songs** folder (Pop, Rap, Ballad, Rock, Acoustic, R&B, K-Pop) sets the
  style + song structure and invites you to add your own lyrics.

### Voice, sound & text catalogs

- **Text to Speech** — voice-*delivery* profiles that set the ElevenLabs knobs (stability,
  similarity, style, speed) **without** pinning a voice, so they layer on top of whichever voice you
  pick. Folders: *Narration* (Audiobook, Documentary, News Anchor, Explainer, Calm Narrator),
  *Advertising & Hype* (Commercial Read, Hype), *Conversational & Calm* (Podcast Host, Character,
  Meditation / ASMR).
- **Text to Audio** (sound effects) — ready prompts for *Transitions & Impacts* (Whoosh, Impact,
  Riser), *Ambiences (loopable)* (Rain, Forest, Fire, Sci-Fi Drone — `loop: true`), *UI & Stingers*
  (Click, Notification, Applause), and *Foley & Action* (Footsteps, Door, Glass Break, Typing,
  Explosion, Magic Sparkle, Camera Shutter, Error Buzzer).
- **Generate Text** (LLM) — system-prompt roles in *Assistants*, *Writing & Marketing* (Copywriter,
  Social Caption, SEO, Rewrite, Script Writer), *Utility* (Prompt Enhancer, Translator, Summarizer,
  Q&A, Brainstorm) and *Structured Output* (JSON Extractor, Classifier).

### Script, vision & voice catalogs

- **Generate Script** — format presets that set tone + scene count + target length: *By Format*
  (YouTube Short, Explainer, Ad Spot, Product Demo, Listicle, UGC Ad — selfie-style
  Hook→Show→Proof→Opinion) and *Long-Form & Narrative* (Podcast Outline, Trailer Narration, Story
  Beats). Type your topic in the prompt.
- **Image to Text** — analysis presets: *Accessibility & SEO* (Alt Text, SEO Caption, Social Caption),
  *Extraction* (OCR, Tags, Product Description) and *Creative* (Detailed Description, Reverse Prompt).
- **Voice Design** — describe-a-voice presets: *Narration & Character* (Movie-Trailer Narrator, Warm
  Female Audiobook, Old Wizard, Noir Detective, Meditation Guide) and *Professional & Assistant*
  (Energetic Hype, Friendly Assistant, Corporate IVR).

### Image edits (shared with Modify Image)

Beyond Stylized Subject, the transform catalog adds an **Edits** folder — *Remove/Replace Background,
Colorize, Restore Old Photo, Relight, Restyle* — available on both **Generate Image** (with a
connected reference image) and **Modify Image**. Generate Image also gained a **Diagrams &
Infographics** folder (Blueprint, Infographic, UI / App Mockup, Flowchart, Chart, Timeline).

### Voice Changer factory catalog

**Voice Changer** ships *Revoice Styles* — Faithful (Natural), Clean & Stable, Expressive, Studio
Clean — tuning stability / similarity / style and background-noise removal for the target voice.

### Captions factory catalog

**Add Captions** ships *Caption Styles* — Clean Subtitles, TikTok Bold, Karaoke Highlight, Word Pop,
Bouncy Captions, Word Highlight, Top Banner — each pre-selecting the caption style, position, font
size, and color.

### Video restyle factory catalog

**Video to Video** ships *Restyle Looks* — Anime, Claymation, Cyberpunk Neon, Oil Painting, 3D
Animated, Watercolor — each a restyle prompt (the original motion is preserved) on a video-restyle
provider.

### Combine Videos factory catalog

**Combine Videos** ships *Joins & Transitions*: Hard Cut, Crossfade, Dissolve, Fade Through Black,
and — the headliner — **Seamless Join (One-Shot)**.

> **Seamless Join (One-Shot)** fixes the frame *jump* you get when you stitch **continuous** shots —
> start/end-frame storyboards, or a clip extended with Seedance-2 "extend the scene". Those clips
> share a near-duplicate boundary frame that reads as a hitch. The preset keeps a hard **cut** (so the
> result still looks like one continuous take, not a dissolve), **trims 4 frames off each clip's end
> and 3 off each start** to drop the artifact frames, and applies an **equal-power audio crossfade** to
> hide the audio seam. Connect your clips in order and run.

## Using presets

Every configurable node has a **preset dropdown** in two places:

- In the node's **config panel** — just below the node-type heading (or on the side in fullscreen).
- On the **node itself** — in the top-right hover toolbar, left of the ⋯ menu.

Until you pick one, the trigger shows a muted **PRESET** hint. The menu puts **your own presets
("My Presets") at the top**, then the read-only **Factory** catalog below. Any presets you **star
surface in a "Favorites" band** at the very top so you can reach them without opening folders — the
band stays hidden until you favorite something. Open the dropdown to:

- **Select a preset** — loads its settings onto the node. Selecting a preset that would overwrite
  your current settings asks you to confirm first. (Undo with ⌘/Ctrl-Z.)
- Once a preset is active, its **name shows in the dropdown**. If you then change any of its
  settings, a **`*`** appears next to the name so you know you've diverged from the saved preset.
- **Save as new** — capture the node's current settings as a new custom preset.
- **Override “…”** — update the active *custom* preset with the node's current settings (asks you
  to confirm). Factory presets can't be overridden.
- **Search** — filter presets by name or description.
- **Import / Export** — back up or share presets as a `.json` file.
- **Delete** — remove one of your custom presets (hover a row).
- **Reset to default** — clear the selected preset and restore the node's default settings
  ("go back to no preset"). Asks you to confirm, since it overwrites the node's current settings.
- **Manage presets…** — opens the management dialog (see below).

The dropdown appears automatically on any node that has configurable settings. Nodes with no
settings (such as sticky notes) and asset nodes (Character/Location/Object) don't show it.

**Favorites** — click the **☆** star on any preset row (factory or custom) to favorite it. Your
favorites collect in a band at the top of the dropdown, hidden until you have at least one, so the
presets you reach for most are always one click away.

## Organizing presets

Click **Manage presets…** in the dropdown to open the management dialog, where you can organize your
**custom** presets:

- **Folders** — collapsible containers. Create one with **New folder**, then move presets into it.
- **Sections** — always-open group headers for light grouping at the top level. Create one with
  **New section**.
- **Move** — change a preset's folder/section with the **Top level ▾** picker on its row.
- **Reorder** — use the ▲/▼ controls to order folders, sections, and presets within a level.
- **Description** — give a preset a short description (shown under its name and searchable).
- **Tags** — add tags to a preset; the dropdown's search matches names, descriptions, **and** tags.
- **Rename / Delete** — rename folders and presets inline; deleting a folder moves its presets back
  to the top level (presets are never lost).

In the dropdown, your custom folders show as collapsible rows and sections as inline headers, in the
order you set. A **Favorites** band sits at the very top — it spans **both** your custom presets and
factory presets, and is hidden when you haven't favorited anything. Below it, **your presets appear
first** (the **My Presets** section); then the read-only **Factory** section's category folders
(collapsed by default so you can scan them at a glance). Searching flattens everything into a single
filtered list.

## What a preset captures

A preset stores the node's **reusable configuration** — prompt, model, provider, aspect ratio,
resolution, quality, seed, voice, style, numeric parameters, and so on.

It deliberately does **not** store:

- **Results / run state** (generated images, videos, job status) — those are outputs, not settings.
- **The node's label** — applying a preset never renames your node.
- **Wired inputs (field mappings)** — connections to other nodes are specific to one workflow and
  aren't portable, so they're left untouched when you apply a preset.

Because a preset applies the provider and its dependent settings together, switching to a preset
built for a different provider just works — any setting that doesn't apply to the new provider is
adjusted automatically.

## Export / import format

Exported files are versioned JSON:

```json
{
  "kind": "nodaro.node-presets",
  "version": 1,
  "exportedAt": "2026-06-05T12:00:00.000Z",
  "presets": [
    {
      "nodeType": "generate-image",
      "name": "Cinematic Portrait",
      "description": "Moody, shallow-depth portrait look.",
      "data": { "provider": "nano-banana-pro", "aspectRatio": "9:16" }
    }
  ]
}
```

On import, any preset whose name already exists for that node type is kept by appending
"(imported)" to its name, so importing never overwrites your existing presets.

## Programmatic access (API / SDK / CLI)

Presets are also **readable programmatically** (creating/editing stays in the editor for now):

- **REST** — `GET /v1/node-presets` (your custom presets), `GET /v1/node-preset-groups`, and
  `GET /v1/node-presets/factory?nodeType=…` (the built-in catalog). OAuth tokens need
  the `presets:read` scope. See [API Integration §16](../api-integration.md).
- **SDK** — `client.presets.list()`, `.listGroups()`, `.listFactory(nodeType)`. See the
  [SDK reference](../sdk-reference.md#clientpresets).
- **CLI** — `nodaro presets list [--factory] [--node-type …]`, `nodaro presets groups`,
  `nodaro presets export`.
- **MCP** — the `list_node_presets` tool (custom / factory / all) for agents.

A preset's `data` is captured node config — apply it by merging `data` into a node when you build a
workflow.
