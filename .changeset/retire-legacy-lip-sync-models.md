---
"@nodaro/shared": minor
---

Wav2Lip, VideoReTalking and SadTalker are retired from Lip Sync. `wav2lip`, `video-retalking` and `sadtalker` leave `LIP_SYNC_PROVIDERS` (and so the `LipSyncProvider` type) and `REPLICATE_LIP_SYNC_PROVIDERS`. `POST /v1/lip-sync` and a server-run workflow refuse a request or node that names one, before anything is reserved, with a `400 validation_error` whose message says the model is no longer available for Lip Sync and another Lip Sync model must be picked. No request is moved to another model.

New in `@nodaro/shared/models`: `RETIRED_LIP_SYNC_PROVIDERS` (each retired id and the name it is shown by), `retiredLipSyncProviderName(provider)` and `retiredLipSyncProviderMessage(provider)` (the refusal's sentence). `VIDEO_INPUT_LIP_SYNC_PROVIDERS` and `FLEXIBLE_INPUT_LIP_SYNC_PROVIDERS` keep the retired ids, so a saved node on one keeps the inputs its connections attach to until another model is picked.
