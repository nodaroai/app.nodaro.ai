# Person

> Multi-dim picker for 20 person attributes (type, age, ethnicity, build, face shape, hair, eyes, skin, features, ...) totaling 547 catalog options. Emits a detailed person-description prompt fragment.

## Overview

The Person parameter node composes a full person description by combining up to 20 independent attribute dimensions. This is the deepest picker in the registry — built for generating recurring characters, casting briefs, or detailed portraiture. Wired to an AI image/video node's `cinematography` handle. Each sub-field is optional; empty fields are dropped silently.

## Configuration (20 sub-fields)

| Group | Sub-fields |
|---|---|
| **Identity** | `type`, `age`, `ethnicity` |
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
- `eyeColor`: `eyes-blue`, `eyes-brown`, `eyes-green`, `eyes-amber`, `eyes-hazel`
- `hairColor`, `hairBase`: blonde, brunette, redhead; straight, wavy, curly, coiled

## Catalog

547 catalog options distributed across the 20 fields. The picker UI splits each dimension into its own tab/section for navigation.

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
