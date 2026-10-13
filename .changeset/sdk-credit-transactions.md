---
"@nodaro/sdk": minor
---

`client.credits.transactions({ limit?, cursor? })` reads `GET /v1/credits/transactions` — a page of the caller's credit transactions with `credits_charged` (what each run cost once settled) beside `credits_reserved` (the hold), plus `nextCursor` for paging. New exported types: `CreditTransaction`, `CreditTransactionsPage`, `CreditTransactionsOptions`.
