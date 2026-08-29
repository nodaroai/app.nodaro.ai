---
"@nodaro/prompts": minor
"@nodaro/shared": patch
---

Factory presets whose text is a complete instruction (Reference Sheet boards, Character Reference Grid, Label Elements / Apply Named Edit, Face Privacy, Portrait Transformations, Stylized Subject & Edits, SwitchX operations, Restyle Looks) now ship it as `promptPrefix` / `promptSuffix` instead of `prompt`, so applying them keeps your prompt. `presetApplyClearKeys` (shared): a preset that ships prompt content clears stale pre/post text on apply.
