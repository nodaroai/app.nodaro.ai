---
"@nodaro/sdk": patch
"@nodaro/cli": patch
"@nodaro/prompts": patch
---

The built-in ("factory") preset catalog is readable without a token: `GET /v1/node-presets/factory` is now a public route, so `client.presets.listFactory(nodeType)` works on a tokenless client (`createClient({ baseUrl, auth: { getToken: async () => null } })`) — a client app can show the catalog (names, example pictures via `previewUrl`, how many photos a preset needs via `minReferences` / `needsImage`) to visitors who are not signed in and ask for a login only when they generate. The response is cached for 5 minutes like the model catalog, and an invalid or expired token sent with the request is ignored (an OAuth app needs no scope for it). `@nodaro/prompts`: `getFactoryPresets()` and `presetMinReferences()` answer an empty catalog / zero for a node type that is not a catalog key even when it names an `Object.prototype` member (`constructor`, `toString`), instead of throwing. Your own presets, favorites and folders still need auth exactly as before. Nothing to change in an existing app. CLI: `nodaro presets list --factory --node-type <type>` no longer needs a saved profile (`--base-url <url>` asks another instance; without `--factory`, `presets list` still needs one).
