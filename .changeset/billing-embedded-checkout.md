---
"@nodaro/sdk": minor
---

Buy inside your own page. `billing.checkout()` and `billing.loadCredits()` take `uiMode: "embedded"` (the new `BillingUiMode`; absent or `"hosted"` is the Stripe Checkout page, as before) and then answer `{ url: null, clientSecret, sessionId }` (a load adds `credits`) for Stripe's embedded Checkout, which never redirects. `billing.plans()` gains `stripePublishableKey` (`string | null`; `null` means the deployment has no embedded form: use the page). The new `billing.checkoutStatus(sessionId)` answers `{ status, paymentStatus, mode, granted }` (`BillingCheckoutStatus`) for one of your own sessions; poll it after the form completes until `granted` is true.
