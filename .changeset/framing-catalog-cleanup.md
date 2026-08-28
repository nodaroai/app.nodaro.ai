---
"@nodaro/prompts": patch
"@nodaro/shared": patch
---

fix(framing): drop the "holster visible" wardrobe clause from the `cowboy-shot` prompt hint (Shot Size must describe the frame only), and remove the `head-to-knees` entry — a duplicate crop of `medium-wide-shot` with no way for a user to tell them apart. `head-to-knees` is dropped from the framing catalog (`@nodaro/prompts`) and all 11 i18n locales (`@nodaro/shared`); `medium-wide-shot` stays as the canonical term.
