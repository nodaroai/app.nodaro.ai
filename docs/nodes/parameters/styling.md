# Styling

> Multi-dim picker for makeup + eyewear + headwear + hair (cut + treatment) + jewelry + nails + face-paint + fabric (274 catalog options across 9 fields). Emits a styling-descriptor prompt fragment.

## Overview

The Styling parameter node composes a full styling/wardrobe descriptor — what the subject wears and how their face/hair is done. Wired to an AI image/video node's `cinematography` handle. Each sub-field is optional; empty fields are dropped silently. Useful for fashion-editorial work, character continuity, and on-brand commercial output.

## The picker

Every setting is laid out open with its options, grouped under four topics — **Beauty & Hair**, **Accessories**, **Wardrobe**, **Fabric & Fit** — each with its own heading and pick count. A row of topic buttons at the top jumps to a topic, and the search box looks across every topic. Every option is shown with its own photo, the same one the node card on the canvas shows; a few options added after the photos were made show their drawn icon instead. Settings that allow several picks (headwear, jewelry, hair state, wardrobe state) list every pick on the node card.

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
| **Prompt hint** | `hintMode` |

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

274 catalog options distributed across the 9 fields.

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
