---
"@nodaro/sdk": minor
---

`userSettings.get()` answers two new optional fields. `privateOutputsAllowed` says whether the account's plan may switch outputs to private (on Nodaro Cloud: Standard, Pro and Business). `privateOutputsEndedByPlanAt` is the time a plan drop returned the outputs to public, while the account is still on a plan without private outputs (`null` otherwise). Both are absent from a server that predates them. When an account's plan drops from one with private outputs to one without (Free or Basic), the server returns `publicOutputs` to `true`: new results are public again, and nothing made while private is republished.
