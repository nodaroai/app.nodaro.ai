---
"@nodaro/shared": minor
---

`UI_STRING_PRODUCTS` adds `tools` and `voice` beside `flow`, so one `surface.strings` block in a deployment's profile can word the tools app and the voice app as well as the workflow editor. Each product still reads only its own namespace, and its overrides are checked against its own key manifest (`uiStringManifestFile(product)`).
