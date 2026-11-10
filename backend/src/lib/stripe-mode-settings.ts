/**
 * STRIPE_REQUIRE_TEST_MODE (docs/deployment.md): a deployment that must never
 * reach Stripe's live mode, such as a staging environment running on a copy of
 * production's database. Set to `true`, the server refuses to start while any
 * setting holds a live Stripe key (a secret, restricted or publishable one:
 * `sk_live_`, `rk_live_`, `pk_live_`), naming each such setting and never the
 * key. Unset or empty: nothing is checked, as before. Any other value stops the
 * server from starting, so a typo (`TRUE`, `1`, a trailing newline) never
 * leaves the guard quietly off.
 *
 * Pure, so lib/config.ts can refuse at boot, in every process.
 */

// A key starts a word: `task_live_…` or `network_live_…` is no key.
const LIVE_STRIPE_KEY = /(?<![A-Za-z0-9_])(?:sk|rk|pk)_live_[A-Za-z0-9]/

/** Why these settings cannot run, starting with the setting's name; null when they can. */
export function liveStripeKeyProblem(env: Readonly<Record<string, string | undefined>>): string | null {
  const setting = env.STRIPE_REQUIRE_TEST_MODE ?? ""
  if (setting === "") return null
  // Only `true` turns the guard on; any other value is refused rather than read as off, so a typo never disables it.
  if (setting !== "true") return "STRIPE_REQUIRE_TEST_MODE must be `true` or unset"
  const holding = Object.keys(env)
    .filter((name) => LIVE_STRIPE_KEY.test(env[name] ?? ""))
    .sort()
  if (holding.length === 0) return null
  return `STRIPE_REQUIRE_TEST_MODE is on, and ${holding.join(", ")} ${holding.length === 1 ? "holds" : "hold"} a live Stripe key: this deployment may use Stripe's test mode only`
}
