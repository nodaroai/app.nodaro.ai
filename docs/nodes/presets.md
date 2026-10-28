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
| **YouTube** | 52 thumbnails filed by topic (*AI & Tech*, *Finance & Crypto*, *Business & Creators*, *Gaming & Challenges*, *Health, Fitness & Beauty*, *Food & Travel*, *Experts & Teachers*, *News & Investigation*, *Talk, Podcast & Music*, *Entertainment & Reactions*, *Family, Pets & Sports*) — Finance Shock, Crypto Pump, AI Tool Reveal, New Model Drop, Coding Tutorial, Course Launch, Before/After, Versus Battle, Tier List, True Crime Board… each with an example picture; the on-image headline is a `{TEXT || …}` slot whose default is the headline the picture shows |
| **Shorts · TikTok** | 10 vertical (9:16) covers — POV Hook, Storytime, 5AM Routine, 3 Steps, Quick Recipe, GRWM, Side Income, AI Free Tool, Dance Trend, Fitness Daily |
| **Social & Ads** | Posts (Old vs New, Big Caption, Carousel Cover, Quote Card, Hiring, Employee Spotlight), Instagram feed, Stories, WhatsApp status, X, Pinterest pins (2:3), Facebook covers, LinkedIn posts, Ads & promos (restaurant, salon, gym, clinic, real estate, Facebook lead, App Store), Profiles & banners (LinkedIn, Twitch, podcast, Spotify) |
| **Business** | E-commerce (Amazon hero, lifestyle, infographic, Etsy, ghost mannequin, sale badge), Work & marketing (report cover, email header, landing hero), Education (slide title, worksheet header, flashcard), Merch (t-shirt, sticker sheet, mug) |
| **Life & Events** | Invitations and cards (wedding, birthday, club flyer, conference, holiday, baby), Personal (birthday card, pet portrait, holiday card, phone wallpaper, meme, dating profile), Sports (match day, player card), Community (fundraiser, menu board) |
| **Layout** | Storyboard ×6, Production Storyboard, Multi-Shot 2×2, 2×2 Grid, Headless Sheet, Sprite Sheet, Props Sheet, Comic Page |
| **Text** | 45 type styles — Neon Sign, Gold Foil, Chrome Y2K, Graffiti Drip, Carved Wood, Glitch, Fire Embers, Ice, Holographic, Typewriter, Wedding Script, Indie Title Card… the word shown is the `{TEXT}` slot |
| **Business & Marketing** | 30 finished small-business assets — Brand Identity Starter, Salon Opening Campaign, Restaurant Menu Design, Flash Sale Advertising, Property Listing Cover, Hiring Poster, Spa Gift Certificate, Trade Show Booth, Coffee Shop Menu Board, Storefront Sign Mockup… |
| **Personal Photos** *(connect your photo)* | 20 edits of your own picture — Old Family Photo Restoration, Black and White Colorization, Scratch Removal, Photo Background Change, Corporate Headshot Upgrade, Try a New Haircut / Hair Color, Tattoo Design Preview, Fine Art Pet Portrait, Cartoon Avatar, Virtual Outfit Preview… |
| **Products & Fashion** *(most connect a product photo)* | 20 — Phone Photo to Hero Product, Clean White Packshot, Luxury Perfume Campaign, Skincare Water Splash, Jewelry Gemstone Macro, Coffee Packaging Concept, Virtual Fashion Model, Four-Product Catalog Grid, Product Rotation Sheet… |
| **Content & Creative** | 20 — Indie Music Album Cover, Thriller Book Jacket, Science Fiction Movie Poster, YouTube Channel Banner, Podcast Cover Artwork, RPG Character Concept Sheet, Four-Panel Comic Story, Educational Infographic, Music Festival Poster, Travel Magazine Cover… |
| **Home & Spaces** *(connect a photo of the room)* | 15 — Scandinavian Living Room Redesign, Contemporary Kitchen Renovation, Japandi Bedroom, Spa Bathroom, Work-From-Home Office, Nursery, Balcony Garden, Backyard Landscape, Exterior Paint Options, Place a Sofa in Your Room… |
| **Family & Events** | 15 — Elegant Wedding Invitation, Kids Birthday Invitation, Bar Mitzvah Invitation, Baby Shower, Save the Date, Family Movie Poster Portrait, Newborn Announcement, Rosh Hashanah Greeting, Ramadan Greeting, Memorial Tribute Card… |
| **Reference Sheet** *(connect a photo)* | **Character Board**, **Pose Board**, **Location Board**, **Product Board**, **Outfit Board**, **Scene Board**, **Creature Board**, **Vehicle Board**, **Food Board**, **Mascot Board**, **Pet Board**, **Skin Detail Sheet** — dense multi-panel reference sheets generated from one connected photo; reuse the board as a reference in later generations for consistency |
| **Cast & Consistency** *(connect photos)* | **Character Reference Grid** (clean 4-angle identity grid, no decorations), **Cast Mega Grid** (one labeled sheet for 2–4 connected characters), **Cast Scene** (stage the cast referencing them by name) — sterile neutral-background grids built to be fed back as identity references |
| **Edit by Name** *(two-step recipe)* | **Label Elements** (returns the connected photo with numbered callout labels) → **Apply Named Edit** (edit elements by their label name; labels removed from the result) |
| **Face Privacy** *(connect a photo)* | **Faceless · 3D Blank Head** (persons' faces → smooth generic white 3D head shape), **Remove Faces**, **Transparent Faces** — one-click `{image:1}` anonymization edits that keep everything else in the photo untouched (gpt-image-2, auto aspect); **Remove People** — removes every person and keeps the background exactly the same (GPT Image 2.5 Flare, auto aspect, 2K) |
| **Photography & Cinematic** | Cinematic Still / Widescreen (21:9), Studio & Golden-Hour Portrait, B&W, Macro, Food, Aerial, Landscape |
| **Characters** | **Character Sheet** family — Turnaround (3-view), Action Poses ×4, Expressions ×6 / ×16, Outfit Variations, With Text Labels, Chibi — plus Portrait, Full-Body Hero, Creature, Avatar |
| **Product & Commerce** | Product on White, Lifestyle, Flat-Lay, Packaging / Device Mockup, Beauty Hero |
| **Branding & Logos** | Wordmark / Emblem / Mascot logo, App Icon, Monogram |
| **Marketing & Social** | YouTube Thumbnail, Instagram Post, Story/Reel, Ad Creative, Quote Card, Web Banner |
| **Print & Posters** | Movie Poster, Event Poster, Book Cover, T-Shirt/POD, Die-Cut Sticker, Album Cover |
| **Illustration & Art Styles** | Anime, Comic, Manga, Watercolor, Oil, Flat Vector, Isometric, Pixel Art, Pixar-3D, Coloring Page, Tattoo Flash, Concept Art |
| **Handmade & Stop-Motion** | Claymation Scene, Needle-Felt, Sock Puppet, Cardboard Diorama, Embroidered Art, Faux-Food (Clay) — tactile crafted looks held by an in-prompt "NOT digital CG, NOT a 3D render" clause |
| **Film & Storyboard** | Storyboard Frame, Cinematic Keyframe, Matte Painting, Mood Board Tile, Establishing Shot |
| **Architecture & Interiors** | Exterior, Interior, Real Estate Hero, Skyscraper |
| **Icons, Game Assets & Textures** | Game Icon, Seamless Texture / Pattern, Emoji Set, Pixel Sprite |
| **Portrait Transformations** *(needs a reference photo)* | **Timeless Soul** age progression (Five Ages, Three-Age Triptych, B&W), Decade Timeline ('80s–2020s), Four Seasons, Times of Day, Sports Jersey Portrait |
| **Realism & Authentic** | Unretouched Portrait, Phone Selfie, Candid Phone Snapshot, Mirror Selfie, Creator at Home · Waist-Up, Webcam / Video-Call Frame, Macro Skin Study, Product in Hand — everyday, unretouched looks: real skin texture, deep focus and plain colour instead of a polished studio finish |

The thirteen groups at the top of the table are the **Create Image tiles**: each preset carries the
exact prompt that rendered its example picture (GPT Image 2.5 Flare or GPT Image 2, 1K), so an unedited run makes
a picture like the one shown, and a filled `{TEXT}` slot carries your own headline — a headline of
several lines opens one slot per line (`{TEXT}`, `{TEXT2}`, `{TEXT3}`), each defaulting to the line
the picture shows, while labels, buttons and badges in the design stay as they are. Over the API
each of these also states `section` (its sub-heading, such as a YouTube topic) and `platforms`
(where the result is meant to be posted, most fitting first) — see
[Programmatic access](#programmatic-access-api--sdk--cli).

Each preset pre-selects the **best provider and aspect ratio** for its job (e.g. text-strong models
for logos and thumbnails) — for boards and grids those defaults are backed by a head-to-head
provider experiment, written up in the [Reference Boards Guide](../reference-boards-guide.md) —
and includes **`{placeholder}` slots** in the prompt — fill them in (for
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
| **Scene Recipes** *(board-driven · Step 2)* | **Viral Meteor Scene**, **Cartoon Short · Opening / Chase / Resolution**, Two-Character Dialogue, Disaster Reveal, Chase Scene — beat-scripted Seedance-2 scenes with native audio and quoted-line **lip-sync**; connect your **Reference Sheet boards / Cast & Consistency grids** (from Generate Image) as reference images so every character stays on-model. Chain multi-scene shorts with Combine Videos' **Seamless Join (One-Shot)** |
| **Video Editing** | **Edit Video** — edits a clip wired into **Video Refs** by instruction, on Seedance 2.5. Sets Aspect ratio **Adaptive** and Duration **Auto** (the shape the provider requires for an edit, so the result keeps the source clip's ratio and length) and ships only [pre & post text](../prompt-pre-post-text.md): `edit {video:1} as follows:` before your sentence, a "keep everything else unchanged" tail after it. Type the change you want as the prompt; wire reference images to bring in a new outfit, object or place. Credits follow *Auto duration* in the [Generate Video pricing section](ai-video/generate-video.md). |
| **UGC & Creator** (9:16) | **UGC Talking Head**, **UGC Product Closer**, **Handheld Unboxing**, **Get Ready With Me**, **Street-Style Q&A**, **Reaction Shot**, **Acts on Phone, Screen Hidden** — everyday talking-to-camera clips on Seedance 2.5 at 9:16 and 720p, 8 seconds long (5 for Street-Style Q&A and Reaction Shot), with native audio and a subtitle-free tail. Wire the photos each preset names into **Image Refs** (a face, a product, or both) and, where the preset has a spoken line, type it with numbers written as words |

### Music factory catalogs

Both music nodes ship presets organized along the three axes professional libraries use — **Use-Case**,
**Mood / Score**, and **Genre**:

- **Generate Music** (structured): each preset sets `genre` + `mood` + `instrumental` + a descriptive
  prompt (duration capped at 30s). Folders: *By Use-Case* (Lo-fi Study, Podcast Intro, Cinematic
  Trailer, Corporate, Vlog, Ambient Loop, EDM Drop, Game Loop), *By Mood / Score* (Uplifting,
  Emotional, Tense, Epic, Happy, Dark, Romantic), *By Genre* (Lo-fi, EDM, Rock, Jazz, Orchestral,
  Synthwave, Funk, Ambient Cinematic).
- **Suno Create Music** (style-prompt): each preset fills Suno's free-text **style** box using Suno's own
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
  Riser), *Ambiences (loopable)* (Rain, Forest, Fire, Sci-Fi Drone, Living Room Tone, Kitchen Hum, Café Murmur — `loop: true`), *UI & Stingers*
  (Click, Notification, Applause), and *Foley & Action* (Footsteps, Door, Glass Break, Typing,
  Explosion, Magic Sparkle, Camera Shutter, Error Buzzer).
- **Generate Text - Any LLM** (LLM) — system-prompt roles in *Assistants*, *Writing & Marketing* (Copywriter,
  Social Caption, SEO, Rewrite, Script Writer, Hook Generator, UGC Monologue Writer — set to Claude Opus 5.5 at high effort), *Utility* (Prompt Enhancer, Translator, Summarizer,
  Q&A, Brainstorm) and *Structured Output* (JSON Extractor, Classifier).

### Script, vision & voice catalogs

- **Generate Script** — format presets that set tone + scene count + target length: *By Format*
  (YouTube Short, Explainer, Ad Spot, Product Demo, Listicle, UGC Ad — selfie-style
  Hook→Show→Proof→Opinion, with figures and proof only from your topic, set to Claude Opus 5.5 at high effort) and *Long-Form & Narrative* (Podcast Outline, Trailer Narration, Story
  Beats). Type your topic in the prompt.
- **Image to Text** — analysis presets: *Accessibility & SEO* (Alt Text, SEO Caption, Social Caption),
  *Extraction* (OCR, Tags, Product Description, Site Screenshot Summary) and *Creative* (Detailed Description, Reverse Prompt, Realism Audit — a yes/no list of signs an image was generated, with a count).
- **Voice Design** — describe-a-voice presets: *Narration & Character* (Movie-Trailer Narrator, Warm
  Female Audiobook, Old Wizard, Noir Detective, Meditation Guide, Casual Creator (female / male)) and *Professional & Assistant*
  (Energetic Hype, Friendly Assistant, Corporate IVR).

### Image edits (shared with Modify Image)

Beyond Stylized Subject, the transform catalog adds an **Edits** folder — *Remove/Replace Background,
Colorize, Restore Old Photo, Relight, Restyle*, plus two **Doodle Overlay** presets (hand-drawn
felt-tip marker doodles layered on top of the photo while every pixel underneath stays unchanged —
one max-control white-and-yellow variant, one loose expressive variant; doodles never cover faces) — plus four photo-finish edits: **Add Skin Realism**, **Natural Photo Finish**, **Phone Camera Look** and **Undo Beauty Filter** —
available on both **Generate Image** (with a connected reference image) and **Modify Image**. Generate Image also gained a **Diagrams &
Infographics** folder (Blueprint, Infographic, UI / App Mockup, Flowchart, Chart, Timeline).

### Voice Changer factory catalog

**Voice Changer** ships *Revoice Styles* — Faithful (Natural), Clean & Stable, Expressive, Studio
Clean — tuning stability / similarity / style and background-noise removal for the target voice.

### Captions factory catalog

**Add Captions** ships *Caption Styles* — Clean Subtitles, TikTok Bold, Karaoke Highlight, Word
Pop, Bouncy Captions, Word Highlight, Top Banner, Hook Plate, Body Captions — each pre-selecting
the caption style, position, font size and color.

**Hook Plate** sets one line — usually the opening line of a talking-to-camera video — as a bold
dark-on-white plate near the top of the frame; wire the line in as text. **Body Captions** is
word-by-word captions with an outline, in the band under a face. They are made to work together
in one run: in an API or MCP call, pass them as two `segments` — the plate from the start to the
end of the opening line, with that line as its `text`, then the body captions to the end with
their words as `captions`. The `@nodaro/prompts` helper `hookPlateCaptionSegments` builds that
list from the line, its end time and the timed words. A caption plan in Hebrew (`language: "he"`)
sets the Rubik font on both segments, so a Latin brand inside a Hebrew line is drawn in the same
font, and keeps its letters as written.

### Video restyle factory catalog

**Video to Video** ships *Restyle Looks* — Anime, Claymation, Cyberpunk Neon, Oil Painting, 3D
Animated, Watercolor, Phone Footage Look (an everyday handheld look for b-roll that keeps the clip's own sound and length — it re-renders faces, so not for talking clips) — each a restyle prompt (the original motion is preserved) on a video-restyle
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

### Motion Graphics factory catalog

**Motion Graphics** ships 22 presets across six folders, **all targeting the Lottie engine** (the
LLM authors a complete Lottie animation with **named, editable slots**). Each preset is a rich
art-direction brief that pre-selects a fitting aspect ratio, duration, and background, and ends by
naming the **stable slots** it exposes — so after generating you can re-color and re-caption for free
(no credits, no regeneration), and those same slots surface as editable fields when the node is added
as an input in a published app. Overlay presets ship a transparent background (`#00000000`) and say so
in the brief; standalone presets (title cards, intro, countdown, looping backgrounds) set an opaque
dark background. Text slots carry placeholder copy (e.g. "Jane Doe", "SUBSCRIBE") for you to retype.

| Folder | Presets |
|--------|---------|
| **Titles & Text** | Lower Third, Title Card, Kinetic Typography, Quote Card, End Card (CTA) |
| **Intros & Logos** | Logo Sting, Channel Intro, Countdown |
| **Social & CTA** | Subscribe Reminder, Like + Follow Bug, Sale Badge, Story Highlight |
| **UI & Icons** | Loader / Spinner, Success Check, Error Cross, Progress Bar, Notification Pop |
| **FX Overlays** | Confetti Burst, Sparkle Shimmer, Speed Lines |
| **Backgrounds** | Gradient Blob Loop, Geometric Pattern Loop |

Selecting a preset **overwrites** the node's prompt and canvas settings (engine, aspect ratio,
duration, background) and **clears any previously generated plan** — so the old animation never lingers
under the new prompt. Run the node to author the animation, then tweak its slots. (These presets target
the Lottie engine; for the Classic/elements engine, describe your look directly in the prompt.)

### Lottie Overlay factory catalog

**Lottie Overlay** ships 13 placement/timing presets across four folders. The **Connected Graphic**
folder is built for the graphic wired into the node's `lottie` input (typically a Motion Graphics
node's authored Lottie) — overlay it centered with custom timing, stretch it **full-canvas** (the
right placement for lower thirds / titles authored on a full transparent canvas), open or close the
video with it, pin it as a looping **corner bug**, or pop it in like a reaction sticker. The other
folders drive the **built-in overlay catalog**: *Celebration & FX* (Celebration Moment, Grand Finale,
Ambient Particles), *Reactions & Social* (Heart Reaction, Hype Combo), and *Emphasis & UI* (Point It
Out, Success Beat).

Every prompt is written with **`{variable || default}`** slots for its levers — e.g.
`{start time || 1 second}`, `{corner || bottom-right}`, `{play mode || once at its natural duration}`.
Three ways to use them:

1. **Run unedited** — each variable falls back to its default.
2. **Type over a token** — replace `{start time || 1 second}` with `3 seconds`.
3. **Wire a node whose label matches the variable name** (e.g. a Text node labeled `start time`) —
   its output fills the slot at run time, so a published app or upstream logic can drive the timing.

Presets deliberately do **not** set the node's Duration — the overlay plan timeline should track your
source video, so the node's own duration/FPS settings stay untouched when you apply one.

## Factory presets that ship pre & post text

Presets whose text is a complete instruction — rather than a subject you replace — now ship it as
[pre & post text](../prompt-pre-post-text.md) instead of `prompt`, so applying them leaves the
prompt field free for your own additions and the run wraps whatever you type:

- **Generate Image / Modify Image:** the twelve **Reference Sheet** boards and the **Character
  Reference Grid** (instruction as pre-text, the `Style: … 8K` tail as post-text), **Label Elements**
  and **Apply Named Edit**, the **Face Privacy** edits, the **Portrait Transformations**, the
  **Stylized Subject** family and the **Edits** folder (Background Remove, Colorize, Restore Photo,
  Doodle Overlay ×2, Add Skin Realism, Natural Photo Finish, Phone Camera Look, Undo Beauty Filter).
- **SwitchX:** all five operation recipes.
- **Video to Video:** the seven **Restyle Looks**.
- **Generate Video:** **Edit Video** (the `edit {video:1} as follows:` instruction as pre-text, the
  keep-unchanged tail as post-text).

Template presets that fill from variables (`{subject || …}` camera moves, looks paired with a
`style`, music / SFX examples) keep their text in `prompt` — you edit that text directly.

## Using presets

Every configurable node has a **preset dropdown** in two places:

- In the node's **config panel** — just below the node-type heading (or on the side in fullscreen).
- On the **node itself** — in the top-right hover toolbar, left of the ⋯ menu.

Until you pick one, the trigger shows a muted **PRESET** hint. The menu puts **your own presets
("My Presets") at the top**, then the read-only **Factory** catalog below. Any presets you **star
surface in a "Favorites" band** at the very top so you can reach them without opening folders — the
band stays hidden until you favorite something. Open the dropdown to:

- **Select a preset** — loads its settings onto the node. Selecting a preset that would overwrite
  your current settings asks you to confirm first. (Undo with ⌘/Ctrl-Z.) A preset that ships prompt
  content (a `prompt` and/or [pre/post text](../prompt-pre-post-text.md)) replaces the node's pre &
  post text, so no leftover text from a previous preset wraps the new prompt; a settings-only preset
  leaves your prompt and pre/post text alone.
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

**Keep your prompt, keep the preset's text.** Put a preset's reusable wording in its *Pre & post
text* rather than in *Prompt*: applying the preset then leaves the prompt field free for your
subject, and the preset's text still wraps it at run time. See
[Prompt pre & post text](../prompt-pre-post-text.md).

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
resolution, quality, seed, voice, style, numeric parameters, and the node's **pre & post text**
(`promptPrefix` / `promptSuffix`).

It deliberately does **not** store:

- **Results / run state** (generated images, videos, job status) — those are outputs, not settings.
- **The node's label** — applying a preset never renames your node.
- **Wired inputs (field mappings)** — connections to other nodes are specific to one workflow and
  aren't portable, so they're left untouched when you apply a preset.
- **Generated composer-plan state** (a Motion Graphics / Composite / After Effects / 3D Title /
  Lottie Overlay node's authored plan and any rendered Lottie URL) — that's a per-run generated
  artifact, not configuration. Applying a preset also **clears** it, so the old animation never shows
  under the new settings.

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

Presets can be read **and written** programmatically — your API key, or an OAuth app you
granted `assets:write` (reads of your own library need `presets:read`). The built-in factory
catalog needs no auth at all, so an app can show it to visitors before they sign in:

- **REST** — list your presets, folders and favorites and the built-in catalog
  (`GET /v1/node-presets/factory?nodeType=…`, no token needed); create, update, delete, import and reorder presets;
  add and remove favorites; create, rename and delete folders. See
  [API Integration §16](../api-integration.md).
- **SDK** — `client.presets.list()`, `.listFactory(nodeType)` (works on a tokenless client), `.create()`, `.update()`,
  `.delete()`, `.import()`, `.favorites()`, `.addFavorite()`, … See the
  [SDK reference](../sdk-reference.md#clientpresets).
- **CLI** — `nodaro presets list [--factory] [--node-type …]` (`--factory` needs no sign-in), `nodaro presets create`,
  `update`, `delete`, `import`, `export`, `favorites`, `favorite`, `unfavorite` and
  `nodaro presets groups [create|update|delete]`.
- **MCP** — `list_node_presets` and `get_node_preset` for discovery, `save_node_preset`,
  `delete_node_preset` and `favorite_node_preset` for agents that manage presets.

A preset's `data` is captured node config — apply it by merging `data` into a node when you build a
workflow. A factory preset may also carry `section` (its sub-heading inside the group — a YouTube
topic such as `"Finance & Crypto"`, or `"Instagram feed"`) and `platforms` (where the result is meant
to be posted, most fitting first: `["TikTok", "Reels", "Shorts"]`); both are absent on a preset that
has neither, so a client groups and filters by them only when they are there. Every preset also says
how many connected photos it works from — `minReferences`, with
`needsImage` true when it is at least one (Reference Sheet, Portrait Transformations, Edits and any
template using `{image:N}`) — and carries a `previewUrl`: an example picture, or `null`.
