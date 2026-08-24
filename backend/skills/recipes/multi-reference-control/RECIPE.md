---
name: multi-reference-control
description: Compose ONE image from up to five reference images, each contributing something different — person, garment, place, a painted detail — with attribute-level control and explicit exclusions
triggers: ["combine multiple references", "take the jacket from", "mix elements from several images", "the hat from one image and the jacket from another", "compose from references", "five references", "attribute from another image", "same color as the shirt in"]
version: 1
---

# Multi-Reference Control

Several source images feed ONE `generate-image`; each contributes something
different: who the person is, where they stand, what they wear, a detail painted
on one cheek. You are not describing a scene in words and hoping — you point at
an image and say "that jacket, that hat, that spot".

This is the advanced tier of the `{image:N}` idiom (the basics — two references,
identity transplants — are the `one-character-any-scene` recipe; read the
generate-image node skill for the token grammar).

## Hard rules

- **The number is a POSITION, not a name.** All references feed the SAME
  `references` handle; `{image:3}` means "the third-connected reference",
  whatever its node is labeled. The order comes from connection order and can be
  reordered on the node itself. When the wrong element lands in the wrong place,
  CHECK THE ORDER before rewriting the prompt.
- **Swapping a source keeps the prompt working** — tokens point at positions,
  not files. Replacing reference 4's upload changes the jacket, not the prompt.
- **One attribute or the whole thing — say which.** "the exact jacket worn by
  {image:4}" takes the garment; "a shirt in the same color as {image:5} shirt"
  takes ONE attribute (color) and nothing else. Be precise about the take.
- **Explicit DON'Ts are load-bearing.** "standing in the same spot where
  {image:5} is standing, but NOT in her pose" — saying what NOT to take is as
  important as saying what to take. Without the exclusion, the pose leaks in
  with the location.
- **A detail can be constrained spatially**: "On {image:1} right cheek only,
  apply the face-paint design seen on {image:3} cheeks. His left cheek must
  remain completely free of face paint."
- **Model must accept several reference images at once** — gpt-image-2 (or the
  Nano Banana family), `resolution: "2K"`, explicit `aspectRatio`. Do not
  attempt five references on a single-reference model.

## The graph

Up to five `upload-image` nodes (or generated sources) → one `generate-image`,
all wired into `references` in a DELIBERATE order: put the identity (the person)
first, then the sources you take objects/attributes from, scene/location last.
Prompt = token-bound sentences, one clause per contribution.

A worked prompt with a clause-by-clause reading: `references/prompt-walkthrough.md`.

## Phase 0 — Ask first

1. Which images, and what each one CONTRIBUTES (person / garment / object /
   place / detail). Write the wiring order from that answer: person first.
2. Anything that must NOT carry over (a pose, a background, a color).
3. Aspect ratio + resolution (default 16:9 / 2K).

## Debugging the composite

- Wrong element in the wrong place → reference order, not prompt.
- An attribute came with baggage (whole outfit instead of the color) → narrow
  the clause to the attribute and add the exclusion.
- Identity drifted → move the person's image to position 1; never compensate by
  describing their face in words.
- To feel what one reference contributes: change it, rerun, compare.
