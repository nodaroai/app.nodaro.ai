import { SURFACE_PROFILE_DEFAULT, runtimeSurfaceProfile, surfaceGateOpen } from "./surface-profile.js"

/**
 * The deployment surface profile as the BROWSER must receive it (SAI-3 / H10).
 *
 * `/config.js` used to carry the RAW `NODARO_SURFACE_PROFILE` value: start.sh
 * handed the env to tools/build-runtime-config.mjs, which had its own
 * `JSON.parse` + edition gate and no schema, so the browser rendered an object
 * the backend never validated. Harmless while every key was a string list
 * (`nodes.deny: ["x", 42]` → `["x"]` server, `["x", 42]` browser — both fine
 * for `.includes()`); fatal the moment a key drives ARITHMETIC — a typo'd
 * `billing` block is dropped whole server-side (raw credits, "CR") while the
 * browser still reads the rate and multiplies every canvas estimate by it.
 *
 * This is the one resolver: the same gate → parse → merge → refine funnel the
 * backend serves from (`runtimeSurfaceProfile`), rendered for the /config.js
 * writer, which now passes it through verbatim. The browser can therefore never
 * see a key the backend dropped, by construction rather than by drift test.
 *
 * Returns "" — not "{}" — whenever the browser should fall back to its own code
 * default: nothing configured, the edition gate closed (community ignores the
 * env, d2), or the configured profile failed to load. The last case is the
 * SURFACE_PROFILE_DEFAULT identity signal `surfaceProfileFailedToLoad` reads;
 * app.ts turns it into exit(1) on a gated edition (H8), so "" here is only ever
 * observed for the length of a failed boot.
 */
export function renderSurfaceProfileForRuntimeConfig(): string {
  if (!process.env.NODARO_SURFACE_PROFILE?.trim()) return ""
  if (!surfaceGateOpen()) return ""
  const profile = runtimeSurfaceProfile()
  if (profile === SURFACE_PROFILE_DEFAULT) return ""
  // REDACTION: three `billing` keys are backend-only by contract, and
  // /config.js is world-readable — so they are stripped here, at the ONE
  // render point, rather than trusted to a frontend that must never receive
  // them.
  //
  //  - `payerAccount` — the deployment payer's identity (a uuid or email).
  //    The browser learns "one account pays" through GET /v1/billing/surface's
  //    `deploymentPayer` flag instead.
  //  - `defaultAllowanceUnits` — a business figure (the seed for the payer's
  //    per-user allocation). Nobody's browser needs the number, and every user
  //    would otherwise read the deployment's allocation policy off a static
  //    script.
  //  - `allowances` — the enforcement gate. The browser learns whether an
  //    allowance applies from the `allowance` field on ITS OWN balance
  //    (D12), which is the requester's own figure; a global flag would tell it
  //    something it must never act on.
  //
  // Whole-object identity on mainline: with none of the three set, this is the
  // same single JSON.stringify(profile) it has always been.
  const { payerAccount, defaultAllowanceUnits, allowances } = profile.billing
  if (payerAccount !== undefined || defaultAllowanceUnits !== undefined || allowances !== undefined) {
    const {
      payerAccount: _payer,
      defaultAllowanceUnits: _defaultAllowance,
      allowances: _allowances,
      ...billing
    } = profile.billing
    return JSON.stringify({ ...profile, billing })
  }
  return JSON.stringify(profile)
}
