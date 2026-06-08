# Person

> Multi-dim picker for 21 person attributes (type, age, ethnicity, regional aesthetic, build, face shape, hair, eyes, skin, features, ...) totaling 547 catalog options. Emits a detailed person-description prompt fragment.

## Overview

The Person parameter node composes a full person description by combining up to 21 independent attribute dimensions. This is the deepest picker in the registry — built for generating recurring characters, casting briefs, or detailed portraiture. Wired to an AI image/video node's `cinematography` handle. Each sub-field is optional; empty fields are dropped silently.

## Compact vs Detailed view

The picker opens in **Compact** view by default: the 21 dimensions collapse into six labelled sections — **Identity**, **Body**, **Face**, **Hair**, **Skin & Eyes**, **Features** — each rendered as a row of grouped pills. Clicking a pill opens a popover with the rich option tiles for that dimension. A header toggle switches to **Detailed** view, which is the full inline tile-grid (one section per dimension, every option visible at once). The toggle is available everywhere the picker appears: the config side-panel, the config full-screen, and a published app's input card.

The chosen mode is a **per-device preference** (persisted in `localStorage`, default Compact) — it changes only how the picker renders. It does **not** affect the saved value or the emitted prompt fragment: Compact and Detailed write the exact same `PersonValue` and compose the identical clause.

## Configuration (21 sub-fields)

| Group | Sub-fields |
|---|---|
| **Identity** | `type`, `age`, `ethnicity`, `regionalAesthetic` |
| **Body** | `build`, `bodyProportions` |
| **Face structure** | `faceShape`, `jawline` |
| **Eyes** | `eyeShape`, `eyeColor`, `eyeState` |
| **Nose / Lips** | `nose`, `lips`, `lipState` |
| **Hair** | `hairColor`, `hairBase` |
| **Brows / Skin** | `eyebrows`, `skinTone`, `skinTexture` |
| **Other** | `facialHair`, `distinctiveFeature` |
| **Free text** | `preText`, `postText` |

Each sub-field has its own catalog of options. Example values:
- `type`: `stylish-influencer`, `business-executive`, `artist`, `athlete`, `farmer`, `nurse`, `teacher`, `child`, `elder`
- `age`: `age-early-20s`, `age-mid-30s`, `age-50s`, `age-70s`
- `ethnicity`: open-ended; example IDs encode background
- `regionalAesthetic`: `cali-beach`, `parisienne`, `kinshasa-sape` — a regional / cultural vibe that composes with ethnicity, skin, hair, and styling
- `eyeColor`: `eyes-blue`, `eyes-brown`, `eyes-green`, `eyes-amber`, `eyes-hazel`
- `hairColor`, `hairBase`: blonde, brunette, redhead; straight, wavy, curly, coiled

## Catalog

547 catalog options distributed across the 21 fields. The picker UI splits each dimension into its own tab/section for navigation.

## Inputs & Outputs

**Inputs:** `in` — optional upstream parameter input.
**Outputs:** `out` — composed prompt-hint clause, consumed by downstream AI nodes via their `cinematography` handle.

## Composition

The composer joins set sub-fields into a multi-clause description. Example with `type: "artist"`, `age: "age-mid-30s"`, `eyeColor: "eyes-green"`, `hairColor: "hair-redhead"`:

> *"mid-30s artist, green eyes, red hair"*

## Common Use Cases

- Casting brief for a character series.
- Recurring character generation (set once, reuse via parameter mapping).
- Diversity / inclusivity coverage in batch generations.

## See Also

- [Pose](./pose.md), [Styling](./styling.md), [Mood](./mood.md), [Framing](./framing.md).
- [Character (asset)](../assets/character.md) — for full reusable character references with portraits.
