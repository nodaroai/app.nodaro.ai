---
"@nodaro/sdk": minor
---

`llm.structuredJob` accepts `analysisJobId`: draft from a finished `video-analysis` job you own instead of analyzing `videoUrl` again — no second analysis, no second analysis charge. A fresh movie run's row now also carries `analysisCredits` (in `input_data` and `output_data`) from the moment its analysis child is created, not only at completion.
