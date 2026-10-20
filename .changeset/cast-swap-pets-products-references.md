---
"@nodaro/sdk": minor
---

Cast Swap (`client.castSwap`) takes pet and product roles: `CastSwapPetRole` (`{ kind: "pet", name, images, body?, coat? }`) and `CastSwapProductRole` (`{ kind: "product", name, images, shape?, finish? }`), up to 3 of each beside 6 people and 1 location, with at most 30 images in all. `CastSwapParams` gains `resolution` (`"480p"` default, `"720p"`, `"1080p"`), `draft` (on by default at 480p, refused above it) and `prepareReferences` (default `true`: each person, pet and product's images are first made into one clean reference picture, for extra credits and about a minute; `false` uses your images as they are); `quality` is deprecated in favor of `resolution` + `draft`. `CastSwapEstimate.breakdown` gains `references`, the reference-preparation cost (0 when it is off or there is nothing to prepare), and `totalCredits` includes it.
