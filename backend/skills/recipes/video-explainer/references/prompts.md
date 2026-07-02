# Block-prompt template (video-explainer)

Every clip uses the SAME labeled block format. Paste the identical `STYLE REFERENCE:`
tokens into every block so the look never drifts; the style key image is attached
separately (via the clip call's reference-image input). Vary only `SCENE:` and `MOTION:`.

```
Block N
STYLE REFERENCE: <the exact same style tokens in every block>. Match the attached reference image EXACTLY — same render style, palette, line character, and finish.
SCENE: <a complete designed composition — multiple related elements, spatial structure, a beginning-to-end action>.
MOTION: <a real camera or animation move — lateral pan, flow along a path, scale shock, orbit>.
AUDIO: <ambient / SFX only, no speech — inert on silent engines like gemini-omni; include only for audio-capable engines>.
NEGATIVE: photorealism, 3D render, live-action, lip-sync, talking mouth, captions, on-screen text, subtitles, watermark, logo, <+ style-specific bans>.
```

Field notes:

- **`STYLE REFERENCE:`** — identical in all N blocks. This is the paste-once look lock. It
  restates in words what the attached key image shows, so the two reinforce each other.
- **`SCENE:`** — see the RICHNESS RULE below. Never a bare subject.
- **`MOTION:`** — a real move, never "static" and never a vague "slow push-in" alone.
- **`AUDIO:`** — ambient bed / SFX only. NEVER put spoken words here (hard rule: no speech
  in clips). On `gemini-omni-video` (silent on Nodaro) this line is inert but harmless;
  on seedance with `generate_audio` it seeds an ambient bed under the voice.
- **`NEGATIVE:`** — always ban photorealism, 3D render, live-action, lip-sync / talking
  mouth, captions, on-screen text, subtitles, watermark, logo. Add style-specific bans
  (e.g. for a flat-vector style: "gradients, drop shadows, texture noise").

## RICHNESS RULE (the difference between a real clip and a flat one)

Every `SCENE:` MUST be a **complete designed composition**: multiple related elements, a
clear spatial structure, and a **beginning-to-end action** — not a single object sitting
still. Every `MOTION:` MUST be a **real camera or animation move** that carries that
action across the 10 seconds.

A bare "slow push-in, no scene change" is the FLOOR, not the pattern. Flat briefs render
flat clips **even on the same model and key** (root-caused in the 2026-07-02 AC-explainer
comparison run — identical model + key, the richly-briefed block looked designed and the
thin one looked dead).

Worked example of a rich scene (an air-conditioner heat-transfer explainer beat):

> **heat particles pulled out of the room into the indoor unit, drawn through the wall
> pipe, and released by the outdoor unit into the sky — a glowing closed-loop circuit
> between the two units**, camera panning laterally to follow the flow along the pipe.

That is a full closed-loop system with spatial structure (indoor → pipe → outdoor → sky),
several related elements (particles, both units, the pipe), and an action with a
beginning and end (pulled → drawn → released) — carried by a real lateral pan.

## Fully worked block

```
Block 3
STYLE REFERENCE: flat 2D vector illustration, limited palette of deep teal (#0E5C5C), warm coral (#FF6B4A), and bone white, clean uniform 3px outlines, matte finish, no gradients. Match the attached reference image EXACTLY — same render style, palette, line character, and finish.
SCENE: a cutaway of a home wall — an indoor AC unit on the left, an outdoor condenser on the right, a copper pipe connecting them through the wall. Glowing coral heat particles are pulled from the warm room into the indoor unit, travel left-to-right along the pipe, and burst out of the outdoor unit into a teal sky, forming a continuous closed-loop circuit between the two units.
MOTION: a smooth lateral pan following the heat particles along the pipe from the indoor unit to the outdoor unit, ending on the burst into the sky.
AUDIO: soft ambient hum of the unit, a gentle airflow whoosh as particles release. No speech.
NEGATIVE: photorealism, 3D render, live-action, lip-sync, talking mouth, captions, on-screen text, subtitles, watermark, logo, gradients, drop shadows, texture noise.
```

## STYLE-descriptor guidance (the `STYLE REFERENCE:` tokens)

Build the descriptor from four dimensions, then ALWAYS end with the non-photoreal
negation clause. Structure:

> **render style** + **palette** + **line character** + **finish**, illustrated / animated
> — not photoreal, not live-action, not 3D.

The same descriptor drives BOTH the Phase-1 `generate_image` style key AND the pasted
`STYLE REFERENCE:` block in every clip — keep them word-identical so the image and the
text agree.

Example descriptors:

1. **flat vector** — "flat 2D vector illustration, limited teal + coral + bone palette,
   clean uniform 3px outlines, matte flat fills, no gradients — illustrated, not photoreal,
   not 3D."
2. **soft gouache** — "hand-painted gouache storybook style, muted pastel palette, soft
   irregular brush edges, visible paper grain, gentle painterly finish — illustrated, not
   photoreal, not live-action."
3. **bold cel animation** — "bold cel-shaded 2D animation, saturated primary palette,
   thick confident black ink outlines, hard two-tone shading, glossy cartoon finish —
   animated, not photoreal, not 3D render."
4. **isometric line** — "clean isometric line-art, monochrome indigo on cream, thin
   even-weight strokes, no fill, technical-diagram finish — illustrated, not photoreal,
   not live-action."
