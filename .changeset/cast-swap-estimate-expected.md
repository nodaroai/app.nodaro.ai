---
"@nodaro/sdk": minor
---

`CastSwapEstimate` gains the charge a Cast Swap run is expected to come to: `expectedCredits` (the hold with the video model's expected charge in place of its hold; never above `totalCredits`) and `breakdown.seedanceExpected` (that expected video-model charge, which takes `breakdown.seedance`'s place in `expectedCredits`). `totalCredits` is now documented as what is held when the run starts; the run is charged what it actually costs. Both new fields are optional: an older Cast Swap engine leaves them out, so read `totalCredits` then.
