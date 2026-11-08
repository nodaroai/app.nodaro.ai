---
"@nodaro/shared": minor
---

New subpath entry `@nodaro/shared/runtime-config`: the contract for a deployment's `/config.js` (`window.__NODARO_RUNTIME__`), which every product served from the same site reads before it starts. It has the key names and their types, a lenient `parseRuntimeConfig` / `readRuntimeConfig` that never throws and never returns the server-only billing keys, and the same-origin sentinel helpers `resolveRuntimeApiBase` (`"/"` resolves to a relative base, never to an absolute URL) and `resolveRuntimeSupabaseUrl`. It also carries the surface keys client apps read: `worlds`, `imports.links`, `catalogs.images`, `locale.offered`, `header`, `brand.logo` and `auth.requireSignIn`, with `surfaceRequiresSignIn`, `isBrandLogoRef` and `isSsoOnly`. Last, the worlds a deployment can offer (`WORLD_IDS`) and the node types each world runs (`WORLD_REQUIRED_NODE_TYPES`), with `worldAllowed` and `orderWorlds`.
