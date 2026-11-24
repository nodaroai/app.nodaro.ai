---
"@nodaro/shared": minor
"@nodaro/prompts": minor
---

Kling Image 4.0 joins the catalog: `kling-image-4` (text to image) and `kling-image-4-i2i` (with input images, run by itself when images are added). Sizes `2K`, `4K` and `8K` (`defaultResolution` 2K, no 1K), eight ratios plus `auto`, up to 10 input items. It is priced by size, by each input item (a reference image or a named subject) and, for a set, by each image.

`8K` joins `IMAGE_RESOLUTION_VALUES` and `IMAGE_K_RESOLUTION_VALUES`; on any other model `normalizeModelInput` moves it to a size that model lists. A catalog entry may declare `imageSet: { min, max }`: the model returns a coherent set of images from one task. `normalizeModelInput` takes and returns `imageSetCount`, keeping it only on such a model (and never on a masked edit), with an adjustment when it is dropped or moved (`MODEL_INPUT_ADJUSTMENT_FIELDS` gains `imageSetCount`). `buildCreditModelIdentifier` takes an optional eighth argument, the set's image count, and `resolveNormalizedImageGen` an `imageSetCount` option (returned when kept). New: the `KLING_IMAGE_4_*` constants, `isKlingImage4`, `isKlingImage4I2i`, `klingImage4CreditId`, `klingImage4Resolution`, `klingImage4SetCount` and `imageSetCountInputOf`.

`klingImage4ItemsFromSubjects` and `klingImage4EstimatedItems` count a Kling Image 4.0 run's input items (a character's views grouped into one subject of at most 4, each image once); `pricedEstimatedImages` takes an optional graph (`ImageInputGraph`) to count them for an estimate.
