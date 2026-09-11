---
"@nodaro/sdk": patch
---

Document what a 3D scene render costs on `RenderScene3DParams`.

The price follows the plan's own `width`/`height`, not any node setting, so the
type a caller fills in is the right place to say so: up to 1920 px on the
longest side the render settles under `render-video`, above that under
`render-video:3d-large` (1.5x) or `render-video:3d-xlarge` (2.5x above 5.12
megapixels). Doc comments only — no behaviour change.
