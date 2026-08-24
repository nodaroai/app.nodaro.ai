---
name: camera-coverage
description: One reference frame in, ten cuttable camera angles of the SAME scene out — an LLM plans real film coverage, one List fans one image node into all ten shots
triggers: ["camera coverage", "shot list", "different angles of the same scene", "ten angles", "storyboard from one frame", "coverage of this scene", "previz shots", "multiple camera setups", "same scene different shots"]
version: 1
---

# Camera Coverage — one frame, ten angles

One reference frame in, ten shots of the SAME scene out — wide, medium, close-up,
over-the-shoulder, reverse, insert, low angle, profile. Character, wardrobe,
location, time of day and light never change; only the camera does. The output is
real film coverage: a set of stills an editor could cut together, each one usable
as a start frame for animation.

The whole method is six nodes, not twenty-five: **a List between the planner and
the spender turns ONE image node into ten runs.**

## The graph

1. **Reference Prompt** (`text-prompt`) → **Reference Frame** (`generate-image`).
   One descriptive prompt makes one image. This is the scene; everything else
   answers to it.
2. **Coverage Brief** (`text-prompt`) → the LLM's `prompt`; the Reference Frame's
   `image` output → the LLM's `references`. The brief is the rules of real
   coverage — load `references/coverage-brief.md` for the proven text and reuse
   it near-verbatim.
3. **Write Coverage Prompts** (`llm-chat`): reads the frame + the brief, returns
   exactly 10 lines, one camera setup per line, no numbering. System prompt: a
   director of photography planning coverage an editor can cut together.
4. `llm-chat` `text` → **`split-text`** (newline separator) → a **`list`** node
   ("Shot List"). The list is the EDITABLE checkpoint: the user can rewrite any
   line BEFORE spending credits on ten generations.
5. **Coverage Shot** (`generate-image`, one node): the list's column output →
   its `prompt`; the Reference Frame's `image` → its `references`. Ten rows fan
   the node out into ten runs, each anchored to the same frame.
6. A second `list` in gallery view collects the ten images as a contact sheet.

## Hard rules

- **The brief does the directing, not the image prompt.** All coverage doctrine
  (which shots, one angle per line, screen direction, breathing room) lives in
  the Coverage Brief text. Changing the plan = editing the brief, never
  hand-tuning ten separate prompts.
- **One angle per line, camera POSITION not movement.** No pans, no zooms, no
  dolly — motion is added later by image-to-video. A line that stacks two angle
  terms produces a mongrel shot.
- **Keep screen direction consistent** — the subject stays on the same side of
  the frame line across all shots, so the cuts do not jump.
- **Every frame must survive animation**: breathing room around the subject,
  never cropped tight against the frame edge.
- **The list is the checkpoint.** Never wire the LLM straight into the image
  node: the editable list between plan and spend is what lets the user fix one
  line and re-run ONE angle instead of regenerating all ten.
- The reference frame rides EVERY coverage generation through `references` —
  that is what keeps character, wardrobe and light identical across angles.

## Phase 0 — Ask first

1. The scene (or an existing image to use as the reference frame — an
   `upload-image` replaces step 1).
2. How many shots (default 10) and any coverage style preference
   (documentary / action / interview — the brief adapts).
3. Aspect ratio (default 16:9 — coverage is usually landscape).

## Run order

Run the Reference Frame first and let the user approve it — coverage of a frame
they do not like is ten wasted generations. Then the LLM + split + list (cheap),
let them read the shot list, then propose the ten-image run.

## Make it yours (tell the user)

- New scene, same coverage plan: change the Reference Prompt, re-run from the top.
- Different coverage: edit the brief (6 shots, different order, another style).
- One bad angle: edit that one list line and re-run only the Coverage Shot node.
