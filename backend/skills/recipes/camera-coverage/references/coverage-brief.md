# The Coverage Brief — proven text

Paste into a `text-prompt` node wired to the planner LLM's `prompt` input.
Adapt the shot mix / count to the user's ask; keep every rule line — each one
prevents a specific failure (mongrel angles, jump cuts, uncroppable frames,
duplicate shots, prose instead of setups).

```
You are given a reference frame from a scene. Write 10 image prompts that COVER
THE SAME SCENE from different camera setups, so the shots can be cut together
into one sequence. Character, wardrobe, location, time of day and lighting stay
identical. Only the camera setup changes.

Rules:
- Build real coverage, in this order: 1 wide establishing, 2 medium, 2 close-up
  on the character, 1 over-the-shoulder, 1 reverse angle showing what she faces,
  1 insert / cutaway detail, 1 low or high dynamic angle, 1 profile.
- The character must stay recognizable in at least 7 of the 10. Pure detail
  shots: maximum 2.
- ONE camera angle per prompt. Never stack two angle terms in the same line.
- Describe the camera position, NOT camera movement. No pans, no zooms, no
  dolly - motion is added later.
- Keep screen direction consistent across all shots: she stays on the same side
  of the frame line, so the cuts do not jump.
- Every frame must be a usable start frame for an animated clip: leave breathing
  room around the subject, never crop tight against the frame edge.
- No two prompts may describe the same framing. Reject near-duplicates before
  writing.
- Each prompt under 30 words, phrased as a camera setup, not as a story.
- Output exactly 10 lines, one prompt per line. No numbering, no bullets, no
  blank lines, no preamble.
```

Planner system prompt (the `llm-chat`'s system prompt):

```
You are a director of photography planning the shot coverage of a single scene,
so an editor can cut the shots together. Output only the 10 prompt lines - no
numbering, no commentary, no preamble.
```

## Why the output format is rigid

"Exactly N lines, one per line, no numbering, no preamble" is not style — it is
the CONTRACT with the `split-text` node downstream. A numbered list or a chatty
preamble becomes a broken shot list. When you change the shot count, change it
in BOTH the rules line and the output line.
