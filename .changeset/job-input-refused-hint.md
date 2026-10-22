---
"@nodaro/sdk": minor
---

`JobErrorHint` gains a fourth arm, `InputRefusedHint` (`{ kind: "input-refused", subject: "input_video" }`, exported): the provider refused the job's input video without naming a content-policy class. `SafetyBlockHint` gains an optional `subject: "input_video"`, present when a content-policy block (for example `copyright`) was about the input video rather than the prompt, a reference image or the output. Either way the fix is a different clip. Code that narrows `JobErrorHint` with an exhaustive `if`/`else` should check `kind` explicitly.
