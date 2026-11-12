---
"@nodaro/sdk": minor
---

Split into Layers: `client.media.splitIntoLayers({ imageUrl, maxLayers?, size?, prompt? })` (`POST /v1/split-into-layers`) splits one image into a base picture and separate layers, each element on its own transparent PNG. `maxLayers` (1–99, default 9) caps the layers, `size` (`1K` default, `1.5K`, `2K` or `auto`) sets each image's pixel budget, and `prompt` names what to separate. The completed job's `output_data` is a `SplitIntoLayersOutput`: the base picture (`imageUrl`), the layer files bottom to top (`layers`), how many layers were saved (`layerCount`) and how many could not be saved (`layersNotSaved`; the run is charged only for the images saved), and one `SplitLayer` per saved layer (`layerData`: name, description, stacking order `zIndex`, the layer file's own `width`/`height`, and the `box` it sits in on the base, in the base's pixels and on a 0–1000 scale). Types `SplitIntoLayersInput`, `SplitIntoLayersSize`, `SplitIntoLayersOutput`, `SplitLayer` and `SplitLayerBox` from `@nodaro/sdk/media`.

Each `SplitLayer` also carries `baseUrl`: the stored base picture the layer was cut from, the job's own `imageUrl`. After a run once per picture, pair each layer with its base by `baseUrl`. A picture whose run failed has no base, so a layer's place among the bases can differ from its picture's number.
