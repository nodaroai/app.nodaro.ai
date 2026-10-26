---
"@nodaro/sdk": minor
---

`client.billing` reaches the whole billing screen for a first-party app signed in with the person's session: `purchases()` (credit purchases with receipt links), `invoices()` (every payment as a document — Stripe invoices with their PDF, receipts for credit packs and loads), `paymentMethod()` (the card and billing details on file), `autoRecharge()` / `setAutoRecharge()`, `checkout()`, `loadCredits()`, `portal()` and `changePlan()`. The three that send the person to Stripe take `returnPath`, a path on the calling origin to come back to. These routes refuse an API key and an app's OAuth token (`ForbiddenError`).
