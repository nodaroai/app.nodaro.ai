---
"@nodaro/shared": minor
---

A one-off voice clone on Gemini 3.8 Flash: `TtsCapabilities.replica` marks a model that clones a speaker's voice for one request from two recordings (`TtsReplica`: `sourceAudioUrl`, `consentAudioUrl`), nothing saved as a voice; `gemini-3-8-flash-tts` only. New: `ttsTakesReplica`, `replicaModels`, `replicaOf`, `ttsReplicaProblem` (from `@nodaro/shared/model-catalog`), `dialogueReplicaVoices` and `dialogueReplicaOf` (a dialogue's cloned speakers; `dialogueVoicesForModel` and `dialogueProblem` take them into account), and the limits `REPLICA_MAX_BYTES`, `REPLICA_SOURCE_MIN_SEC`, `REPLICA_SOURCE_MAX_SEC`, `REPLICA_CONSENT_MAX_SEC` and the sentence `REPLICA_CONSENT_SENTENCE` (from `@nodaro/shared/models`). An API or MCP clone carries its consent: `TtsReplicaRequest` (`consent: true`), `REPLICA_CONSENT_ATTESTATION` (the sentence the caller confirms, the editor checkbox's) and `replicaConsentProblem`.
