---
"@nodaro/shared": minor
"@nodaro/prompts": minor
"@nodaro/sdk": patch
"@nodaro/cli": patch
---

Image models are now chosen by role, from one table: `IMAGE_MODEL_ROLE_DEFAULTS` (characters, general text-to-image and video anchors on `gpt-image-2`; edits on `gpt-image-2-5-flare-i2i`) and `defaultImageModel(role, aspectRatio)`. A ratio the role's model can't draw moves to the next model in `IMAGE_MODEL_RATIO_FALLBACKS` that can: GPT Image 2.5 Sunburst for 21:9, 3:2, 2:3 and other wide or in-between ratios, Nano Banana Pro for 4:5 / 5:4. Nano Banana Pro is no longer a default; it remains the last ratio fallback and the safety-block retry. Decided 2026-10-08 from a blind five-model comparison, quality first.

The catalog's quick recommendations follow the same comparison: GPT Image 2 for typography and highest fidelity, GPT Image 2.5 Flare i2i for edits. GPT Image 2 is the featured image model in place of Nano Banana Pro.

`@nodaro/prompts`: all 97 factory presets that ran on Nano Banana Pro moved, by role, after a preset re-test:
- GPT Image 2 for boards, character sheets, portraits from a photo, product, scenes and the Cast & Consistency grids.
- GPT Image 2.5 Sunburst where the preset is 2:3.
- Nano Banana 2.1 for 4:5 presets and labelled illustrated sheets.
- GPT Image 2.5 Flare (`-i2i` on Modify Image) for the Edits and Stylized Subject presets.

`@nodaro/cli` and `@nodaro/sdk`: help text and examples name the new default.
