---
"@nodaro/shared": minor
---

Add `STUDIO_SHOT_DRAFT_KEYS` (`stillSlots`, `clipSlots` — a studio shot's empty media slots, the owner's unsubmitted drafts) and `stripStudioDraftSettings`, the strip for a reader who may look but not edit: it removes every shot's empty slots and in-flight run markers (`STUDIO_SHOT_TRANSIENT_KEYS`) and leaves the rest of `settings` alone. `stripStudioTransientSettings` now drops the slots as well, so the public share read never carries them. The draft list is kept apart from `STUDIO_SHOT_TRANSIENT_KEYS` on purpose: the owner's own exports keep their slots.
