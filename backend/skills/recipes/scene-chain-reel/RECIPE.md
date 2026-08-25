---
name: scene-chain-reel
description: A full cinematic vertical reel from N scenes — stills first with a scene-to-scene reference chain for continuity, one shared motion prompt animates every frame, staged combine, one music bed, trim, format, caption
triggers: ["cinematic reel", "instagram reel", "multi-scene video", "short cinematic film", "vertical video from scenes", "surreal world video", "8 scene video", "story reel", "make a reel"]
version: 1
---

# Scene-Chain Reel

One concept becomes a complete vertical short film: N still scenes (approved
cheaply first), each animated with the SAME motion language, cut together with
fades over one music bed, trimmed and formatted for Instagram. The proven shape
is 8 scenes at 5s — about 35 seconds of film.

Two ideas carry the whole method:

1. **The reference CHAIN**: each scene's image wires into the NEXT scene's
   `references` (scene 1 → scene 2 → scene 3 → …). The references handle here is
   doing CONTINUITY, not identity — palette, lighting and world-feel flow down
   the chain, so eight separately-prompted scenes read as one world.
2. **One motion prompt for every video node.** The start frame carries the
   content; the shared motion prompt carries ONLY camera + atmosphere. Uniform
   motion is what makes separate clips feel like one film.

## The graph

1. **Per scene** (N times): `text-prompt` (the scene) → `generate-image`
   (image model of choice, `aspectRatio: "9:16"`), plus the previous scene's
   `image` → this scene's `references`. Scene 1 has no incoming reference.
2. **Per scene**: the image's `image` → `generate-video`'s `startFrame`
   (kling-3.0, `duration: 5`, 9:16), all N video nodes sharing ONE motion
   prompt (`references/prompt-formulas.md`).
3. **Staged combine**: scenes 1-4 → one `combine-videos`, scenes 5-8 → a
   second, both → a final `combine-videos`. Transition `fade` at 0.5s, audio
   mode crossfade. Clip order inside each combine = story order — set it
   explicitly.
4. **Music**: `text-prompt` (one mood-bed brief) → `suno-generate` (V5,
   instrumental). ONE track for the whole film — never per-scene music.
5. **Tail**: final combine `video` + suno `audio` → `merge-video-audio` →
   `trim-video` (cut to the content's real length) → `social-media-format` →
   the Instagram publish step, with a `text-prompt` caption wired to the
   format/publish nodes.

## Hard rules

- **Stills before motion.** Generate and approve all N images before ANY video
  node runs — re-rolling a still costs a fraction of a clip. Propose the image
  run first, the video run only after the user approves the frames.
- **The motion prompt never describes content.** Camera move + light behavior +
  ambient life + micro-motion of soft elements + an anti-morphing lock
  ("maintain exact composition and structure, no distortion or morphing").
  Content words belong to the scene prompts; one content word in the shared
  motion prompt haunts all N clips.
- **Uniformity is the style**: one image provider, one video provider, one
  duration, one aspect ratio across all scenes. Mixing models mid-reel is
  visible drift.
- **The last scene is a pull-back wide** revealing the whole world — the
  closing shot the format expects.
- **Build in stages** (this graph is ~30 nodes): one edit per phase — scenes,
  then video nodes, then the combine/audio tail — never the whole graph in one
  call.
- Theme is a variable, structure is not: swapping the world (underwater →
  desert → space) means editing ONLY the N scene text-prompts and the music
  brief. Keep the hook mechanism — a strong scale/contrast idea repeated
  scene after scene (see the formula file).

## Phase 0 — Ask first

1. The concept + the HOOK (what is surreal/contrasting about this world?).
2. Scene count (default 8) and beats — offer to draft the N scene prompts from
   the formula and let the user edit before generating.
3. Vertical (default 9:16) unless stated otherwise; music mood in one line.

## Delivery boundary

The publish step is an OUTBOUND node. If you are the in-app copilot you cannot
author publishing nodes — finish at the formatted video + caption and tell the
user to add the Instagram node and pick their account. Say exactly what is left
to wire; never drop the step silently.
