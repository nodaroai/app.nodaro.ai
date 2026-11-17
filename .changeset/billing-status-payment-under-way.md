---
"@nodaro/sdk": minor
---

`billing.checkoutStatus()` answers `paymentUnderWay`. `true` means a `checkout()` or `loadCredits()` naming that session as `replacesSessionId` would be refused `checkout_in_progress`. `false` means no submitted payment is seen on the session; a replacement can still be refused, so after a `checkout_in_progress` ask again once the status reads `open` with `paymentUnderWay: false`, or `expired`, and then only on the person's action or with spaced retries. The field is optional in `BillingCheckoutStatus`: an older platform leaves it out. A `replacesSessionId` that names a session of another purchase (a pack's session for a plan, another pack, another load amount) is now a `NotFoundError` with code `checkout_session_not_found`, as for a session that is not yours.
