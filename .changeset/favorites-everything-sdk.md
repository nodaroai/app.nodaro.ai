---
"@nodaro/sdk": minor
---

Favorites for everything a person keeps:

- `client.library.list({ favorited })` lists only the files you favorited (or did not), together with the type, source and search filters and the cursor; each file carries `favorited`.
- `client.library.favorite(assetId, favorited?)` stars or unstars a library file by its asset id, an upload too. A file a job made shares its job's favorite, so uploads and generations are one favorites list.
- `client.favorites` (new, also `@nodaro/sdk/favorites`): `list({ kinds, limit, cursor })` reads every kind of favorite in one list, newest first — generations, uploads, voices, node presets and picker options; `listCatalog(catalog?)`, `addCatalog(catalog, optionId)` and `removeCatalog(catalog, optionId)` keep favorite picker options (styles, looks, moods, camera moves, music genres and moods, instruments, voices, deliveries, Person settings, shot shapes, Style Gallery looks).
