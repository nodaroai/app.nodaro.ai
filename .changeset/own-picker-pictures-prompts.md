---
"@nodaro/prompts": minor
---

`PickerImageOptions.own` (`@nodaro/prompts/picker-art`): a deployment's own picker pictures, in place of the platform's. When set, the catalog projections picture an option by what it returns for that option (`PickerOwnPicture`: `url`, and an optional `largeUrl`) and by nothing else, so an option it has nothing for has no picture and no Person / Styling topic has one. The enlarged picture rides as `imageLargeUrl` (and `PickerOptionImage.largeUrl`) when `srcSet` is asked for. Without `own`, every projection is unchanged.
