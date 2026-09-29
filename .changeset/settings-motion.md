---
"@nodaro/shared": minor
"@nodaro/prompts": minor
---

The Motion node joins the video nodes' Settings input as a prompt clause.

- `@nodaro/shared`: `SETTINGS_HINT_SOURCES` (`["motion"]`) are settings a Settings input takes as a prompt clause rather than a field; `SETTINGS_SOURCE_TYPES` lists every setting. `isSettingsHintEdge(edge, consumerType, edges, typeOf)` tells a hint collector whether an edge brings the clause that applies (the last Motion wired), and `settingsSourceForType` finds the wired node of a kind. `SETTINGS_INPUT_CONSUMERS` for Generate Video and Generate Video Pro now include `motion`; a wired setting without a field has no `field`. `motion` leaves `HINT_EXEMPT_PARAMETER_TYPES` and joins `VIDEO_ONLY_PARAMETER_NODE_TYPES`.
- `@nodaro/prompts`: `getParameterPromptHint` returns Motion's clause (`subtle` / `moderate` / `dynamic`; the bare term in compact mode).
