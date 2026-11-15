---
"@nodaro/sdk": patch
---

Docs: a picker option's `imageUrl` / `imageLargeUrl` (`pickerCatalogs`, `catalogs`) and a factory preset's `previewUrl` / `previewUrls` (`presets.listFactory`, `presets.listFactoryGroups`) may be a path on the deployment's own site (`/brand/…`) when the deployment ships its own pictures there. Resolve such a path against the address you call the API at (`new URL(imageUrl, baseUrl)`); a page served by that site can use it as it is. The types are unchanged (`string`).
