---
"@nodaro/shared": minor
---

`@nodaro/shared/runtime-config` adds two surface keys. `surface.strings` is a deployment's own wording for a product's UI strings, as `product → locale → message key → text`, and the platform validates it before it reaches a page. `UI_STRING_PRODUCTS` names the products that read their own namespace (`flow`, the workflow editor), `parseRuntimeStrings` keeps only text, and `surfaceStringOverride(strings, product, locale, key)` reads one entry. `brand.favicon` lists the page's icons as paths on the site itself, checked with the new `isSameSitePath`, which refuses another site, and any character that could end an HTML attribute. A product's build describes its dictionary to the platform with a `UiStringManifest` (keys and placeholder names, no text): `buildUiStringManifest` makes one, `uiStringManifestFile` names the file, and `uiStringPlaceholders` reads a text's `{placeholders}`.
