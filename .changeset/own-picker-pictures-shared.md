---
"@nodaro/shared": minor
---

`ProjectedCatalogOption.imageLargeUrl` (the `GET /v1/catalogs` and `GET /v1/picker-catalogs/{nodeType}` option shape): the absolute URL of an option's enlarged picture, the larger version to show where a picker shows the option big. It is present only on a deployment that shows its own picker pictures (`catalogs.images: "own"`) and gave one for that option, on its media host like `imageUrl`; absent everywhere else, so a client that ignores it draws `imageUrl` as before.
