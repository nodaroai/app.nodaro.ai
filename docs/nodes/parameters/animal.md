# Animal

> Pick an animal from a 126-entry catalog across subcategories (mammals, birds, reptiles, sea creatures, insects, etc.). Emits "featuring a X" prompt fragment with description.

## Overview

The Animal parameter node adds a specific animal as a featured element of a generation. Each entry includes a short description that grounds the AI model on appearance and behavior. Injected into the consumer's prompt as `"featuring a {label}, {description}"` via the `cinematography` handle.

## Configuration

| Field     | Type   | Default                  | Description                                           |
|-----------|--------|--------------------------|-------------------------------------------------------|
| animal    | string | `"dog-golden-retriever"` | Catalog entry id (e.g. `"lion"`, `"eagle"`).          |
| Pre Text  | text   | empty                    | Free-form text prepended to the composed hint.        |
| Post Text | text   | empty                    | Free-form text appended to the composed hint.         |

## Catalog (126 entries across subcategories)

| Subcategory | Examples |
|---|---|
| **Mammals (domestic)** | dog-golden-retriever, dog-poodle, cat-siamese, horse, cow, sheep |
| **Mammals (wild)** | lion, tiger, bear, wolf, fox, elephant, giraffe, zebra, gorilla |
| **Birds** | eagle, owl, parrot, peacock, flamingo, raven, sparrow, hummingbird |
| **Reptiles / Amphibians** | crocodile, iguana, gecko, python, frog, salamander |
| **Sea creatures** | dolphin, whale, shark, octopus, squid, jellyfish, manta-ray, seahorse |
| **Insects / Arachnids** | butterfly, bee, dragonfly, mantis, spider, scorpion |
| **Mythical** | dragon, phoenix, unicorn, griffin, kraken |

## Inputs & Outputs

**Inputs:** `in` — optional upstream parameter input.
**Outputs:** `out` — composed prompt-hint clause, consumed by downstream AI nodes via their `cinematography` handle.

## Common Use Cases

- Wildlife or nature scenes.
- Fantasy/storyboard creature work.
- Pet photography or commercial campaigns.
- Surreal pairings (e.g. a peacock in a corporate boardroom).

## See Also

- [Vehicle](./vehicle.md), [Weapon](./weapon.md), [Held Prop](./held-prop.md) — other featured-object pickers.
- [Setting](./setting.md) — the environment the animal inhabits.
