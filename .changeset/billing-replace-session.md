---
"@nodaro/sdk": minor
---

`billing.checkout()` and `billing.loadCredits()` take `replacesSessionId`: an earlier Checkout session of yours (an embedded form's `sessionId`) that the new one replaces. The platform expires it first, so the two are never payable at once. A `NodaroError` with status 409 and code `checkout_already_complete` (that purchase is paid) or `checkout_in_progress` (its payment is being confirmed) means nothing new was started.
