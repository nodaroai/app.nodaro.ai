---
"@nodaro/shared": minor
---

Add the dialogue lane's capability lookups: `DIALOGUE_PROVIDERS`, `DEFAULT_DIALOGUE_PROVIDER`, `findDialogueCapabilities`, `dialogueProviderOf`, `getDialogueCapabilities`, `dialogueHasLever` and `dialogueStabilityAccepted`, and an optional `stabilitySteps` field on a speech model's capability sheet (the stability values the platform accepts when it offers steps instead of a 0–1 range). ElevenLabs Dialogue v3 declares the steps 0, 0.5 and 1 it has always accepted. Nothing changes for any request.
