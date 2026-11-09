---
"@nodaro/shared": minor
---

The runtime config contract (`@nodaro/shared/runtime-config`) gains one optional billing key, `unitLabels`: a deployment's word for its credit unit per interface language, beside the single `unitLabel`. `parseRuntimeSurface` keeps it only beside a coherent unit (the label and rate together), with text words only. The new `surfaceUnitLabel(labels, locale, single)` is the rule every reader shares: the word for the language on screen, else the single label. Absent means a reader behaves as it does today.
