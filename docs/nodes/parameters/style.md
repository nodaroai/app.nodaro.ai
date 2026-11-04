# Style

> Pick a visual style preset from a 54-entry catalog (cinematic, anime, oil-painting, photorealistic, felt-puppet, ...). Emits a style-descriptor prompt fragment.

## Overview

The Style parameter node sets the overarching visual treatment of a generated image or video — the aesthetic register the AI model should adopt. The selected entry is converted to a natural-language clause and injected into the consumer's prompt via the `cinematography` handle. Image-generation config panels also expose an inline Style dropdown, but a connected Style node always takes precedence (the inline field is disabled to prevent double application).

**Images and video read different wordings.** Every style carries two clauses: an image wording, which a still image's prompt receives, and a video-only wording, which a video prompt receives in its place when the Style node is folded in as a picker (wired into a video node's look input) or the style is sent as `direction.style` to a video route. A `{Label}` reference to the Style node inside a prompt reads the node's own text, which is the image wording, on a video node too. The video wording is written for moving shots: it names the medium first, then its techniques (a drawn style, for example, names a 2D medium and its outline; a photographic style names a live-action or photographic medium, so it stays photographed). A video node's Final prompt view shows the video wording its run sends; the Style node's own preview shows the image wording. In `compact` hint mode both inject the same short term.

**Video-only styles.** Five styles are offered for video alone: `felt-puppet`, `knitted-yarn`, `toy-figure-3d`, `painterly-3d` and `painted-clay`. They restyle a whole clip into a handmade or 3D-animated look, the people and the set alike. Image style lists (the inline Style dropdown on image nodes) leave them out. A Style node offers them, because it can feed either kind of node; wired into an image node, a video-only style still works and the image receives its image wording.

**Restyling filmed footage.** Three styles are left out of restyle lists (restyling a filmed clip, such as Nodaro Motion's art style): `fantasy`, `surrealism` and `concept-art`. In tests each came out as the same plain 2D cartoon, without its own look. Video generation still offers them, and a restyle that names one still uses it.

**Medium.** Every style declares its medium: filmed (`photo`), rendered in 3D (`3d`) or drawn (`2d`). A video restyle words its instructions by it, so a 3D style is rendered rather than drawn and a photographic style stays photographed.

## Configuration

| Field     | Type   | Default       | Description                                                |
|-----------|--------|---------------|------------------------------------------------------------|
| style     | string | `"cinematic"` | Catalog entry id (e.g. `"anime"`, `"oil-painting"`).       |
| Pre Text  | text   | empty         | Free-form text prepended to the composed hint.             |
| Post Text | text   | empty         | Free-form text appended to the composed hint.              |
| Hint mode   | select   | `full`          | Which fragment this picker injects downstream — `full` = the long descriptive hint, `compact` = the short professional term. See [Prompt hint mode](./README.md#prompt-hint-mode). |

## Catalog (54 entries)

49 styles for images and video. Examples: `cinematic`, `photorealistic`, `anime`, `oil-painting`, `watercolor`, `pencil-sketch`, `charcoal`, `comic-book`, `manga`, `3d-render`, `pixel-art`, `flat-vector`, `pop-art`, `claymation`, `paper-cutout`, `children-book`, `pixar-3d`, `noir`, `cyberpunk`, `steampunk`, ...

5 styles for video alone: `felt-puppet` (Felt Puppet), `knitted-yarn` (Knitted Yarn), `toy-figure-3d` (Toy Figure 3D), `painterly-3d` (Painterly 3D), `painted-clay` (Painted Clay).

The catalog API (`GET /v1/picker-catalogs`, `GET /v1/catalogs`) marks a video-only option with `media: ["video"]`; an option without `media` is offered for both. An image style list should leave out an option whose `media` lacks `"image"`.

## Inputs & Outputs

**Inputs:** `in` — optional upstream parameter input.
**Outputs:** `out` — composed prompt-hint clause, consumed by downstream AI nodes via their `cinematography` handle.

## Common Use Cases

- Lock a consistent visual language across a batch of generations.
- Quickly try different stylistic registers for the same prompt.
- Stack with Photographer or Aesthetic for fine-grained style direction.

## See Also

- [Photographer / Artist](./photographer.md), [Aesthetic / Microtrend](./aesthetic.md), [Render Quality](./render-quality.md).
