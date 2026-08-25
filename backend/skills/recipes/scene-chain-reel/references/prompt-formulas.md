# Prompt formulas — scene-chain reel

## The shared motion prompt (one for ALL video nodes)

Proven text — adapt the atmosphere line to the theme, keep every structural
line. Note what it does NOT contain: no objects, no story, no scene content.

```
Slow cinematic camera movement, gentle forward drift toward the scene.
Soft volumetric light rays slowly shifting through the environment.
Small ambient life moving calmly across the frame.
Floating particles creating depth.
Subtle movement in soft fabrics and loose elements.
Maintain exact composition and structure, no distortion or morphing.
Ultra realistic, calm, luxury atmosphere.
centered subject, strong composition balance
```

Anatomy, line by line: one camera move (slow, forward) · light behavior ·
ambient life (fish / birds / dust — the theme decides) · depth particles ·
micro-motion of soft elements only · the anti-morphing lock · mood ·
composition lock. Replace "the environment"/"ambient life" with the theme's
words; never add an object.

## The scene-prompt formula

Each scene prompt = the HOOK restated through a new subject:

- ONE oversized everyday object as the anchor (sofa, coffee cup, open book,
  bed, fruit bowl)
- tiny humans for scale ("the divers appear tiny like ants")
- the world's physics ("cushions gently drifting with the current")
- one light statement ("soft sun rays penetrate from above")
- one mood word ("calm, luxurious")

Worked example (scene 1 of the underwater original):

```
Two divers slowly descend through clear blue water and suddenly discover a
massive living room on the ocean floor. A gigantic sofa the size of a building,
a coffee table as large as a small field, huge cushions gently drifting with
the current. Soft sun rays penetrate from above, creating a calm, luxurious
atmosphere. The divers appear tiny like ants inside a space built for giants.
```

The LAST scene breaks the pattern once: "Final wide shot. The camera pulls
back to reveal the full environment" — the whole world in one frame.

## The music brief

One instrumental bed for the entire film. Formula: genre-adjacent descriptor +
world atmosphere + 2-3 instruments + mood + an arc + exclusions:

```
cinematic ambient music with emotional build, deep ocean atmosphere, soft
piano, evolving pads, subtle bass, mysterious and dreamy mood, slow build up
to light emotional peak, immersive, no vocals, high-end film soundtrack
```

## Assembly settings that made it work

- combine-videos: transition `fade`, duration 0.5s, audio mode crossfade,
  explicit clip order = story order.
- trim-video after the audio merge, cutting the tail to the content's real
  length (the original trimmed to 34s).
