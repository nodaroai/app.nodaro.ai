---
"@nodaro/sdk": minor
---

`userSettings.update({ mcpPreferences })` takes `null` for a field, which clears that saved MCP default so the tools fall back to their own (`update({ mcpPreferences: { image: { model: null } } })`). The patch is typed by the new `UserMcpPreferencesPatch`; `UserMcpPreferences` stays the shape the settings are read in. The server used to refuse a `null` with `400 validation_error`.
