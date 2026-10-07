---
"@nodaro/shared": minor
---

`sceneRenderStateRegistry` tags the `ShotSpec` fields only a render or the user writes (`accepted_match_cut_break`, `has_dialogue`, `actual_audio_duration_sec`, `dialogue_no_cut_zone`, `cut_decision`), so a plan-only shot schema can be derived from `ShotSpecSchema` by rule. The tag is a custom Zod registry, so JSON schemas rendered from `ShotSpecSchema` are unchanged.
