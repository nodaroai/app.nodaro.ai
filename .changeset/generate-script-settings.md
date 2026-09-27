---
"@nodaro/shared": minor
"@nodaro/prompts": minor
---

Generate Script reads its topic and settings the same way on every run.

- `@nodaro/shared`: `readScriptSettings(data, refMap?)` returns the scene count, tone, target duration and style guide a Generate Script node sends. It coerces rather than rejects: a number given as text becomes a whole number clamped to the accepted range, text is trimmed and cut to its limit, and an unusable value is dropped so the default applies. The limits are exported as `SCRIPT_SCENE_COUNT_RANGE`, `SCRIPT_TARGET_DURATION_RANGE`, `SCRIPT_TONE_MAX_LENGTH` and `SCRIPT_STYLE_GUIDE_MAX_LENGTH`. `NODE_MAPPABLE_FIELDS["generate-script"]` now lists `tone`, `sceneCount` and `targetLength` beside `styleGuide`.
- `@nodaro/prompts`: `computeScriptTopic(data, { override, wired, refMap })` returns a Generate Script node's topic: a list item, then the wired prompt, then the node's saved `prompt`, wrapped with its pre/post text.
