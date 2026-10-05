---
"@nodaro/sdk": minor
---

`edit.applyEdl` accepts an optional `clipKey`: the plan clip a render cuts (`edlSpanKey(clip)` from `@nodaro/shared`). The job's result carries it back as `output_data.clipKey`, beside `output_data.quality` (`"proxy"` for a preview, `"final"` otherwise), which every Apply EDL result now carries. Additive.
