---
"@nodaro/sdk": minor
---

Scene3D deliveries can now describe a Pro run whose recipe never compiled: `Scene3DDelivery` gains `sourceKind`, and `sceneRevisionId`/`sourcePlanSha256` are nullable for the `refused-authoring` kind, which retains the compiler's refusal report without a scene behind it.
