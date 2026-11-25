import { hasCredits } from "./config.js"
import { payerCoverage } from "./deployment-payer.js"

/** The plans that include private outputs. Everything else (Free, Basic, pay-as-you-go) is public. */
const PRIVATE_OUTPUTS_TIERS: ReadonlySet<string> = new Set(["standard", "pro", "business"])

/**
 * Whether a person on this STORED plan may keep their outputs private: the one
 * rule, asked by the settings route before it switches private mode on (and
 * reported by its GET as `privateOutputsAllowed`), and by every plan change
 * about the plan it leaves and the plan it lands on
 * (`outputsColumnsForPlanChange`, spread by `tierColumns`), so they cannot
 * drift.
 *
 * Private mode is a Cloud pricing lever: an edition without credits has no plan
 * to buy and the gallery is the operator's own, so every plan may be private
 * there. Under a deployment payer the plan is the payer account's grade
 * (`payerCoverage`), whatever the person's own row says.
 */
export function planAllowsPrivateOutputs(storedTier: string | null | undefined): boolean {
  if (!hasCredits()) return true
  return PRIVATE_OUTPUTS_TIERS.has(payerCoverage()?.tier ?? storedTier ?? "free")
}

/**
 * The profile columns that go with moving a person from the stored plan
 * `fromTier` to `toTier`. Only a DROP, from a plan that includes private
 * outputs to one that does not, returns the setting to public
 * (`public_outputs = true`), so their NEW results are public again. No job row
 * is touched: what they made while private stays private. The database stamps
 * `profiles.outputs_public_since` on this false → true write (migration 713),
 * and the jobs trigger never writes public a row created before it — a row
 * completed while private, or a job still running at the drop — nor one the
 * private switch hid (`jobs.hidden_by_owner_at`, migration 706).
 *
 * Anything else writes nothing: an upgrade, a change between plans that both
 * include it, and a rewrite of a plan without it over a plan without it (a
 * renewal on Basic, a repeated cancellation). The last matters: an account
 * already on Free or Basic with private outputs (downgraded before this rule)
 * is left as it is, never reset in passing by an unrelated write. `fromTier`
 * null means the plan before is not known, which writes nothing either.
 *
 * Spread by `tierColumns()` (ee/billing/tier-columns.ts), which every write of
 * a profile's tier goes through (`profiles-tier-columns.test.ts`), so the reset
 * rides in the same UPDATE as the tier itself and no tier change can miss it.
 */
export function outputsColumnsForPlanChange(fromTier: string | null, toTier: string): { public_outputs?: true } {
  const drops = fromTier !== null && planAllowsPrivateOutputs(fromTier) && !planAllowsPrivateOutputs(toTier)
  return drops ? { public_outputs: true } : {}
}
