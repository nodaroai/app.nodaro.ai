# Action FX

> Pick environmental action effects (multi-pick, up to 5) from a 72-entry catalog. Emits a scene-event prompt fragment.

## Overview

The Action FX parameter node describes environmental events that happen WITHIN a scene — earthquake, lightning strike, explosion, falling objects, smoke billowing, etc. Distinct from Character FX (which affects the subject directly): Action FX would make sense in an empty room. Multi-pick lets you compound up to 5 simultaneous effects. Injected into the consumer's prompt via the `cinematography` handle.

## Configuration

| Field     | Type         | Default | Description                                                                                        |
|-----------|--------------|---------|----------------------------------------------------------------------------------------------------|
| actionFx  | multi-select | `auto`  | Catalog entry id(s) — up to 5 entries for compound effects.                                        |
| Pre Text  | text         | empty   | Free-form text prepended to the composed hint.                                                     |
| Post Text | text         | empty   | Free-form text appended to the composed hint.                                                      |

## Catalog (72 entries)

Examples: `earthquake-tremor`, `earthquake-violent`, `lightning-strike`, `lightning-cluster`, `thunder-crack`, `explosion-fire`, `explosion-shockwave`, `falling-objects`, `falling-debris`, `glass-shatter`, `wall-collapse`, `tree-fall`, `wave-crash`, `flood-rising`, `volcano-eruption`, `tornado`, `dust-storm`, `meteor-impact`, `fire-engulfing`, `smoke-billow`, `mist-roll`, ...

## Inputs & Outputs

**Inputs:** `in` — optional upstream parameter input.
**Outputs:** `out` — composed prompt-hint clause, consumed by downstream AI video nodes via their `cinematography` handle.

## Notes

- Action FX is automatically suppressed for still-image consumers (Generate Image, Edit Image, Image-to-Image, Location) — environmental events are inherently temporal.
- For 6+ compound effects, wire two Action FX nodes in parallel into the consumer's `cinematography` handle.

## Common Use Cases

- Disaster sequences (earthquake + glass-shatter + dust-storm).
- Action-movie beats (explosion-fire + flying-debris + shockwave).
- Atmospheric world-building (smoke-billow + mist-roll).

## Distinction from Character FX

- **Action FX** — environmental: "lightning strikes the building", "an earthquake hits the scene".
- **Character FX** — subject-focused: "the subject transforms into a werewolf", "the subject breathes fire".

Both can be wired into the same consumer in parallel.

## See Also

- [Character FX](./character-fx.md), [Atmosphere](./atmosphere.md), [Camera Motion](./camera-motion.md).
