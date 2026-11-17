---
"@nodaro/shared": minor
"@nodaro/cli": minor
---

Competitor search terms and topic tracking (`@nodaro/shared/social`). A tracked brand can carry `searchTerms`: phrases or #hashtags that the searches for posts about it use instead of its name, and that a post must name to count as about it. A plan caps how many (`CompetitorListResult.limits`). `normalizeSearchTerms` cleans a list the way the server keeps it. `competitorScanSearches` counts one about-search per platform per term, and `competitorScanPages` the pages a scan runs. Scans are now charged per Social Search page at `COMPETITOR_SCAN_PAGE_CREDIT_ID`, summed, so a scan of more than twelve searches is priced in full; `competitorScanCreditId` is deprecated. New `topics` contract: `TrackedTopic`, `TopicListResult`, `CreateTopicInput`, `TopicDetail`, `TopicHistory`, `TopicCardsResult`, `TOPIC_PLATFORMS`, `TOPIC_POST_COUNTS` (20/40/60), `topicScanPages` and `TOPIC_SCAN_PAGE_CREDIT_ID`, for following a hashtag or phrase with no brand around it.
