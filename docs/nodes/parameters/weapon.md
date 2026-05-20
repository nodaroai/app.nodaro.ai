# Weapon

> Pick a weapon from an 85-entry catalog across subcategories (blade, ranged, firearm, fantasy, sci-fi, etc.). Emits "with a X" prompt fragment with description.

## Overview

The Weapon parameter node adds a specific weapon as a held or featured element of a generation. Each entry includes a short description that grounds the AI model on appearance and historical/genre context. Injected into the consumer's prompt as `"with a {label}, {description}"` via the `cinematography` handle.

Useful for action, fantasy, period, and sci-fi content. Catalog avoids gratuitous detail; descriptions focus on form and silhouette.

## Configuration

| Field     | Type   | Default    | Description                                              |
|-----------|--------|------------|----------------------------------------------------------|
| weapon    | string | `"katana"` | Catalog entry id (e.g. `"longbow"`, `"lightsaber"`).     |
| Pre Text  | text   | empty      | Free-form text prepended to the composed hint.           |
| Post Text | text   | empty      | Free-form text appended to the composed hint.            |

## Catalog (85 entries across subcategories)

| Subcategory | Examples |
|---|---|
| **Blades** | katana, longsword, broadsword, rapier, scimitar, kukri, dagger, machete |
| **Polearms** | spear, halberd, naginata, glaive, trident |
| **Bows / Ranged** | longbow, recurve-bow, compound-bow, crossbow, slingshot |
| **Firearms (historical)** | flintlock-pistol, blunderbuss, musket, revolver |
| **Firearms (modern)** | pistol, shotgun, rifle, hunting-rifle |
| **Fantasy** | warhammer, battle-axe, claymore, mace, scythe, enchanted-staff |
| **Sci-fi** | lightsaber, blaster, plasma-rifle, energy-bow, gauntlet-cannon |
| **Improvised / Tactical** | baseball-bat, crowbar, throwing-knife |

## Inputs & Outputs

**Inputs:** `in` — optional upstream parameter input.
**Outputs:** `out` — composed prompt-hint clause, consumed by downstream AI nodes via their `cinematography` handle.

## Common Use Cases

- Action sequences and combat staging.
- Period drama (medieval, samurai, wild-west).
- Fantasy/sci-fi character work.
- Game cinematic / promotional assets.

## See Also

- [Held Prop](./held-prop.md) — for non-weapon held objects.
- [Pose](./pose.md), [Character FX](./character-fx.md) — character-driven choreography.
- [Era / Period](./era.md) — for period-appropriate weapon eras.
