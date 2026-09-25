---
"@nodaro/prompts": minor
"@nodaro/shared": minor
"@nodaro/sdk": minor
---

Transitions can declare their own options, and the wipe gains a Direction. A catalog row may now carry `options` (each `{ field, label, choices }`, `auto` first) and a `promptTemplate` with one `{<field>}` token per option; its `promptHint` is the template on every `auto` choice, so plain readers still see a finished sentence. The `wipe` row declares `WIPE_DIRECTION` (`wipeDirection`: `auto`, `left-to-right`, `right-to-left`, `top-to-bottom`, `bottom-to-top`, `top-left-to-bottom-right`, `top-right-to-bottom-left`). `composeTransitionHintFromConnections` takes the choices as `options.optionValues`, `renderTransitionBases` as a third argument, and `getTransitionPromptHint` as a second; a transition node's `wipeDirection` is read by `getParameterPromptHint`. New exports: `WIPE_DIRECTION`, `getTransitionOptions`, `TRANSITION_OPTION_FIELDS`, `readTransitionOptionValues` and the `TransitionOption` / `TransitionOptionChoice` / `TransitionOptionValues` types. The picker catalog publishes a row's options on that option as `params`, and the wire projection (`GET /v1/picker-catalogs/:nodeType`, the MCP `get_picker_catalog` tool) carries them at both detail levels — `@nodaro/shared`'s `ProjectedCatalogOption` and the SDK's `PickerOption` gain the optional `params`.

**Prompt wording change (wipe only):** the wipe's default description now reads "a clean straight edge sweeps across the frame" instead of "a clean diagonal line sweeps across the frame"; a chosen direction replaces that phrase (for example "a clean vertical edge sweeps across the frame from left to right"). No other transition's text changes.
