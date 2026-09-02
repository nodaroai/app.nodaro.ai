---
"@nodaro/shared": minor
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

Organizations: usage reports (rollout-gated). `client.organizations.usage(orgId, query)` and `client.workspaces.usage(workspaceId, query)` return credits by workspace, member, model or day for an inclusive date range (`from`/`to`, IANA `tz`), with in-flight vs settled credits split out and the platform-absorbed overrun listed separately; `usageRows` pages the underlying runs; `usageCsv` returns the same report as CSV. The CLI gains `nodaro org usage` and `nodaro workspace usage` (`--csv`). `@nodaro/shared` adds the `UsageReport`, `UsageReportRow`, `UsageVarianceRow`, `UsageLogEntry`, `UsageQuery` wire types, the `USAGE_GROUP_BYS` list and the `audit_unavailable` error code.
