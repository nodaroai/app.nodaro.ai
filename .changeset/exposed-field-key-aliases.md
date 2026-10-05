---
"@nodaro/shared": minor
---

Add `canonicalExposedFieldKey`, `canonicalizeOverrideKeys` and the closed `LEGACY_EXPOSED_FIELD_KEYS` table. A published app that lists a field under an older key (`similarity` on a Text to Speech node, whose data field is `similarityBoost`) keeps working: `mergeNodeInputOverrides` writes such an override onto the node's current field and drops the old key.
