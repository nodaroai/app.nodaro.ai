---
"@nodaro/shared": minor
"@nodaro/sdk": minor
---

Competitors, platform by platform. `CompetitorCardsResult.brands` gives each tracked brand's latest scan per platform (`CompetitorBrandTally`: the scan id, its time and one `CompetitorPlatformTally` per platform — the brand's own posts and posts about it there, the searches that ran and the ones that failed, its usual reach with its unit, and the strongest lesson). `CompetitorDetail.platforms` gives the same for one brand, and `TrackedCompetitor.searchPlan` lists what its next scan searches (`CompetitorSearch`). All three are optional: a server older than them leaves them out. The SDK re-exports the new types.
