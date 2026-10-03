---
"@nodaro/shared": minor
---

Add `STUDIO_SHOT_DRAFT_KEYS` (`stillSlots`, `clipSlots` — a studio shot's empty media slots, the owner's unsubmitted drafts) and `stripStudioDraftSettings`, the settings strip for a reader who may look but not edit: it removes every shot's empty slots and in-flight run markers (`STUDIO_SHOT_TRANSIENT_KEYS`), and keeps the recycle bin without the owner's drafts in it (a deleted empty slot goes; a deleted take or scene loses its voice record and slots). `stripStudioTransientSettings` now drops the slots as well, so the public share read never carries them. The draft list is kept apart from `STUDIO_SHOT_TRANSIENT_KEYS` on purpose: the owner's own exports keep their slots.

Add `STUDIO_TAKE_VOICE_KEYS` (`revoiceTo`, `voiceMode` — a finished take's voice record) and `stripStudioTakeVoiceRecords`, which removes them from every node's `data.generatedResults` rows, where no settings strip reaches. `stripStudioDraftWorkflow` applies both strips to a workflow row (`nodes` and `settings`) and is the one strip a `view` read uses.
