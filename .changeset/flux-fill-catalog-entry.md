---
"@nodaro/shared": minor
---

`MODEL_CATALOG` (`@nodaro/shared/model-catalog`) gains `flux-fill` (FLUX Fill Pro, Black Forest Labs): kind `image`, mode `edit`, feature `mask`, priced at its existing `flux-fill` row. It was already an accepted `provider` of image-to-image and Modify Image (`IMAGE_I2I_PROVIDERS`, `MODIFY_IMAGE_PROVIDERS`) and a mask model (`I2I_MASK_SUPPORT`); with an entry, a deployment's model allow list can name it, and `GET /v1/models` and MCP `list_models` list it.

It declares no aspect ratios, sizes or qualities: its result keeps the size of the image it is given. `normalizeModelInput` therefore drops a value a request carries for one of those levers, and reports it in `adjustments`, as it does for Ideogram Edit. What the model is sent and what a run costs do not change.
