---
"@nodaro/sdk": minor
---

`edit.applyEdl` accepts an optional `planBasis`: the plan value a render cuts (`renderReadBasis(value)` from `@nodaro/shared`, 16 lowercase hex digits). The job's result carries it back as `output_data.planBasis`, beside `output_data.renderBasis`, which the server stamps on every Apply EDL result (the render's output, crossfade and effective sources). Additive.
