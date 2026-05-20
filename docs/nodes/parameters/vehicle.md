# Vehicle

> Pick a vehicle from a 107-entry catalog across subcategories (car, truck, motorcycle, boat, aircraft, spaceship, etc.). Emits "featuring a X" prompt fragment with description.

## Overview

The Vehicle parameter node adds a specific vehicle as a featured element of a generation. Each entry includes a short description that grounds the AI model on era, body style, and key features. Injected into the consumer's prompt as `"featuring a {label}, {description}"` via the `cinematography` handle.

## Configuration

| Field     | Type   | Default   | Description                                         |
|-----------|--------|-----------|-----------------------------------------------------|
| vehicle   | string | `"sedan"` | Catalog entry id (e.g. `"motorcycle"`, `"jet"`).    |
| Pre Text  | text   | empty     | Free-form text prepended to the composed hint.      |
| Post Text | text   | empty     | Free-form text appended to the composed hint.       |

## Catalog (107 entries across subcategories)

| Subcategory | Examples |
|---|---|
| **Cars** | sedan, hatchback, coupe, convertible, suv, muscle-car, sports-car, supercar, hot-rod, vintage-30s, vintage-50s |
| **Trucks / Utility** | pickup-truck, semi-truck, monster-truck, delivery-van, ambulance, fire-truck, garbage-truck |
| **Two-wheel** | motorcycle, sport-bike, cruiser-bike, dirt-bike, scooter, bicycle, e-bike |
| **Off-road** | atv, dune-buggy, dirt-buggy, snowmobile |
| **Water** | sailboat, yacht, speedboat, jet-ski, kayak, canoe, gondola, fishing-boat |
| **Aircraft** | passenger-jet, prop-plane, fighter-jet, helicopter, glider, biplane, hot-air-balloon |
| **Rail / Transit** | steam-train, freight-train, bullet-train, subway, tram, monorail |
| **Sci-fi / Future** | spaceship, escape-pod, hover-bike, mech-suit, ufo |
| **Historical** | horse-carriage, chariot, viking-longship, galleon, gondola, tuk-tuk |

## Inputs & Outputs

**Inputs:** `in` — optional upstream parameter input.
**Outputs:** `out` — composed prompt-hint clause, consumed by downstream AI nodes via their `cinematography` handle.

## Common Use Cases

- Automotive product/lifestyle photography.
- Action and chase scenes.
- Period drama (vintage cars, carriages, ships).
- Sci-fi world-building.

## See Also

- [Animal](./animal.md), [Weapon](./weapon.md), [Held Prop](./held-prop.md) — other featured-object pickers.
- [Era / Period](./era.md) — pair for period-appropriate vehicle eras.
