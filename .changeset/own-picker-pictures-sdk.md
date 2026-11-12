---
"@nodaro/sdk": minor
---

`PickerOption.imageLargeUrl` (`client.pickerCatalogs.get()`) and `ProjectedCatalogOption.imageLargeUrl` (`client.catalogs.list()`): the absolute URL of an option's enlarged picture, present only on a deployment that shows its own picker pictures (`catalogs.images: "own"`) and gave one for that option. `client.catalogs.list()` also returns `data` with `curated: false` on such a deployment: the catalogs are the bundled ones, with the deployment's pictures in them.
