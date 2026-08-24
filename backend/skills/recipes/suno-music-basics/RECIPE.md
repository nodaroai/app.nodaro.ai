---
name: suno-music-basics
description: Songs and instrumentals from style PICKER nodes stacked into suno-generate's audio-style handle — no prose needed; a short prompt only as a nudge on top
triggers: ["make a song", "generate music", "background music", "instrumental track", "cinematic score", "make me a track", "song with vocals", "music for my video", "suno"]
version: 1
---

# Suno Music Basics

Music on Nodaro is styled with PICKER nodes, not prose: Music Genre, Music Mood,
Instrumentation, Voice Character and Voice Delivery all stack into
`suno-generate`'s `audio-style` handle. A song needs NO prompt at all — the
pickers carry the style; a short prompt is only a nudge on top.

## Hard rules

- **Pickers before prose.** Genre / mood / instruments / voice are structured
  choices — set them on parameter nodes wired into `audio-style`. Reserve the
  `prompt` field for what no picker expresses ("with subtle Middle Eastern
  musical influences", "90s spy movie soundtrack"). Never write a paragraph
  describing genre+mood+instruments that the pickers already state.
- **Multiple parameter nodes stack on the SAME `audio-style` handle** — a full
  setup wires 3-5 of them into one `suno-generate`.
- **Instrumental = skip the voice nodes AND set the node's instrumental toggle**
  (and/or vocal presence "instrumental" on the Instrumentation picker). Wiring a
  Voice Character into an instrumental track is a contradiction the model
  resolves at random.
- **Same pickers + a different prompt nudge = a meaningfully different track** —
  iterate on the nudge before touching the picker stack.
- Model V5. Valid picker values come from `get_picker_catalog` — never invent a
  genre or instrument id.

## The graph shapes (from simplest up)

1. **The basics** — Genre + Mood + Instrumentation + Voice Character →
   `suno-generate`. No prompt, no Voice Delivery. A complete song.
2. **+ Voice Delivery** — add the fifth picker for emotional/pace control of the
   vocal (pace, emotion, archetype).
3. **+ a prompt nudge** — same stack, short prompt steering flavor the catalog
   lacks.
4. **Same stack, different nudge** — duplicate the generate node, change only
   the prompt: instant A/B of the nudge.
5. **Instrumental only** — Genre + Mood + Instrumentation (vocal presence
   "instrumental"), no voice nodes, instrumental toggle ON.
6. **Stacking two Instrumentation nodes** — a richer arrangement (e.g. one
   picker of acoustic-world instruments + one of modern production), usually
   with a longer descriptive nudge.
7. **Opposite vibe, same node types** — the whole palette flips with picker
   values alone: simmering-mysterious-dark mood + whispered timbre + slow somber
   ASMR delivery makes a haunted track from the identical graph shape.

## Phase 0 — Ask first

1. Vocal or instrumental?
2. Genre family + mood in their words (map to catalog values via
   `get_picker_catalog`).
3. Where it will be used (a video soundtrack changes length/energy advice).

## Iterating

- Wrong style → fix the PICKER, not the prompt.
- Right style, wrong flavor → change only the nudge (shape 4).
- Vocals feel flat → add/adjust Voice Delivery (shape 2) before regenerating
  anything else.
- Richer sound → second Instrumentation node (shape 6).
