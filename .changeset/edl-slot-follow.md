---
"@nodaro/shared": minor
---

EDL slots can name the face track they followed: `EdlLayout.slots[].follow` (`EdlSlotFollow`: `{ sourceId, trackId, motion: "static" | "glide" }`), optional and additive. `validateEdl` reports a `follow` whose `sourceId` is not the slot's own `source`, an empty `trackId`, or a `motion` other than `static` / `glide` as issues. `normalizeEdl` carries a well-formed `follow` through (unknown keys inside it dropped) and drops a malformed one rather than guessing it. New exports (types only, no runtime values): `EdlSlotFollow`, `EdlSlotFollowMotion`. An EDL without `follow` is unchanged.
