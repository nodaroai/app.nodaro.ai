# Reference Boards & Consistency Grids — Which Model for What

Nodaro's **Generate Image** node ships a family of factory presets for *identity consistency* —
keeping the same person, pet, product, or place recognizable across every generation in a project.
This guide explains the two families, which model each one uses, and the head-to-head experiment
behind those defaults so you can make your own trade-offs.

## The two families

| | **Reference Sheet boards** | **Cast & Consistency grids** |
|---|---|---|
| Presets | Character, Pose, Location, Product, Outfit, Scene, Creature, Vehicle, Food, Mascot, Pet Board | Character Reference Grid, Cast Mega Grid, Cast Scene |
| What they make | A dense, editorial production sheet: hero shot, metadata block, labeled panels (views, expressions, details, lighting), HEX color palette | A sterile, neutral-background grid of canonical angles — no text, no decoration |
| Made for | **Humans** — art direction, briefing, a project's visual bible | **Models** — feeding back into later generations as an identity anchor |
| Default model | `gpt-image-2` @ 2K, 16:9 | `gpt-image-2` @ 4K, 3:4 |

Both follow the same workflow: **connect one sharp, well-lit, front-facing photo** → generate →
**reuse the result as a reference image** in every later generation (image or video) featuring that
subject. For multi-character work, build one **Cast Mega Grid** (2–4 characters as labeled strips in
a single image), then stage scenes that reference cast members **by the names on the grid** without
re-describing them — less re-description means less identity drift.

## Which model should you use?

| Job | Use | Why |
|---|---|---|
| Any Reference Sheet board | `gpt-image-2` (default) | Dense boards with a faithful face, every requested panel, and clean labels and HEX swatches |
| Identity grids to feed back as references | `gpt-image-2` (default) | Built the cleanest four-angle grid and kept both identities on the two-person cast sheet; 4K keeps panel faces sharp when reused |
| A board at a ratio GPT Image 2 can't draw (2:3, 21:9, 3:2) | `gpt-image-2-5-sunburst` | The same family's precision model, with a wider ratio set |
| Fast, cheap iteration before a final board | `nano-banana-2-1` | Strong for its price; switch to `gpt-image-2` for the board you keep |

## The October 2026 comparison (current defaults)

The defaults above come from a blind comparison on 2026-10-08: GPT Image 2, GPT Image 2.5 Flare,
GPT Image 2.5 Sunburst, Nano Banana Pro and Nano Banana 2.1 on the same prompts and source photos,
including the exact Character Reference Grid, Cast Mega Grid and Character Board presets. One
generation per cell, so treat single results as directional; the pattern across prompts is what
counts.

- **GPT Image 2 produced the best reference grid and character board**, kept both identities on
  the cast sheet, and was the cleanest on exact text.
- **Nano Banana Pro was the weakest on these presets.** It broke the four-panel grid layout,
  dropped a name label on the cast sheet and changed an outfit.
- **Nano Banana 2.1 labelled the cast sheet correctly** and is a good, cheaper choice for drafts.

That reverses the identity result of the June test below, which compared fewer models with
different prompts. The board prompts still carry the never-merge-panels clause that came out of
the June run.

## The earlier experiment (June 2026)

We ran the same prompts with the same source photos head-to-head (June 2026, one generation per
cell — treat as directional, not statistical):

- **Test 1 — Character Board:** `nano-banana-pro` vs `gpt-image-2`, both 2K / 16:9
- **Test 2 — Clean Reference Grid:** `nano-banana-2` vs `gpt-image-2`, both 4K / 3:4
- **Test 3 — Cast Mega Grid (2 people):** `nano-banana-2` vs `gpt-image-2`, both 4K / 3:4

### What we found

1. **Identity fidelity is the differentiator — the Nano Banana family wins it.** Across all three
   tests, `nano-banana-pro` / `nano-banana-2` reproduced the *same person* from the source photo
   (face shape, stubble pattern, freckles, fabric texture). `gpt-image-2` consistently produced a
   convincing *casting double* — similar, attractive, clearly inspired by the source, but visibly
   not the same face. For a preset whose entire job is identity anchoring, that decides it.

2. **Both render text cleanly now.** No garbled labels, no misspelled headings on either model —
   the old "use GPT for anything with text" rule no longer holds at these tiers. `nano-banana-pro`
   went further: its color palette had *named* swatches with HEX values that matched the actual
   outfit and skin tones.

3. **`gpt-image-2` follows layout instructions most completely.** It rendered every requested
   panel heading and the most uniform panel sizing; `nano-banana-pro` merged one panel heading into
   a neighbor on its run. The factory board prompts now include an explicit *"render ALL panel
   headings, never merging or omitting a panel"* clause to close that gap.

4. **Resolution and speed are not equal at the same setting.** At "2K", `nano-banana-pro` returned
   2752×1536 while `gpt-image-2` returned 2048×1152 — and GPT took ~1.8× longer on the dense board
   (210s vs 118s). The cheaper-per-image model is not cheaper per usable pixel.

5. **No identity blending on multi-character grids.** Both models kept the two cast members
   cleanly separated in their labeled strips with correctly spelled names — the Cast Mega Grid
   technique is robust across providers.

## Practical tips

- **The source photo is the #1 quality lever.** Sharp, evenly lit, front-facing, one subject. A
  soft or filtered photo is the most common cause of distorted or drifting faces.
- **Regenerate, don't settle.** If a face drifts on a board, regenerate the board — don't carry a
  drifted board forward as a reference. Two or three takes usually lands a clean one.
- **Feed the board back.** A board only pays off when you attach it as a reference image to later
  generations — including video (the *Scene Recipes* presets in Generate Video are built to consume
  these boards).
- **Boards for people, grids for machines.** The editorial styling on a board (dark background,
  neon accents, labels) is noise when a model consumes it as a reference; that's exactly why the
  clean grids exist. When in doubt: show the board to your team, feed the grid to the model.

See the [factory preset catalog](./nodes/presets.md) for the full list of boards, grids, and the
Scene Recipes that consume them.
