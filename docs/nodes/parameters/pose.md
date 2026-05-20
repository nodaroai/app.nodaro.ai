# Pose

> Pick a pose from an 81-entry catalog across categories (standing, sitting, action, dynamic). Emits a pose-descriptor prompt fragment.

## Overview

The Pose parameter node describes the physical posture of the subject in a generation — standing, sitting, reclining, action poses, dance moves, contemplative gestures. Injected into the consumer's prompt via the `cinematography` handle. Useful for portraiture, fashion, character-driven scenes.

## Configuration

| Field     | Type   | Default              | Description                                                    |
|-----------|--------|----------------------|----------------------------------------------------------------|
| pose      | string | `"standing-upright"` | Catalog entry id (e.g. `"sitting-crossed"`, `"running"`).      |
| Pre Text  | text   | empty                | Free-form text prepended to the composed hint.                 |
| Post Text | text   | empty                | Free-form text appended to the composed hint.                  |

## Catalog (81 entries across categories)

| Category | Examples |
|---|---|
| **Standing** | standing-upright, standing-contrapposto, hands-on-hips, arms-crossed, hands-in-pockets |
| **Sitting / Reclining** | sitting-cross-legged, sitting-chair, reclining, lounging, kneeling |
| **Action** | running, jumping, walking, climbing, dancing, fighting-stance |
| **Dynamic / Expressive** | leaping, mid-spin, throwing, reaching, falling, contortion |
| **Contemplative** | hand-on-chin, head-tilted, eyes-closed, looking-up, looking-down |
| **Interaction** | embracing, holding-hands, leaning-against, pointing |

## Inputs & Outputs

**Inputs:** `in` — optional upstream parameter input.
**Outputs:** `out` — composed prompt-hint clause, consumed by downstream AI nodes via their `cinematography` handle.

## Common Use Cases

- Fashion / portrait photography pose direction.
- Action-scene blocking (running, jumping, fighting).
- Character-design exploration.

## See Also

- [Person](./person.md) — multi-dim subject attributes.
- [Styling](./styling.md) — costume, makeup, jewelry, etc.
- [Framing](./framing.md) — shot size and angle.
