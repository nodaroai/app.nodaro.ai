# Character
> Create a multi-variation character with consistent identity across poses, expressions, motions, lighting, and voice — built and managed in the full-screen Character Studio.

## Overview
The Character node creates a reusable character asset with a base portrait, multiple visual variation categories (expressions, poses, motions, reference angles, lighting), and definition data (voice and personality). All character editing happens inside the **Character Studio** — a full-screen modal — while the canvas node itself stays compact and shows a summary. Characters are persisted per-project in the database and can be referenced by other nodes (scenes, image generation) via the `characterRef` output to maintain visual consistency.

## The Canvas Node

The Character node on the canvas is a compact summary card. It shows:
- The base portrait preview
- The character name and `style · gender`
- Asset-count badges for **Expressions**, **Poses**, and **Motions**
- A row indicating whether **Voice** and **Personality** are filled in (✓)
- A **⬡ Studio** button that opens the Character Studio

All appearance and asset editing — generating the portrait, expressions, poses, motions, reference views, lighting, and setting voice/personality — happens inside the studio. The old in-node image action buttons, version history, accordions, and asset-sheet thumbnails have been replaced by the studio.

## Configuration

The config panel (right side, when a Character node is selected) is intentionally minimal:

| Field | Type | Description |
|-------|------|-------------|
| Summary | read-only | Character name and style at a glance. |
| Open Character Studio | button | Opens the full-screen Character Studio (same modal as the node's **⬡ Studio** button). |
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
| `angles` | Reference views — front, 3/4 left, left profile, right profile, 3/4 right, back angles of the character. (A sub-section of the Appearance tab.) |
| `lightingVariations` | The character under different lighting conditions — daylight / night / dramatic. (A sub-section of the Appearance tab.) |
| `voice` | An ElevenLabs voice (the same voice library used by Text to Speech nodes) plus a free-form "voice traits" description. |
| `personality` | Four free-form text fields: Mood / Temperament, Speech Style, Movement Style, Behavioral Notes. |

> Voice and Personality (and all the studio's other assets) are **stored** with the character in this release. Auto-injection of voice/personality into downstream speech, generation, or script nodes — and "smart" automatic selection of which expression/pose image a downstream node should use based on scene context — is a planned follow-up and is not yet active. For now, these fields are saved for later use; the `characterRef` output and Identity Lock behavior are unchanged.

### Asset Categories

| Category | Type | Generated via | Description |
|----------|------|---------------|-------------|
| Expressions | images | image models | Facial/emotional variations (neutral, smile, angry, surprised, sad, talking, laughing, …). |
| Poses | images | image models | Body positions and stances (standing, walking, sitting, running, crouching, pointing, …). |
| Motions | video clips | image-to-video (Kling / Wan) | Short video clips of the character in motion (walking, running, waving, dancing, …). Requires a portrait first. |
| Reference Views (Angles) | images | image models | Six standard angles — front, 3/4 left, left profile, right profile, 3/4 right, back. Sub-section of the **Appearance** tab. |
| Lighting Variations | images | image models | The character under daylight / night / dramatic lighting. Sub-section of the **Appearance** tab. |

## Character Studio

The Character Studio is a full-screen modal where you build and manage everything about the character. Open it from:
- The **⬡ Studio** button on the canvas node, or
- The **Open Character Studio** button in the config panel.

The studio **auto-saves** as you work. Identity fields (name, description, gender, style, base outfit, voice traits, personality) are persisted ~600ms after the last keystroke. Generated assets are persisted by the **backend itself** at completion — every Generate call passes the character's DB id along with the request, and the worker writes the resulting image/clip directly to the character row when the job finishes. That means **if you close the tab or refresh mid-generation, the asset still lands on the character** the next time you open the studio. A small "Saving… / Saved" indicator in the header reflects the current state. There is no Save button.

The studio organizes everything into grouped vertical tabs:

### Identity → Appearance

Portrait controls for the character itself: name, description, gender, style, base outfit, an optional reference image URL, an image-model picker, and a **Generate Portrait** button. Below the portrait are two sub-sections:

- **Reference Views** — an angles grid (front, 3/4 left, left profile, right profile, 3/4 right, back) with preset chips, a free-form prompt, an image-model picker, and Generate.
- **Lighting Variations** — a lighting grid (daylight / night / dramatic) with the same pattern.

### Visuals → Expressions, Poses, Motions

- **Expressions** — image references. Presets: neutral, smile, angry, surprised, sad, talking, laughing, disgusted, fearful, smirk, crying. Each card has an inline-editable name (the "tag"), three regen actions (↻ regenerate same / ＋ add variation / ✏ img2img refine), and a ✕ delete. The generation bar has preset chips, a free-form custom prompt, a curated top-tier image-model picker (`nano-banana-pro` default, `nano-banana-2`, `gpt-image-2`, `seedream`), a **Generate** button, and a **⟳ Generate All** button that queues every missing preset (it confirms first when 4+ jobs would be submitted). Every Generate button shows the current model's credit cost inline (e.g. **Generate (6 CR)** / **Generate All (24 CR)**); preset chips show a small cost subscript so it's clear what each tap costs.
- **Poses** — same layout as Expressions. Presets: standing, walking, sitting, running, crouching, pointing, fighting stance, jumping, turning.
- **Motions** — short **video clips** generated from the portrait via image-to-video providers (Kling / Wan: `kling`, `kling-turbo`, `kling-3.0`, `wan-i2v`, `wan-2.7-i2v`). Requires a portrait first — without one, Generate is disabled with a tooltip. Cards show video thumbnails with a ▶ overlay, an editable name, ↻ regenerate same / ＋ add variation buttons, and a ✕ delete; there is **no** img2img refine on motions (video refinement is a future release) and **no** "Generate All". The Generate button shows the current motion provider's credit cost inline. Presets: walking, running, waving, sitting down, fighting stance, jumping, turning around, dancing, talking gesture.

### Character → Voice, Personality

- **Voice** — pick an ElevenLabs voice (the same voice library used by the Text to Speech nodes, with search and preview) plus a free-form **voice traits** textarea (e.g. "deep, calm, British accent, slight rasp").
- **Personality** — four free-form text fields: **Mood / Temperament**, **Speech Style**, **Movement Style**, **Behavioral Notes**.

> As noted above, Voice and Personality are stored only in this release — they aren't yet auto-applied to downstream nodes.

### Common patterns

- **Generation bar** (on every visual tab): preset chips for one-tap generation of common variants, a free-form custom prompt for anything else, a model picker, and Generate. Expressions and Poses also have **⟳ Generate All**. Every Generate / Generate All / preset chip shows the current model's credit cost inline.
- **Inline-editable names**: every asset card's name is editable — it's the tag that identifies that expression/pose/motion.
- **↻ Regenerate same**: re-fire the same variant on an existing card (e.g. another *smile*); replaces the card on completion.
- **＋ Add variation**: re-fire the same variant but append the result as a new card (so you can compare versions of, say, *smile* side-by-side).
- **✏ img2img refine** (image assets only): refine an existing expression/pose/angle/lighting image with a prompt, choosing whether to **Replace** the card or **Add as new**.
- **↑ Import**: each visual tab can import an existing media URL directly (no generation job) — images for image tabs, video URLs for Motions.

## Inputs & Outputs

**Inputs:**
- `in` -- Optional text or image input for additional context (also drives `{characterName}` field mappings).

**Outputs:**
- `characterRef` -- Character reference that can be connected to scene nodes, image generation, and other nodes that accept character references. Unchanged by the studio.

## Best Practices
- **Generate the portrait first.** It's the reference image for expressions, poses, and motions — generating assets before there's a portrait gives inconsistent results, and Motions can't be generated at all without one.
- Write a detailed description covering facial features, body type, hair, and clothing for the most consistent results.
- Use a reference image URL when you need the character to match a specific look.
- If you don't like a generated expression or pose, use **↻ Regenerate same** to get another shot at the same variant, or **＋ Add variation** to keep the existing card and compare a fresh take side-by-side.
- Use **✏ img2img refine** when you want to *modify* an existing image with a prompt (e.g. "more intense smile") rather than re-roll from scratch — "Add as new" keeps the original while you compare.
- Curate the asset names. They're the tags that identify each expression/pose/motion and will drive smarter automatic downstream selection in a future release.
- Use the same style setting across all characters in a project for visual coherence.
- Set Voice and Personality now even though they aren't auto-applied yet — the data travels with the character.

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
- Motions are short video clips — a motion clip costs the same as the equivalent image-to-video generation on the chosen provider (e.g. a Kling clip costs the same as a Kling image-to-video). See the [Image to Video](../ai-video/image-to-video.md) node for provider details.
- Use **↑ Import** to bring in artwork or footage you already have instead of generating it.
- Close the studio to collapse it back to the compact canvas node — your saved data stays on the node and in the project database.
