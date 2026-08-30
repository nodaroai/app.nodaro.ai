---
"@nodaro/shared": minor
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

ElevenLabs v3 dialogue goes direct: the v3 TTS per-request cap rises to 5,000 characters (dialogue: 5,000 total across lines, at most 10 unique voices), the model catalog gains a dedicated `dialogue` mode, the SDK gains `voices.textToDialogue()` (multi-speaker script -> one audio file; any voice including clones, `[audio tags]`, seed + text normalization), and the CLI gains `nodaro voice dialogue --line "Voice: text"`.
