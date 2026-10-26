# Photographer / Artist

> Pick from a 93-entry catalog of photographers, cinematographers, film directors, illustrators and visual artists, each with an example picture. Emits a "style of X" prompt fragment.

## Overview

The Photographer / Artist parameter node grounds the visual style of a generation in the signature of a specific creator — a photographer (Tim Walker, Annie Leibovitz, Henri Cartier-Bresson), a cinematographer (Roger Deakins, Emmanuel Lubezki), an illustrator or painter (Studio Ghibli, Greg Rutkowski, Norman Rockwell). The selected entry becomes a natural-language style clause injected into the consumer's prompt via the `cinematography` handle.

## Configuration

| Field        | Type   | Default        | Description                                                                              |
|--------------|--------|----------------|------------------------------------------------------------------------------------------|
| photographer | string | `"tim-walker"` | Catalog entry id (e.g. `"deakins"`, `"ghibli"`, `"rutkowski"`).                          |
| Pre Text     | text   | empty          | Free-form text prepended to the composed hint.                                           |
| Post Text    | text   | empty          | Free-form text appended to the composed hint.                                            |
| Hint mode      | select   | `full`           | Which fragment this picker injects downstream — `full` = the long descriptive hint, `compact` = the short professional term. See [Prompt hint mode](./README.md#prompt-hint-mode). |

## Catalog (93 entries across 6 categories)

| Category | Examples |
|---|---|
| **Editorial / Fashion** | Tim Walker, Annie Leibovitz, Paolo Roversi, Helmut Newton |
| **Documentary / Street** | Henri Cartier-Bresson, Vivian Maier, Saul Leiter, Robert Capa |
| **Cinematographer** | Roger Deakins, Emmanuel Lubezki, Hoyte van Hoytema, Gordon Willis, Vittorio Storaro, Darius Khondji |
| **Film Director** | Wes Anderson, Wong Kar-wai, Christopher Nolan, Denis Villeneuve, Stanley Kubrick, David Fincher, Hayao Miyazaki, Sofia Coppola |
| **Concept / Digital** | Greg Rutkowski, WLOP, Ruan Jia, Ismail Inceoglu |
| **Illustrator / Animator** | Studio Ghibli, Alphonse Mucha, Makoto Shinkai, Charlie Bowater |

Every entry shows an example picture: the same scene (a woman in a red coat on a small-town
train platform at dusk, for the cinematographers and directors; a portrait in a plain white shirt
for the others) rendered in that creator's signature, so two entries compare side by side.

## Inputs & Outputs

**Inputs:** `in` — optional upstream parameter input.
**Outputs:** `out` — composed prompt-hint clause, consumed by downstream AI nodes via their `cinematography` handle.

## Common Use Cases

- Anchor a generation in a recognizable visual canon (Ghibli-esque, Deakins-lit).
- Mix with Style or Aesthetic for hybrid signatures.
- Maintain a consistent creator-style across a project's batch of shots.

## See Also

- [Style](./style.md), [Aesthetic / Microtrend](./aesthetic.md), [Era / Period](./era.md).
