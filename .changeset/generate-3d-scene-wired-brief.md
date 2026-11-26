---
"@nodaro/prompts": minor
---

Generate 3D Scene now takes its brief through the shared prompt precedence: `NODE_PROMPT_CANDIDATE_FIELDS` lists its `scenePrompt` field, so a prompt wired into the node is appended after the typed brief (or placed by `{Label}`), and the new `promptPlacementField(nodeType)` names the typed field a node's `{Label}` placements are read from.
