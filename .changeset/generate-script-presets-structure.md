---
"@nodaro/prompts": patch
---

Generate Script presets no longer set `structure`, a field the script never reads. The two eight-step presets (Explainer, Story Beats) now state their eight steps in `styleGuide`, which reaches the script.
