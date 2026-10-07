---
"@nodaro/shared": patch
"@nodaro/sdk": patch
"@nodaro/cli": patch
---

ElevenLabs Dialogue v4's total-character cap across lines rises from 5,000 to 10,000 (`getDialogueCapabilities("elevenlabs-dialogue-v4").maxChars`): a 10,000-character v4 dialogue was voiced whole in a live check on 2026-10-06, well inside the platform's time limit. v3 dialogue stays at 5,000. The SDK's `voices.textToDialogue()` JSDoc and `nodaro voice dialogue --help` state each model's own cap.
