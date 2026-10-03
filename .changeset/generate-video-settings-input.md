---
"@nodaro/shared": minor
---

Generate Video and Generate Video Pro take the Aspect Ratio, Duration and Provider nodes through one `settings` input.

- `SETTINGS_INPUT_HANDLE` (`"settings"`) and `SETTINGS_INPUT_CONSUMERS` name the input and the settings each node takes; `settingsInputAccepts`, `settingsInputFields` and `settingsProviderModels` read them.
- `settingsSourceForField` and `connectedSettingsSources` find the wired node for a field (the last edge of a kind wins); `resolveWiredSettings(nodeId, nodeType, data, nodes, edges)` returns the node's data as it runs, with each wired value written in and fitted to the model, plus a `problem` when a wired Provider names a model the node does not run. `applySettingsInput` is the fitting step alone, for callers that already resolved the field mappings.
- `snapToModelDuration(model, seconds)` returns the nearest duration the catalog lists for a model (a tie goes to the shorter one).
- `NODE_MAPPABLE_FIELDS` lists `aspectRatio`, `duration` and `provider` for both nodes, and the Provider node joins `PARAMETER_NODE_TYPES` (its model id is read from data; it produces no prompt hint).
