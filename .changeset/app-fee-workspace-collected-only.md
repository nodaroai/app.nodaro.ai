---
"@nodaro/shared": patch
---

The usage report's doc comments (`UsageReportTotals`, `UsageVarianceRow`) now say that its absorbed app-fee total covers earlier runs only: an organization-approved app's creator fee is collected only up to the workspace budget's headroom, and the creator is credited only that, so new runs absorb nothing.
