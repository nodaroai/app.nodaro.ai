---
"@nodaro/sdk": minor
---

`TextToSpeechParams.replica` and a dialogue speaker's `replica` (`voices.textToDialogue`): on `gemini-3-8-flash-tts`, speak in a person's own voice cloned for this request alone and not saved, from two real WAV recordings of the same adult given as https links — a 10–30 s reference and a consent recording of the same person reading the consent sentence (`REPLICA_CONSENT_SENTENCE`). No extra charge. A recording the platform cannot take, or a model that does not clone, is a `400` before anything is charged. A clone must carry `consent: true` (`TtsReplicaRequest`): the caller's confirmation of `REPLICA_CONSENT_ATTESTATION`, the sentence the editor's consent checkbox shows; without it the request is a `400` before anything is read or charged.
