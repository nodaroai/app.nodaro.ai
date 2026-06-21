# Character Asset
> Create a multi-variation character with consistent identity across poses, expressions, motions, lighting, and voice — built and managed in the full-screen Character Studio — or choose an existing character from your Library or the Public Gallery.

## Overview
The Character node creates a reusable character asset with a base portrait, multiple visual variation categories (expressions, poses, motions, reference angles, lighting), structured attribute and wardrobe selections, an optional high-fidelity LoRA (Cloud edition), and definition data (voice and personality). All character editing happens inside the **Character Studio** — a full-screen modal organized into a config-driven sidebar — while the canvas node itself stays compact and shows a summary. Characters are persisted per-project in the database and can be referenced by other nodes (scenes, image generation) via the `characterRef` output to maintain visual consistency.

## The Canvas Node

The Character node on the canvas is a compact summary card. It shows:
- The base portrait preview
- The character name and `style · gender`
- Asset-count badges for **Expressions**, **Poses**, and **Motions**
- A row indicating whether **Voice** and **Personality** are filled in (✓)
- A **⬡ Studio** button that opens the Character Studio
- A **Choose existing** button (next to **⬡ Studio**) that opens the **Asset Picker** to bind the node to a character you already have. Once a character is bound, this button becomes **Replace** — use it to swap in a different character.

All appearance and asset editing — generating the portrait, expressions, poses, motions, reference views, lighting, and setting voice/personality — happens inside the studio. The old in-node image action buttons, version history, accordions, and asset-sheet thumbnails have been replaced by the studio.

## Configuration

The config panel (right side, when a Character node is selected) is intentionally minimal:

| Field | Type | Description |
|-------|------|-------------|
| Summary | read-only | Character name and style at a glance. |
| Open Character Studio | button | Opens the full-screen Character Studio (same modal as the node's **⬡ Studio** button). |
| Choose from Library / Gallery | button (row) | Opens the **Asset Picker** to bind the node to an existing character. Becomes **Replace from Library / Gallery** once a character is bound — use it to swap in a different one. |
| Identity Lock | dropdown | Controls how strictly downstream nodes preserve the character's face/identity. |
| Field Mappings | section | Map upstream node outputs to the character's inputs — `{characterName}` injection still works. |

### Character Data

In addition to the base portrait and identity settings, a character holds the following data (all built and managed in the studio):

| Data | Description |
|------|-------------|
| `sourceImageUrl` | The base portrait image. The reference image for all generated assets. |
| `expressions` | Image references for facial expressions (neutral, smile, angry, surprised, sad, talking, laughing, …). |
| `poses` | Image references for body positions and stances (standing, walking, sitting, running, …). |
| `motions` | Short **video clips** of the character in motion, generated from the portrait via image-to-video providers. |
| `angles` | Head-angle reference views — front, 3/4 left, left profile, right profile, 3/4 right, back. (A sub-section of the **Appearance** page.) |
| `bodyAngles` | Full-body angles, standing naturally with arms relaxed at the sides. (A sub-section of the **Appearance** page.) |
| `lightingVariations` | The character under different lighting conditions — daylight / night / dramatic. (A sub-section of the **Appearance** page.) |
| `person` | Structured **appearance attributes** (hair, eyes, build, age, ethnicity, …) chosen on the **Pickers** page. Auto-injected into portrait + asset generation prompts server-side. |
| `wardrobe` | Structured **wardrobe** selections (archetype, top, bottom, outerwear, footwear, headwear, accessories, color-palette, material, era) chosen on the **Pickers** page. Auto-injected into portrait + asset generation prompts server-side. |
| `voice` | An ElevenLabs voice (the same voice library used by Text to Speech nodes) plus a free-form "voice traits" description. Auto-fills a connected Text to Speech node at run time (overridable per node). |
| `personality` | Four free-form text fields: Mood / Temperament, Speech Style, Movement Style, Behavioral Notes. |

> **Voice** now auto-fills a connected **Text to Speech** node at run time — the character's voice, voice type, and recommended provider flow into the wired TTS node, and you can still override them on that node. **Person** and **Wardrobe** selections are injected into the character's own portrait and asset generation prompts server-side. **Personality** is still stored only — auto-injection of personality into downstream generation/script nodes, and "smart" automatic selection of which expression/pose image a downstream node should use based on scene context, remain a planned follow-up. The `characterRef` output and Identity Lock behavior are unchanged.

### Asset Categories

| Category | Type | Generated via | Description |
|----------|------|---------------|-------------|
| Expressions | images | image models | Facial/emotional variations (neutral, smile, angry, surprised, sad, talking, laughing, …). |
| Poses | images | image models | Body positions and stances (standing, walking, sitting, running, crouching, pointing, …). |
| Motions | video clips | image-to-video (Kling / Wan) | Short video clips of the character in motion (walking, running, waving, dancing, …). Requires a portrait first. |
| Reference Views (Angles) | images | image models | Head and body angles — front, 3/4 left, left profile, right profile, 3/4 right, back. Sub-section of the **Appearance** page. |
| Lighting Variations | images | image models | The character under daylight / night / dramatic lighting. Sub-section of the **Appearance** page. |

## Choosing an existing asset

Instead of building a new character in the studio, you can bind the node to a character you already have. Open the **Asset Picker** from either the **Choose existing** button on the canvas node or the **Choose from Library / Gallery** row in the config panel. The picker has two tabs:

- **My Library** — your own saved characters.
- **Public Gallery** — characters shared by the community. Selecting one **clones it into your library first** (you can't reference another creator's private asset), then binds the node to that fresh clone.

This works both for an empty node (first-time selection) and to **replace** a character that's already set — once a character is bound, the buttons read **Replace** / **Replace from Library / Gallery**. Binding or replacing carries the full character (portrait plus every variation bucket — expressions, poses, motions, angles, lighting, voice, and personality), so downstream nodes immediately use the new character.

In two more cases the picker helps you avoid clutter:

- **Already have a copy?** If you pick a Public Gallery listing you've cloned before, the picker asks whether to **use your existing copy** or **make a new copy** — so a gallery pick never silently piles up duplicates.
- **Delete from My Library.** Hover a card in the **My Library** tab and click the trash icon to remove a saved asset. It's archived (recoverable), and any nodes already using it keep working.

## Character Studio

The Character Studio is a full-screen modal where you build and manage everything about the character. Open it from:
- The **⬡ Studio** button on the canvas node, or
- The **Open Character Studio** button in the config panel.

The studio **auto-saves** as you work. Identity fields (name, description, gender, style, base outfit, voice traits, personality) are persisted ~600ms after the last keystroke. Generated assets are persisted by the **backend itself** at completion — every Generate call passes the character's DB id along with the request, and the worker writes the resulting image/clip directly to the character row when the job finishes. That means **if you close the tab or refresh mid-generation, the asset still lands on the character** the next time you open the studio. A small "Saving… / Saved" indicator in the header reflects the current state. There is no Save button.

The studio opens on **Profile** and organizes everything into a config-driven sidebar with four groups:

| Group | Pages |
|-------|-------|
| **Resources** | References · Pickers · LoRA *(Cloud edition only)* |
| **Identity** | Profile · Appearance |
| **Visuals** | Expressions · Poses · Motions · Sheet |
| **Character** | Voice · Personality |

### Resources → References

The character's **reference photos** — up to seven slots, one per framing (front face, side left, side right, 3/4 left, 3/4 right, front body, other). Real-life reference photos give the image/video providers extra conditioning so generated assets stay on-model. (Previously these lived on the Appearance tab; they're now their own page.)

### Resources → Pickers

Two structured pickers whose selections are stored on the character and **auto-injected into its portrait + asset generation prompts server-side** (no extra wiring):

- **Person** — appearance attributes (hair, eyes, build, age, ethnicity, skin, face, and more). The same Person picker available as a canvas node, embedded here and bound to the character.
- **Wardrobe** — archetype, top, bottom, outerwear, footwear, headwear, accessories, color palette, material, and era.

Each selection contributes a descriptive clause to the generation prompt the next time you generate the portrait or any asset, so the character renders consistently without retyping the same attributes. See [Parameter Picker Catalogs](../../picker-catalogs.md) for how picker clauses are assembled.

### Resources → LoRA *(Cloud edition only)*

Train a high-fidelity character LoRA from the character's own images, right inside the studio (relocated here from the in-node training section). The page shows a **curated training-image grid**: every eligible image (source portrait, reference photos, expressions, poses, head angles, body angles, lighting) is shown and selectable, all selected by default — uncheck any you don't want to train on. A minimum of **4** images is required (the "N / 4" counter reflects your selection). From here you can **Start** training, watch status (untrained / queued / training / succeeded / failed), see the assigned **trigger word**, **Re-train**, or **Remove** the LoRA. Training is credit-metered and only available on the Cloud edition; the page is hidden on other editions.

### Identity → Profile

The portrait and core identity for the character: **name**, **portrait** (with a **Generate Portrait** button and, for multi-candidate runs, an **approve** step to pick the keeper), **description**, **gender**, **style**, **base outfit**, an image-model **provider** picker, and a **seed prompt** that scaffolds portrait generation. Approving a portrait also fires an LLM caption that authors the character's canonical visual description (used by downstream prompts). The studio opens on this page.

### Identity → Appearance

Angle and lighting variations of the approved portrait, in three sub-sections, each with preset chips, a free-form prompt, an image-model picker, and Generate:

- **Head Angles** — front, 3/4 left, left profile, right profile, 3/4 right, back (head-and-shoulders framing).
- **Body Angles** — the same angle set in full-body framing, standing naturally.
- **Lighting Variations** — daylight / night / dramatic.

### Visuals → Expressions, Poses, Motions, Sheet

- **Expressions** — image references. Presets: neutral, smile, angry, surprised, sad, talking, laughing, disgusted, fearful, smirk, crying. Each card has an inline-editable name (the "tag"), three regen actions (↻ regenerate same / ＋ add variation / ✏ img2img refine), and a ✕ delete. The generation bar has preset chips, a free-form custom prompt, a curated top-tier image-model picker (`nano-banana-pro` default, `nano-banana-2`, `gpt-image-2`, `seedream`), a **Generate** button, and a **⟳ Generate All** button that queues every missing preset (it confirms first when 4+ jobs would be submitted). Every Generate button shows the current model's credit cost inline (e.g. **Generate (5 CR)** / **Generate All (20 CR)**); preset chips show a small cost subscript so it's clear what each tap costs.
- **Poses** — same layout as Expressions. Presets: standing, walking, sitting, running, crouching, pointing, fighting stance, jumping, turning.
- **Motions** — short **video clips** generated from the portrait via image-to-video providers (Kling / Wan: `kling`, `kling-turbo`, `kling-3.0`, `wan-i2v`, `wan-2.7-i2v`). Requires a portrait first — without one, Generate is disabled with a tooltip. Cards show video thumbnails with a ▶ overlay, an editable name, ↻ regenerate same / ＋ add variation buttons, and a ✕ delete; there is **no** img2img refine on motions (video refinement is a future release) and **no** "Generate All". The Generate button shows the current motion provider's credit cost inline. Presets: walking, running, waving, sitting down, fighting stance, jumping, turning around, dancing, talking gesture.
- **Sheet** — composite a turnaround / expression / reference sheet from the character's assets. See the [Reference Sheet](../ai-image/reference-sheet.md) node for the composition details.

### Character → Voice, Personality

- **Voice (reworked)** — a full voice workspace:
  - **Browse** — pick an ElevenLabs voice from premade voices, the public library, and your own custom clones (with search and preview).
  - **Clone from audio** — upload a 30s–2min clean audio sample and create a custom voice clone, which becomes the character's selected voice.
  - **Design from text** — describe a voice ("a warm, gravelly old storyteller with a slight Irish lilt"), then **audition** it with a preview line. *Design is audition-only* — saving a designed voice for reuse is a planned follow-up.
  - **Selected-voice card** — shows the chosen voice with a free-form **voice traits** textarea (e.g. "deep, calm, British accent, slight rasp") and a preview player.
  - **▶ Talk** — type a line and **🔊 Speak** to hear the character speak it via text-to-speech. If the character has an **approved portrait**, **🎬 Speak + lip-sync portrait** renders a short talking clip of the portrait saying the line. Lip-sync is **credit-metered** (priced per second of output — see the [Lip Sync](../ai-video/lip-sync.md) node for the rate); plain Speak uses standard text-to-speech credits.

  The selected voice **auto-fills a connected Text to Speech node** on the canvas at run time — the character's voice, voice type, and recommended provider flow into the wired TTS node. You can still override them per node.
- **Personality** — four free-form text fields: **Mood / Temperament**, **Speech Style**, **Movement Style**, **Behavioral Notes**. Stored only — not yet auto-applied to downstream nodes.

### Common patterns

- **Generation bar** (on every visual page): preset chips for one-tap generation of common variants, a free-form custom prompt for anything else, a model picker, and Generate. Expressions and Poses also have **⟳ Generate All**. Every Generate / Generate All / preset chip shows the current model's credit cost inline.
- **Inline-editable names**: every asset card's name is editable — it's the tag that identifies that expression/pose/motion.
- **↻ Regenerate same**: re-fire the same variant on an existing card (e.g. another *smile*); replaces the card on completion.
- **＋ Add variation**: re-fire the same variant but append the result as a new card (so you can compare versions of, say, *smile* side-by-side).
- **✏ img2img refine** (image assets only): refine an existing expression/pose/angle/lighting image with a prompt, choosing whether to **Replace** the card or **Add as new**.
- **↑ Import**: each visual page can import an existing media URL directly (no generation job) — images for image pages, video URLs for Motions.

## Inputs & Outputs

**Inputs:**
- `in` -- Optional text or image input for additional context (also drives `{characterName}` field mappings).

**Outputs:**
- `characterRef` -- Character reference (identity) that can be connected to scene nodes, image generation, and other nodes that accept character references. Unchanged by the studio.
- `image` -- The character's portrait as a **plain image**. Connect this anywhere a Generate Image output can go (image References, Image-to-Image, Generate Video image input, etc.). Unlike `characterRef`, it carries no identity / canonical-description injection — it is just the picture.

## Best Practices
- **Set Pickers and reference photos before generating the portrait.** Person + Wardrobe selections are injected into the portrait and asset prompts server-side, and reference photos give the providers extra conditioning — getting them in first makes the first portrait far more on-target.
- **Generate the portrait first**, then approve it. It's the reference image for expressions, poses, and motions — generating assets before there's an approved portrait gives inconsistent results, and Motions can't be generated at all without one.
- Write a detailed description covering facial features, body type, hair, and clothing for the most consistent results (the Person/Wardrobe pickers cover the structured side of this).
- If you don't like a generated expression or pose, use **↻ Regenerate same** to get another shot at the same variant, or **＋ Add variation** to keep the existing card and compare a fresh take side-by-side.
- Use **✏ img2img refine** when you want to *modify* an existing image with a prompt (e.g. "more intense smile") rather than re-roll from scratch — "Add as new" keeps the original while you compare.
- Curate the asset names. They're the tags that identify each expression/pose/motion and will drive smarter automatic downstream selection in a future release.
- Use the same style setting across all characters in a project for visual coherence.
- Pick the character's **Voice** in the studio, then wire the character into a **Text to Speech** node — the voice auto-fills at run time (override per node if needed). Use **▶ Talk** to audition a line and, with an approved portrait, preview a lip-synced talking clip before committing.
- *(Cloud)* Once you have a good spread of on-model images, train a **LoRA** for the highest-fidelity reuse — curate the training grid to the cleanest shots (min 4).

## Common Use Cases
- Creating consistent characters for animated explainer videos.
- Building a cast of characters for a multi-scene narrative.
- Generating character turnaround sheets (reference angles) for animation reference.
- Producing expression libraries for dialogue-driven content.
- Capturing short motion clips of a character for use as i2v references or B-roll.

## Tips
- Characters are saved to the project database. They persist across sessions and can be reused in multiple workflows within the same project.
- The `characterRef` output carries the character's identity information, allowing downstream nodes to maintain visual consistency.
- Each expression, pose, angle, and lighting variation is stored as an individual image, so you can reference specific assets.
- **Pickers** (Person + Wardrobe) and **reference photos** affect only the character's *own* portrait and asset generation — they're applied automatically server-side, so you don't wire them anywhere.
- Motions are short video clips — a motion clip costs the same as the equivalent image-to-video generation on the chosen provider (e.g. a Kling clip costs the same as a Kling image-to-video). See the [Image to Video](../ai-video/image-to-video.md) node for provider details.
- Use **↑ Import** to bring in artwork or footage you already have instead of generating it.
- Close the studio to collapse it back to the compact canvas node — your saved data stays on the node and in the project database.
