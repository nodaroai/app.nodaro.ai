---
"@nodaro/cli": minor
---

`nodaro audio transcribe` accepts `--provider nemotron-3-5-transcribe` (NVIDIA Nemotron 3.5 Transcribe, priced per started minute of the file) and a new `--target-language <code>` that translates the speech instead, to or from English, on that engine only and never with `--word-timestamps` (both refused before the call). `nodaro media add-captions --transcribe-provider` keeps its three engines.
