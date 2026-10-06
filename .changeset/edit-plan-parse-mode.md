---
"@nodaro/shared": minor
---

Add `parseEditPlanMode(value)`: the strict sibling of `asEditPlanMode`. It returns the mode when the value is exactly a known Edit Plan mode and `undefined` otherwise, so a caller can refuse an unknown mode instead of planning it as `tighten`. `asEditPlanMode` is unchanged. Additive.
