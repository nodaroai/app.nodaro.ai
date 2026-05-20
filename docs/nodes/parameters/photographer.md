# Photographer / Artist

> Pick from a 67-entry catalog of photographers, directors, illustrators, painters, and visual artists. Emits a "style of X" prompt fragment.

## Overview

The Photographer / Artist parameter node grounds the visual style of a generation in the signature of a specific creator — a photographer (Tim Walker, Annie Leibovitz, Henri Cartier-Bresson), a cinematographer (Roger Deakins, Emmanuel Lubezki), an illustrator or painter (Studio Ghibli, Greg Rutkowski, Norman Rockwell). The selected entry becomes a natural-language style clause injected into the consumer's prompt via the `cinematography` handle.

## Configuration

| Field        | Type   | Default        | Description                                                                              |
|--------------|--------|----------------|------------------------------------------------------------------------------------------|
| photographer | string | `"tim-walker"` | Catalog entry id (e.g. `"deakins"`, `"ghibli"`, `"rutkowski"`).                          |
| Pre Text     | text   | empty          | Free-form text prepended to the composed hint.                                           |
| Post Text    | text   | empty          | Free-form text appended to the composed hint.                                            |

## Catalog (67 entries across 5 categories)

| Category | Examples |
|---|---|
| **Photographers** | Tim Walker, Annie Leibovitz, Henri Cartier-Bresson, Steve McCurry |
| **Cinematographers** | Roger Deakins, Emmanuel Lubezki, Christopher Doyle, Vittorio Storaro |
| **Illustrators** | Greg Rutkowski, Moebius, Norman Rockwell, Jean Giraud |
| **Painters** | Caravaggio, Vermeer, Hopper, Klimt |
| **Studios** | Studio Ghibli, Pixar, Disney, Aardman |

## Inputs & Outputs

**Inputs:** `in` — optional upstream parameter input.
**Outputs:** `out` — composed prompt-hint clause, consumed by downstream AI nodes via their `cinematography` handle.

## Common Use Cases

- Anchor a generation in a recognizable visual canon (Ghibli-esque, Deakins-lit).
- Mix with Style or Aesthetic for hybrid signatures.
- Maintain a consistent creator-style across a project's batch of shots.

## See Also

- [Style](./style.md), [Aesthetic / Microtrend](./aesthetic.md), [Era / Period](./era.md).
