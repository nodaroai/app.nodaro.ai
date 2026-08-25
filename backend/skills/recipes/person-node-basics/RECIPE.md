---
name: person-node-basics
description: Design a person with the Person picker node instead of prose — attributes (age, ethnicity blend, build, eyes, hair, skin, facial geometry) compose the character prompt; stack Backdrop, Framing and Mood on the same look input for full scene control
triggers: ["create a person", "design a character look", "model photo", "define facial features", "person node", "a woman in her 20s with", "specific face", "ethnicity blend", "character from attributes", "character set", "a set of characters"]
version: 1
---

# Person Node Basics

Character design on Nodaro is structured, not prose: the **Person** parameter
node holds ~29 attribute fields (type, age, ethnicity, build, body proportions,
face shape, eyes, nose, lips, hair, skin, distinctive features — down to facial
geometry), and from the picks it WRITES the character description into the
downstream prompt itself. The image node's own `prompt` stays EMPTY.

## Hard rules

- **Wire Person's `out` into `generate-image`'s `look` input** and leave the
  image node's `prompt` empty — the picker supplies the character text. Do not
  ALSO describe the person in the prompt; two competing descriptions blur both.
- **Every attribute value is a catalog slug** (`age-early-20s`, `hair-blonde`,
  `eyes-green`, `proportions-long-legged`). Get valid values from
  `get_picker_catalog` for the person catalog — never invent a slug.
- **Ethnicity takes a BLEND**: an array of up to two entries (e.g. italian +
  swedish, or nordic + mexican-mesoamerican) produces a mixed-heritage look no
  single pick gives. This is the node's signature capability — use it when the
  user describes a look no one label matches.
- **Set only the fields the user cares about.** Unset fields stay free for the
  model; a fully-specified 29-field person is rarely what anyone asked for.
  Type + age + ethnicity + hair + eyes covers most requests.
- **Same node, different attributes = a different person.** Iterating on the
  character means editing the Person node's fields, never rewriting a prompt.

## The three steps (build them in this order)

1. **Meet the node** — one Person → one `generate-image` (nano-banana-2 or
   another current image model, explicit aspect ratio, empty prompt). The user
   can open the image node's Final Prompt to SEE the text the picker wrote —
   point them to it; it makes the mechanism legible.
2. **Same graph, different character** — duplicate the pair, change only the
   Person fields (different type, build, an ethnicity blend, eye state,
   distinctive features). Completely different result, zero prompt writing.
3. **Stack for full scene control** — several parameter nodes wire into the
   SAME `look` input: Person + Backdrop (e.g. white seamless) + Framing (e.g.
   front-on) + Mood (e.g. playful). Each layers its own fragment into the final
   prompt — character, then scene, then framing, then mood.

## Phase 0 — Ask first

1. The person, in their words — then map to attributes and SHOW the mapping
   ("early-20s stunning model, Italian-Swedish blend, green eyes, blonde").
2. Studio look or a real scene? (Studio → add Backdrop; scene → describe the
   scene in the image prompt or add Setting.)
3. Aspect ratio.

## Combining with other recipes

- The generated person is a perfect Source for `one-character-any-scene`
  (identity transplants) and `camera-coverage` (angles of the same person).
- For an existing photo instead of a designed person, `describe-to-picker` can
  analyze an image and fill a Person node's picks automatically.
