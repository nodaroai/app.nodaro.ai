---
"@nodaro/shared": minor
---

Add `STUDIO_SHOT_DRAFT_KEYS` (`stillSlots`, `clipSlots` — a studio shot's empty media slots, the owner's unsubmitted drafts) and `stripStudioDraftSettings`, which removes only those. `stripStudioTransientSettings` now drops them as well, so the public share read never carries them. The list is kept apart from `STUDIO_SHOT_TRANSIENT_KEYS` on purpose: the owner's own exports keep their slots.
