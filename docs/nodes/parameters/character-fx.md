# Character FX

> Apply a character-driven effect (transformation, power, body modification, face FX, or subject-bound aura) to the subject of a connected AI video node.

## Overview

The Character FX parameter node defines an effect that happens TO or AROUND the subject of an AI-generated video clip — the character transforms into something (werewolf, cyborg, vampire), demonstrates a fantastical power (fire-breathe, levitation, telekinesis), grows a body part (wings, horns, tentacles), shifts their face (oni mask, glowing eyes, X-ray), or is surrounded by an aura (paparazzi flashes, money rain, saint glow). The effect is described as natural-language prompt text and injected into the consumer video node's prompt.

The distinguishing feature from other parameter pickers: when a character/face/object/location ref is wired to the node's `target` input handle, every occurrence of `"the subject"` in the prompt is globally substituted with the ref's display name. So `[Character: "Aria Voss"] → target` + `werewolf` becomes `"Aria Voss transforms into a werewolf — fur sprouts across the skin..."` instead of `"the subject transforms..."`.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Character FX | multi-select | `"auto"` | Catalog entry id, or array of 1-2 ids for compound effects (e.g., `["werewolf","fire-breathe"]`). |
| Position | select | `"auto"` | Where in the clip the effect occurs: `auto` / `start` / `middle` / `end` / `full`. |
| Duration | select | `"auto"` | How long the effect lasts: `auto` / `instant` / `short` (~1s) / `medium` (~2s) / `long` (~3s). |
| Intensity | select | `"auto"` | Energy/character of the effect: `auto` / `subtle` / `natural` / `dynamic` / `crazy`. |
| Pre Text | text | empty | Free-form text prepended to the composed hint. |
| Post Text | text | empty | Free-form text appended to the composed hint. |

All four enum fields default to `auto`, which contributes no prompt text.

## Catalog (57 entries across 5 categories)

| Category | Examples | Theme |
|---|---|---|
| **Transformation** (14) | werewolf, vampire, cyborg, ghost-form, statue-stone, liquid-metal, animalization, gorilla-form, mystification, gas-form, diamond-skin, agent-reveal | Subject becomes a different entity |
| **Power & Ability** (12) | fire-breathe, ice-breathe, air/water/earth-bending, lightning-hands, levitation, telekinesis, invisibility, hero-flight, super-speed, soul-departure | Subject demonstrates a fantastical ability |
| **Body Modification** (9) | wings-grow, horns-grow, tail-emerge, tentacles-emerge, extra-eyes, head-explode (PG-13), head-off, spiders-from-mouth, skin-surge | Parts of the subject change, emerge, or leave |
| **Face & Expression** (8) | horror-face, oni-mask, glowing-eyes, floral-eyes, bloom-mouth, x-ray, agent-snap (sunglasses), visor-x | Face contorts, mask materializes, or eyes change |
| **Aura & Ambient** (14) | paparazzi, money-rain, color-rain, saint-glow, fire-aura, frost-aura, shadow-aura, electricity-aura, sparkles-around, fairies-around, objects-orbit, petals-around, glow-trace, tattoo-animation | Environmental FX bound to the subject |

Two defaults round out the catalog: `auto` and `none`.

## Multi-pick

Up to 2 effects can be selected and compounded. The composer runs subject substitution per id, then joins with `", and "`. Examples:
- `["werewolf", "fire-breathe"]` with target `"Aria"` — Aria transforms AND breathes fire.
- `["wings-grow", "glowing-eyes"]` with target `"Marcus"` — Marcus grows wings AND his eyes ignite.

## Target ref name substitution

The single input handle (`target`) accepts any of:
- **Character** ref (`data.characterName` → name)
- **Face** ref (`data.faceName` → name)
- **Object** ref (`data.objectName` → name)
- **Location** ref (`data.locationName` → name)

The fallback chain is: `characterName ?? faceName ?? objectName ?? locationName ?? undefined`. If `target` is unwired, every `"the subject"` in the prompt stays as `"the subject"` and the AI model fills in based on whatever subject is in frame.

Worked example with `werewolf`, position=`middle`, duration=`long`, intensity=`dynamic`, `[Character: "Aria Voss"] → target`:

> *"Aria Voss transforms into a werewolf — fur sprouts across the skin, fangs and claws extend, the snout elongates, eyes glow yellow, body re-shapes with visible muscle and bone movement under the skin, clothing tears, the effect occurs in the middle of the clip, manifesting over approximately 3 seconds, with dynamic energy and assertive flourish"*

## Inputs & Outputs

**Inputs:**
- `in` — optional upstream parameter input.
- `target` — optional, accepts a character / face / object / location ref node for subject name substitution.

**Outputs:**
- `out` — composed prompt-hint clause, consumed by downstream AI video nodes via their `cinematography` handle.

## Supported Providers

No direct provider call. Compatibility with downstream AI video providers:

| Provider | Compatibility |
|---|---|
| VEO 3.1 | Best for transformations + powers; coherent multi-frame morphing |
| Kling 2.1 / Kling Master | Strong for body-mod + aura effects |
| Hailuo Standard / 2.3 | Good for face/expression + auras; transformations degrade |
| MiniMax | Limited transformation quality; auras work well |
| Seedance / Bytedance Lite | Hit-or-miss on transformation; auras reliable |

Some effects (gas-form, liquid-metal, X-ray) are temporally complex and degrade noticeably on cheaper models. Prefer VEO 3.1 or Kling for those.

## Best Practices

- Wire a character ref to `target` for explicit subject naming — produces more grounded, character-consistent prompts.
- Multi-pick (up to 2) for compound effects: transformation + power (werewolf + fire-breathe), body-mod + face (wings + glowing eyes).
- For 3+ compound effects, wire two Character FX nodes in parallel into the consumer's `cinematography` handle.
- Pair with Camera Motion for choreography: e.g., Hero Flight effect + crash-zoom camera motion.
- Set `intensity: crazy` for music-video moments where exaggeration is the goal; `subtle` for restrained narrative use.

## Common Use Cases

- Cinematic transformation arcs in AI-generated reels (werewolf, vampire, ghost-form).
- Action sequences with elemental powers (fire-breathe, lightning-hands, water-bending).
- Music video aura effects (money-rain, paparazzi, fire-aura, sparkles).
- Horror/supernatural moments (spiders-from-mouth, extra-eyes, oni-mask).
- Sci-fi reveals (cyborg, agent-reveal, X-ray, visor-x).

## Tips

- The composer rewrites `"the subject"` globally — apostrophe-s constructions like `"the subject's body"` become `"Aria's body"` naturally.
- The `auto` and `none` entries have empty prompt hints — they contribute nothing and are silently filtered from multi-pick selections.
- The Character FX node is automatically suppressed for still-image consumers (Edit Image, Image-to-Image, Generate Image) — character transformations are inherently temporal.
- Each catalog entry includes a lucide-react icon in the picker grid (🐺 werewolf, 🔥 fire-breathe, 🎭 oni-mask, 👁️ extra-eyes, etc.) for quick visual identification.

## Distinction from `action-fx`

- **Character FX** — the SUBJECT does/becomes X: "the subject transforms into a werewolf", "the subject breathes fire".
- **Action FX** — environmental events: "an earthquake hits the scene", "lightning strikes the building".

When in doubt: if the effect requires a character as the focal point, use Character FX. If it would make sense in an empty room, use Action FX. Both can be wired in parallel into the same consumer.

## See Also

- [Transition](./transition.md) — for visual transitions between frames or shots (different from effects on a subject).
- [Character](../assets/character.md) — the ref source for `target` handle.
- [Camera Motion](./camera-motion.md) — pairs well with Character FX for choreography.
