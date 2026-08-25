---
name: product-photoshoot
description: A full ad campaign from ONE product image — nine ad archetypes fanned out from a single shared reference, with two intake paths depending on whether the photo is your product or only inspiration
triggers: ["product photoshoot", "product ads", "ads for my product", "product ad campaign", "make something similar to this product", "product marketing shots", "turn my product photo into ads", "recreate a product I saw"]
version: 1
---

# Product Photoshoot

One product image becomes a whole campaign: hero shot, posters, a comparison
ad, a flat-lay, a billboard, a technical breakdown. The campaign half of the
graph is identical either way; what changes is HOW the product enters it.

## The fork — settle this before wiring anything

**Is the photo YOUR product, or only something you want yours to look like?**

- **Yours (the user sells this exact item)** → Path A. The photo IS the ground
  truth: it feeds every shot as a reference. Never re-generate the product
  first — a re-generation drifts logos, stitching, proportions, and every shot
  after it inherits the drift.
- **Not yours (a look-reference — something the user saw and wants their own
  take on)** → Path B. The foreign photo must NOT be wired into any generate
  node. It is described into editable text, the text is rewritten into the
  user's OWN product, that product is generated once, and the RENDER becomes
  the campaign reference.

The user often answers implicitly: "ads for my product" is Path A; "make
something like this" about a photo they found is Path B. When it is genuinely
ambiguous, ask — the two graphs are not interchangeable.

## Path A — your product (photo = ground truth)

`upload-image` (the product photo) wired `image → references` into EVERY
shot's `generate-image`. Each shot also gets its own `text-prompt` wired
`prompt → prompt`. That is the whole graph.

## Path B — inspired by a product you do not own

1. `upload-image` (the found photo) wired `image → image` into
   `image-to-text` with `detailLevel: "structured"` — structured mode returns
   labeled sections (subject, colors, lighting, mood, details) that can be
   edited surgically.
2. `image-to-text` wired `text → in` into a `text-prompt` node. **The edit
   happens here and it is the point of the path:** swap the brand identity for
   the user's own, change the colorway, materials, distinguishing details. The
   result must read as the user's product that shares a vibe — inspired-by,
   not a copy.
3. That `text-prompt` wired `prompt → prompt` into ONE `generate-image` — the
   hero recreation. Prompt-only: nothing on its `references` input. Use a
   photoreal model (imagen4 is a good default) with an explicit aspect ratio.
4. The hero node's `image → references` into every shot, exactly like Path A's
   upload.

**Hard rule: the foreign photo touches ONLY the describe node.** The text in
the middle is the firewall — everything the campaign inherits has passed
through an edit the user controls.

## The fan-out (both paths end here)

One reference, many shots. Each ad concept is its own `text-prompt` +
`generate-image` pair, and all the shot nodes share the SAME reference source.

- Model: gpt-image-2 for the shots — ad layouts are typography-heavy and it
  renders headlines legibly. `resolution: "2K"` for poster-grade frames.
- Keep the product wording in every shot prompt CONSISTENT with the reference
  (same colorway, same product type) so the text reinforces the image instead
  of fighting it. For an exact take, `the exact product in {image:1}` works
  here like in any reference workflow (see the generate-image node skill).
- One aspect ratio across the campaign unless placements differ (16:9 default,
  9:16 for story placements).

Nine proven ad archetypes with prompt skeletons: `references/shot-list.md`.
Offer them as a menu — most users want three to five shots, not all nine.

## Phase 0 — ask first

1. The fork question, unless already answered.
2. Product name plus any headline copy to bake into typography shots (text the
   model must render verbatim goes in quotes inside the prompt).
3. Which archetypes, how many shots, aspect ratio.
4. Path B only: what must CHANGE from the inspiration (brand cues, colors,
   materials) — write those into the description edit.

## Debugging

- Product looks different in every shot → the shots are not sharing one
  reference source, or a shot prompt contradicts the reference's colorway.
- Path B result too close to the original → the description edit did not
  change enough; push the identity swaps harder in the text node.
- Headline garbled → put the exact copy in quotes, keep it short, and rerun
  just that shot.
- The wrong product entered the campaign → re-check the fork: a foreign photo
  wired straight into `references` is the classic mistake this recipe exists
  to prevent.
