---
"@nodaro/shared": minor
---

LatentSync (Lip Sync) is priced by the length of its audio and charged what the run used (`@nodaro/shared/credits`). It joins the models held by a length bucket (`isPerSecondLipSyncProvider`, `buildLipSyncCreditId` now returns `latentsync:<bucket>s`, `getLipSyncMaxAudioSeconds` is 300 for it), and the new `LIP_SYNC_CHARGED_AT_RUN_COST` / `isLipSyncChargedAtRunCost` name the models whose bucket row is a hold: the run is settled at what it used, below or above that hold. Its catalog entry lists the hold rows in place of the single price.
