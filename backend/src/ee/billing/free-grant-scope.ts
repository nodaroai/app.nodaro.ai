import { deploymentPayerActive } from "../../lib/deployment-payer.js"

/**
 * Where personal free credits apply at all.
 *
 * The free signup grant — and the welcome offer that hands it out — tops up a
 * person's OWN balance. On a deployment with a single payer every run is
 * billed to the deployment's billing account instead (`lib/deployment-payer.ts`),
 * so a personal grant there is a balance nothing ever spends, and free credits
 * nobody decided to give the day that deployment stops having a payer. So no
 * path grants one there:
 *
 *  - the routes that hand them out (the boot-time claim, the welcome offer's
 *    claim and its popup stamp, the admin restore) refuse with
 *    `SIGNUP_GRANTS_NOT_APPLICABLE`, before they read or write anything;
 *  - the transitions in `signup-grant.ts` move nothing whoever calls them —
 *    the Stripe webhook's purchase exit included — so a caller added later
 *    cannot forget to ask.
 *
 * The balance read's fallback claim was already skipped under a payer
 * (`ee/routes/credits.ts`), and the admin take-back already refused with the
 * same answer. Inert without a payer: `deploymentPayerActive()` is false and
 * every caller takes exactly its previous path.
 */
export function signupGrantsApply(): boolean {
  return !deploymentPayerActive()
}

/**
 * The one answer a free-credit route gives where they do not apply (409, like
 * `welcome_offer_disabled`). The admin take-back has answered with exactly this
 * since before the other routes did; one body keeps one code per fact.
 */
export const SIGNUP_GRANTS_NOT_APPLICABLE = {
  error: { code: "not_applicable", message: "Free signup credits do not apply on this deployment." },
} as const
