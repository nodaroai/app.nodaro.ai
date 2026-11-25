---
"@nodaro/sdk": minor
---

`userSettings.update({ publicOutputs: false })` now also takes every existing item out of the public gallery, in the same transaction as the setting, and the answer's new optional `hiddenFromGallery` says how many it took out (0 otherwise; absent from a server that predates it). When that step fails `update()` throws and no other field of the patch is written; sending `false` again is safe. Turning `publicOutputs` back on republishes nothing.
