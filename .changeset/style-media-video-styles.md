---
"@nodaro/prompts": minor
"@nodaro/shared": minor
"@nodaro/sdk": minor
---

Styles: each style now says how it makes its pictures and which outputs offer it, and five styles are offered for video alone.

- `@nodaro/prompts`: every `Style` declares its `medium` (`"photo"`, `"3d"` or `"2d"`) and, where it names tones rather than colours, its `tones` (`"black-and-white"` or `"one-colour"`). The 49 existing styles keep the classification video restyles already gave them. A new `media` field lists the outputs a style is offered for; absent means both. New helpers: `getStyleMedium`, `getStyleTones`, `styleOffersMedia`, `stylesForMedia`, plus `STYLE_MEDIUMS` and `STYLE_MEDIA`.
- Five video-only styles (`media: ["video"]`, medium `"3d"`): Felt Puppet (`felt-puppet`), Knitted Yarn (`knitted-yarn`), Toy Figure 3D (`toy-figure-3d`), Painterly 3D (`painterly-3d`) and Painted Clay (`painted-clay`). Each carries a video wording that restyles the people and the whole set (each one restyled every shot of the same live-action clip in a Seedance 2.5 test), and an image wording for an image that names one anyway. Image style lists leave them out.
- The `style` picker catalog carries `media` on these options, in memory and on the wire at both detail levels (`ProjectedCatalogOption.media` in `@nodaro/shared`, `PickerOption.media` in `@nodaro/sdk`), so a thin client can leave them out of an image style list.
- Style labels and descriptions for the five are translated in every locale `@nodaro/shared` ships.
- On Nodaro Cloud the style picker shows a rendered picture for each of the five, on the same scene as every other style's picture.
- Restyle lists: a style that does not hold up as a restyle of filmed footage carries `restyle: false` (Fantasy, Surrealism and Concept Art, which came out as the same plain 2D cartoon in tests). New helpers `styleOffersRestyle` and `stylesForRestyle`; the catalog carries `restyle` in memory and on the wire (`ProjectedCatalogOption.restyle`, `PickerOption.restyle`). Video generation still offers every style.
