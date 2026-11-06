---
"@nodaro/sdk": patch
---

`billing.changePlan()` and `billing.checkout()` document how plan changes are billed: an upgrade is charged at once and applies only when paid, adding the difference between the plans' monthly credits once per billing period; a plan's checkout answers 409 while the account already has a subscription; promotion codes apply to plans, not credit packs. An upgrade waiting on its payment answers a 409 `NodaroError` with code `plan_change_payment_required` and `details.invoiceUrl`; plan changes are limited to 5 per account per day.
