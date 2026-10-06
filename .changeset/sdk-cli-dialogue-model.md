---
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

`voices.textToDialogue` and `nodaro voice dialogue` can choose the dialogue model (`elevenlabs-dialogue`, the default, or `elevenlabs-dialogue-v4`) and send similarity; stability is any 0–1 value on v4 and 0, 0.5 or 1 on v3. The SDK's `stability` type widens from `0 | 0.5 | 1` to `number` (source-compatible for existing callers).
