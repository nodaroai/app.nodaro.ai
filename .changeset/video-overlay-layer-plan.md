---
"@nodaro/shared": minor
---

Video Overlay takes a layer plan: `assembleVideoOverlayRequest` accepts a wired `planLayers` (plan layers first, then the handle layers), `parseVideoOverlayLayerPlan` reads it, an unreadable plan is the new `invalid_layer_plan` error, `videoOverlayCompositionKey` includes the plan, and plan layers render under every handle layer.
