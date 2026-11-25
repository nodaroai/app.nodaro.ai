---
"@nodaro/shared": minor
---

`@nodaro/shared/runtime-config`: `toolApps.examples`, a white-label deployment's own before-and-after examples for its mini apps, by app id, for the app's page to show. Each example is `{ before, after }`, both an address `ownPictureAddress` accepts (a path on the site or an https address), with an optional `ask`, `title` and `text`. A key that is not an app id, a value that is not a list, an example without both pictures and an app left with no example are left out; an `ask`, `title` or `text` that is empty or over its limit is left out alone. `RuntimeSurface["toolApps"]` always carries `examples`, `{}` when the deployment gives none. Also the type `SurfaceAppExample` and the limits `MAX_APP_EXAMPLES`, `MAX_APP_EXAMPLE_ASK`, `MAX_APP_EXAMPLE_TITLE` and `MAX_APP_EXAMPLE_TEXT`; `MAX_TOOL_APPS` also bounds the apps that may have examples.
