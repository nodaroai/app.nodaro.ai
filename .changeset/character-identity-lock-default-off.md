---
"@nodaro/prompts": patch
---

`DEFAULT_IDENTITY_LOCK` changes from `"soft"` to `"off"` — characters now default to no identity lock (users opt in to soft/strict for facial-likeness preservation).

This is the single source of truth the app reads for every unset identity-lock fallback (canvas node, config panel, Character Studio display; backend create defaults and asset generation), so a Character node/entity with no explicit `identityLock` now emits no lock line. Consumers that pass an explicit `"off"/"soft"/"strict"` are unaffected.
