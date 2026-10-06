---
"@nodaro/cli": minor
"@nodaro/sdk": patch
---

`nodaro edit apply-edl` takes `--clip-key <key>`: the plan clip a render cuts (`"<first inMs>-<last outMs>"` of a clips-mode plan clip), passed as `clipKey` and stamped back on the job's result, as `edit.applyEdl` already allowed. The SDK's `edit` resource documentation now describes the multicam flow (`audioSync` → `editPlan` → `cameraSwitch` → a Preview, then the final) and that `cameraSwitch` relays from a connected self-hosted install like `editPlan`. Additive.
