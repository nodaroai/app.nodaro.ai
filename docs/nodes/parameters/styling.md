# Styling

> Multi-dim picker for makeup + eyewear + headwear + hair (cut + treatment) + jewelry + nails + face-paint + fabric (262 catalog options across 9 fields). Emits a styling-descriptor prompt fragment.

## Overview

The Styling parameter node composes a full styling/wardrobe descriptor — what the subject wears and how their face/hair is done. Wired to an AI image/video node's `cinematography` handle. Each sub-field is optional; empty fields are dropped silently. Useful for fashion-editorial work, character continuity, and on-brand commercial output.

## Configuration (9 sub-fields)

| Group | Sub-fields |
|---|---|
| **Face** | `makeup`, `facePaint` |
| **Eyewear** | `eyewear` |
| **Headwear** | `headwear` |
| **Hair** | `hairCut`, `hairTreatment` |
| **Accessories** | `jewelry`, `nails` |
| **Wardrobe** | `fabric` |
| **Free text** | `preText`, `postText` |

Example values:
- `makeup`: `natural`, `glam`, `editorial`, `goth`, `clean-girl`, `90s-grunge`
- `eyewear`: `aviators`, `cat-eye-frames`, `wire-rims`, `oakleys`
- `headwear`: `beret`, `fedora`, `cowboy-hat`, `crown`, `bandana`
- `hairCut`: `bob`, `pixie`, `mohawk`, `long-loose`, `slicked-back`
- `hairTreatment`: `dyed-pastel`, `streaks`, `wet-look`, `messy-bedhead`
- `jewelry`: `gold-chains`, `pearl-necklace`, `hoop-earrings`, `signet-ring`
- `nails`: `french`, `chrome`, `long-stiletto`, `black-matte`
- `facePaint`: `tribal`, `clown-classic`, `oni-mask`, `geometric-lines`
- `fabric`: `silk`, `denim`, `velvet`, `leather`, `lace`, `tulle`

## Catalog

262 catalog options distributed across the 9 fields.

## Inputs & Outputs

**Inputs:** `in` — optional upstream parameter input.
**Outputs:** `out` — composed prompt-hint clause, consumed by downstream AI nodes via their `cinematography` handle.

## Common Use Cases

- Fashion-editorial styling direction.
- Character continuity across a story-to-video pipeline.
- Period-piece costuming (pair with Era).
- Brand-aligned styling (pair with Aesthetic).

## See Also

- [Person](./person.md), [Material](./material.md) (overlaps with `fabric`), [Aesthetic / Microtrend](./aesthetic.md), [Era / Period](./era.md).
