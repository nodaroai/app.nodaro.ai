---
"@nodaro/shared": minor
---

OmniHuman 2.0 joins the Lip Sync models as `omnihuman-2-0` (in `LIP_SYNC_PROVIDERS` and the model catalog), beside OmniHuman 1.5, which is unchanged. It animates one image from 4 to 300 seconds of audio at 720p and takes an optional prompt of up to 300 characters (`MAX_VIDEO_PROMPT_CHARS_BY_PROVIDER`); it has no resolution choice, fast mode or seed.

It is charged per second of its audio at one rate, never by duration bucket. `LIP_SYNC_AUDIO_RATES` names each such model's one-second price row (`OMNIHUMAN_2_0_PER_SECOND_CREDIT_ID`, `omnihuman-2-0:per-second`) and its minimum and maximum seconds; `lipSyncAudioRateOf` reads it, `lipSyncBilledSeconds` gives the seconds a run is charged (the audio's length rounded up to a whole second, at least the minimum), `lipSyncEstimateSeconds` the seconds an estimate quotes, and `lipSyncFifteenSecondCreditId` the id of a 15-second run for any lip-sync model priced by its audio (`LIP_SYNC_UNMEASURED_ESTIMATE_SECONDS`). `isPerSecondLipSyncProvider` and `buildLipSyncCreditId` keep their bucketed models only. `LIP_SYNC_MAX_AUDIO_SECONDS` includes each rate model's maximum.

`lipSyncLeversNotTaken`, `lipSyncTakesLever`, `lipSyncLeverClearPatch` and `withoutLipSyncLeversNotTaken` (`@nodaro/shared/models`) name the Lip Sync levers (`LIP_SYNC_MODEL_LEVERS`: resolution, fast mode, seed) a model does not take, so a node switched to it, or a request sent to it, carries none of them. Only OmniHuman 2.0 is listed; every other model keeps its levers.
