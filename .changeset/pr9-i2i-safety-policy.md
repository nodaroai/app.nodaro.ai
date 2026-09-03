---
"@nodaro/shared": patch
---

`gpt-image-2-i2i` (the id a referenced gpt-image-2 request runs under) declares the same `safetyFilter` policy as `gpt-image-2`, so the one automatic retry and the nano-banana-pro fallback offer apply to reference-image requests — the case the policy exists for. A guard test now requires every `T2I_TO_I2I_VARIANT` pair to carry the same policy on both sides.
