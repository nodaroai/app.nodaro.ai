---
"@nodaro/shared": minor
---

`ModelCatalogEntry` gains `pickerHidden`: a model the platform runs on its own, never one a person or a client picks. Such an entry is left out of `listModels` (so `GET /v1/models` and MCP `list_models`), `buildModelTree` and `searchModelVariants` (the editor's Models tab and add-node search) and `modelIdsByKindMode` (even with `includeHidden`), and stays a model a deployment's restriction can name.

`MODEL_CATALOG` gains `flux-lora-character` (Trained character (FLUX LoRA), Black Forest Labs, mode `t2i`, `pickerHidden`), priced at its existing `flux-lora-character` row: the model a Generate Image run switches to when its one character has a trained model. With an entry, a deployment's model allow list can withhold it; where it is withheld, a run does not switch and uses the character's reference pictures instead.
