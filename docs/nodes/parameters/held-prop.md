# Held Prop

> Pick a held prop from a 59-entry catalog (smartphone, umbrella, bouquet, briefcase, ...). Emits a held-prop prompt fragment.

## Overview

The Held Prop parameter node names a non-weapon object the subject carries or interacts with — phone, umbrella, bouquet, briefcase, coffee cup, etc. Adds narrative texture without dominating the composition. Injected into the consumer's prompt via the `cinematography` handle.

## Configuration

| Field     | Type   | Default        | Description                                            |
|-----------|--------|----------------|--------------------------------------------------------|
| heldProp  | string | `"smartphone"` | Catalog entry id (e.g. `"umbrella"`, `"bouquet"`).     |
| Pre Text  | text   | empty          | Free-form text prepended to the composed hint.         |
| Post Text | text   | empty          | Free-form text appended to the composed hint.          |

## Catalog (59 entries across categories)

| Category | Examples |
|---|---|
| **Everyday** | smartphone, laptop, coffee-cup, water-bottle, umbrella, wallet, keys, sunglasses |
| **Bags / Carry** | tote-bag, backpack, duffel, briefcase, purse, suitcase |
| **Food / Drink** | wine-glass, champagne-flute, lollipop, ice-cream, sandwich, bouquet |
| **Tools / Work** | clipboard, notebook, paintbrush, hammer, camera, microphone, megaphone |
| **Leisure / Sport** | tennis-racket, golf-club, surfboard, skateboard, basketball, fishing-rod |
| **Romantic / Ceremonial** | flower-bouquet, ring-box, candle, balloon, gift-box |

## Inputs & Outputs

**Inputs:** `in` — optional upstream parameter input.
**Outputs:** `out` — composed prompt-hint clause, consumed by downstream AI nodes via their `cinematography` handle.

## Common Use Cases

- Add narrative context to a portrait (briefcase = professional, bouquet = romantic).
- Commercial/product photography integration.
- Storyboard prop direction.

## See Also

- [Weapon](./weapon.md) — for weapon props.
- [Pose](./pose.md) — for how the prop is held.
- [Person](./person.md) — multi-dim subject attributes.
