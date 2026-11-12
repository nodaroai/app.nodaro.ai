---
"@nodaro/shared": patch
---

`NodaroRuntimeConfig` documents a deployment that gives the app's pages their own host without moving them. `flowUiOrigin` and `linkOrigin` can now arrive without `legacyUiHosts`: every host keeps serving the pages, and a browser's saved settings carry over to the Flow host. A page calls the API same-origin, and developer-facing links name `linkOrigin`, only once `legacyUiHosts` is there too. No type or value changes.
