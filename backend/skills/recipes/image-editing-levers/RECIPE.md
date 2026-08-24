---
name: image-editing-levers
description: One high-res base image fanned into parallel modify-image edits — surgical text instructions, picker-driven looks through the cinematography handle, background swaps with lighting match, a critic gate, and a collage contact sheet
triggers: ["edit this image", "change the jacket color", "relight the image", "make it anime", "change the style of the photo", "remove the background", "replace the background", "variations of one image", "golden hour version", "image editing"]
version: 1
---

# Image Editing Levers

One base image, many parallel edits — each `modify-image` node pulls a DIFFERENT
lever. The base is generated once at high resolution and fans out to every edit,
so all variants inherit the same source quality and stay comparable.

## Hard rules

- **Generate the base at the highest resolution the provider offers (4K on
  gpt-image-2).** Every edit downstream inherits it; a cheap base caps every
  variant. Give the base a real negative prompt (text, watermark, extra people,
  plastic skin) — flaws in the base repeat in all edits.
- **One lever per node.** A `modify-image` node does ONE thing: a color change,
  OR a lighting look, OR a style. Wanting two changes = two nodes (or one node
  fed by the other's output). Never pile levers into one prompt.
- **Surgical text edits name the change AND freeze the rest**: "Change the
  mustard-yellow jacket to deep navy wool. Keep everything else identical." The
  second sentence is not politeness — without it the model re-imagines freely.
- **Pickers drive edits through the `cinematography` handle with an EMPTY
  prompt.** Wire a Lighting / Color-Look / Style / Era / Lens parameter node
  into `modify-image`'s `cinematography` input and leave `prompt` empty — the
  picker supplies the instruction. Two picker nodes can stack on the same
  handle (e.g. two Styles) for a combined look.
- **Background replacement must re-light the subject**: "Place the subject on
  [new scene]. Match the lighting on her face and jacket to the new
  environment." Without the lighting-match clause the subject looks pasted.
- For a transparent cut-out, `remove-background` — not a prompt asking for
  "white background".

## The graph

1. **Base** — `generate-image` (gpt-image-2, 4K, explicit aspect ratio,
   descriptive prompt + negative prompt).
2. **The fan** — the base's `image` output wires into the `image` input of each
   edit node in parallel:
   - `modify-image` + text instruction (surgical edit; provider `gpt-image-2-i2i`)
   - `modify-image` + a picker on `cinematography`, prompt empty
     (Lighting golden-hour / Color-Look teal-orange / Style anime / Era 1950s /
     Lens portrait-85mm — each its own node)
   - `modify-image` + background-replacement instruction with the
     lighting-match clause
   - `remove-background`
3. **Quality gate (optional)** — `image-critic` on the base (mode realism,
   threshold ~0.7): its feedback names concrete fixes (skin micro-texture, eye
   highlights, lens refraction) that you fold back into the BASE prompt and
   regenerate — fix the source, not each edit.
4. **Contact sheet (optional)** — wire the finished variants into one
   `image-collage` (smart layout, 4K) so the user compares them in a single frame.

## Phase 0 — Ask first

1. Base: generate from a prompt, or edit an existing image (`upload-image` /
   an id from their `[references]` line)?
2. Which edits, exactly — and split every compound wish into one lever each.
3. Aspect ratio; whether they want the critic pass and the collage.

## Run order

Base first; let the user approve it (run the critic here if asked) before
fanning out — every edit of a rejected base is wasted. The parallel edits then
run together; the collage runs last.
