---
name: one-character-any-scene
description: Same person in any scene, outfit, or background — reference-token composition on generate-image; no masks, no LoRA training
triggers: ["same character different scene", "character consistency", "consistent character", "face swap", "swap the face", "keep the background change the person", "put her in another scene", "put him in another scene", "same person new outfit", "garment transfer", "try on the jacket", "replace the model"]
version: 1
---

# One Character, Any Scene — without masks or training

You are compositing ONE person's identity into new scenes, outfits, or backgrounds
using nothing but reference images and `{image:N:label}` prompt tokens on
`generate-image`. No masks, no face nodes, no LoRA training — the reference images
carry the identity, and the tokens tell the model what to take from each.

The whole method is: **two source images → one `generate-image` per desired output,
both sources wired into its `references` handle, prompt made of tokens.**

## Hard rules (violating any one breaks the method)

- **The prompt is tokens plus glue words — nothing else.** `{image:1:person} with
  {image:2:face}` is a complete prompt. Do NOT re-describe the person, the outfit,
  or the scene in words: a sentence fighting a reference degrades adherence. Add
  words only for what NO reference shows (a new pose, new lighting).
- **Connection order IS the numbering.** The first reference wired into
  `references` is `{image:1:…}`, the second is `{image:2:…}`. Swapping the numbers
  (or the labels) swaps the result — that is a feature, not a bug.
- **Order = priority.** Wire the identity-critical image FIRST when identity
  matters most; wire the stage/background first when the scene must win.
- **Multi-reference providers only.** Use `gpt-image-2` or the Nano Banana family
  (`nano-banana-pro`). Set an explicit `aspectRatio` and `resolution: "2K"` —
  face detail survives the composite better at 2K.
- **Each combination is its OWN `generate-image` node.** Never try to get two
  different composites out of one node — one node, one prompt, one result.

## Phase 0 — Ask first

Before building, confirm with the user:
1. **Where do the two sources come from?** An existing photo they will upload
   (an `upload-image` node — they attach their file, or you set `assetId` from
   their `[references]` line) vs. a generated model shot (a `generate-image`
   with a normal descriptive prompt).
2. **Which combinations do they want?** (face onto body · person into scene ·
   scene keeps, person swaps · outfit transfer). Each is one node.
3. **Aspect ratio** for the outputs (default 16:9 if they have no opinion).

## Phase 1 — The two sources

Build exactly two source nodes:

- **Source A** — the "stage" or the "body": a `generate-image` with a plain
  descriptive prompt (e.g. a model on a runway), or an `upload-image`.
- **Source B** — the identity reference: almost always an `upload-image` of the
  user's own photo (face, outfit, and/or location in one frame).

Run the generated source (the user runs it) before judging combinations — the
composite can only be as good as its inputs.

## Phase 2 — The combinations

One `generate-image` node per requested output. Wire BOTH sources into its
`references` handle — Source A first, Source B second (so A is `{image:1}`,
B is `{image:2}`) — and set the prompt to the matching pattern:

| Goal | Prompt |
|---|---|
| Face from B on the body/scene of A | `{image:1:person} with {image:2:face}` |
| The reverse transplant | `{image:2:person} with {image:1:face}` |
| Keep A's stage, put B's person on it | `{image:1:background} with {image:2:person}` |
| Put A's person into B's location | `{image:1:person} in {image:2:settings}` |
| A's person wearing B's garment, in B's location | `{image:1:person} Wearing {image:2:jacket} on top, at {image:2:settings}` |

Notes:
- Several labels can pull DIFFERENT things from the SAME image (`{image:2:jacket}`
  and `{image:2:settings}` in one prompt).
- Labels are free-form semantic roles: `person`, `face`, `background`, `settings`,
  or a concrete garment/prop word. Pick the word that names what to take.
- A token whose number has no wired reference stays as literal text in the final
  prompt — if the output shows a literal `{image:3:…}`, fix the numbering or the
  wiring; do not ignore it.
- Exact prompt lines and more variations: `references/prompts.md` (load with
  `get_recipe` + `file`).

## Phase 3 — Run, judge, iterate

- The user runs the combination nodes (propose the run; never start it yourself).
- Judge identity first (is it the same face?), then composition. If identity
  drifts, move the identity image to position 1 and reword the token roles —
  do not add descriptive sentences about the face.
- **Content-policy rejections are a known behavior of this method**: person+face
  merges intermittently trip provider safety filters. On a "Content policy
  violation", keep the tokens and neutralize the glue words (no glamor/body
  emphasis), or switch provider between `gpt-image-2` and `nano-banana-pro` —
  do not retry unchanged.

## Extending the method

- More scenes for the same identity = more combination nodes reusing the SAME
  Source B. Identity stays consistent because the reference does.
- The composite's output is itself a valid Source A for a second-generation
  composite (e.g. relocate the transplanted person).
- To animate a finished composite, feed it to `image-to-video` / `generate-video`
  as the start frame — see that node's own skill for reference rules there.
