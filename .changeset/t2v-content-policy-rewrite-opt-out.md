---
"@nodaro/sdk": minor
---

`TextToVideoParams` takes `contentPolicyRewrite?: boolean` (`POST /v1/text-to-video`). Absent or `true` keeps today's behaviour; `false` = a copyright refusal fails the job instead of retrying once with a reworded prompt.
