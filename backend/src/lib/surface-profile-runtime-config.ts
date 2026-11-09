import { isHttpsOrigin, type RuntimeSurfaceStrings } from "@nodaro/shared/runtime-config"
import { config } from "./config.js"
import { SURFACE_PROFILE_DEFAULT, runtimeSurfaceProfile, surfaceGateOpen, type SurfaceProfile } from "./surface-profile.js"
import { resolveSurfaceStrings, type ReadUiStringManifest } from "./surface-strings.js"

/**
 * The profile a page should be told about, or null whenever the browser should
 * fall back to its own code default: nothing configured, the edition gate
 * closed (community ignores the env, d2), or the configured profile failed to
 * load. The last case is the SURFACE_PROFILE_DEFAULT identity signal
 * `surfaceProfileFailedToLoad` reads; app.ts turns it into exit(1) on a gated
 * edition (H8), so null here is only ever observed for the length of a failed
 * boot.
 */
function configuredProfile(): SurfaceProfile | null {
  if (!process.env.NODARO_SURFACE_PROFILE?.trim()) return null
  if (!surfaceGateOpen()) return null
  const profile = runtimeSurfaceProfile()
  return profile === SURFACE_PROFILE_DEFAULT ? null : profile
}

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
 * default (`configuredProfile`).
 */
export function renderSurfaceProfileForRuntimeConfig(readManifest?: ReadUiStringManifest): string {
  const profile = configuredProfile()
  if (!profile) return ""
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
  // VALIDATION: `strings` arrives raw (the server never reads it) and leaves
  // only as what resolveSurfaceStrings kept: every key in the key manifest the
  // product's build emitted (read here, at boot, only when `strings` is set),
  // every locale offered, plain text with the base placeholders. When nothing
  // survives, or the build left no manifest, the key is left out.
  //
  // Whole-object identity on mainline: with none of the three billing keys
  // and no `strings` set, this is the same single JSON.stringify(profile) it
  // has always been.
  const { payerAccount, defaultAllowanceUnits, allowances } = profile.billing
  const redactBilling = payerAccount !== undefined || defaultAllowanceUnits !== undefined || allowances !== undefined
  if (!redactBilling && profile.strings === undefined) return JSON.stringify(profile)
  const { strings: rawStrings, ...rest } = profile
  const out: Record<string, unknown> = { ...rest }
  if (redactBilling) {
    const {
      payerAccount: _payer,
      defaultAllowanceUnits: _defaultAllowance,
      allowances: _allowances,
      ...billing
    } = profile.billing
    out.billing = billing
  }
  const strings = browserStrings(rawStrings, profile.locale.offered, readManifest)
  if (!strings) return JSON.stringify(out)
  const withStrings = JSON.stringify({ ...out, strings })
  if (Buffer.byteLength(withStrings, "utf8") <= RUNTIME_SURFACE_MAX_BYTES) return withStrings
  console.warn(
    `[surface-profile] strings dropped — the surface with them is ${Buffer.byteLength(withStrings, "utf8")} bytes, over the ${RUNTIME_SURFACE_MAX_BYTES}-byte limit for /config.js`,
  )
  return JSON.stringify(out)
}

/**
 * The most bytes the printed surface may take with `strings` in it. start.sh
 * hands it to the /config.js writer as ONE environment variable, and Linux
 * caps a single one at 128 KiB (MAX_ARG_STRLEN). Over that the writer cannot
 * even start, and /config.js is left empty: every runtime key is lost, not
 * just the strings. So the strings go first, alone.
 */
export const RUNTIME_SURFACE_MAX_BYTES = 120 * 1024

/**
 * The overrides /config.js may carry. A validator failure drops `strings`
 * alone: if this threw, the printer would exit non-zero, start.sh would
 * write no surface at all, and the browser would lose every other key with
 * it (the billing unit, the nav hides, the brand).
 */
function browserStrings(raw: unknown, offered: readonly string[] | undefined, readManifest: ReadUiStringManifest | undefined): RuntimeSurfaceStrings | undefined {
  if (raw === undefined) return undefined
  try {
    return resolveSurfaceStrings(raw, offered, readManifest)
  } catch (err) {
    console.warn("[surface-profile] strings dropped — could not be validated:", (err as Error).message)
    return undefined
  }
}

/**
 * `/config.js`'s `mediaOrigin`: the https origin of the deployment's public
 * media URL (R2_PUBLIC_URL, any path dropped), so a white-label deployment's
 * header may draw its own media, served from a host other than the site.
 *
 * "" unless the surface is white-label, and "" for a media URL that is not
 * https. Every other deployment's `/config.js` stays byte-identical, whatever
 * its media URL.
 */
export function renderMediaOriginForRuntimeConfig(): string {
  if (configuredProfile()?.header !== "white-label" || !config.R2_PUBLIC_URL) return ""
  try {
    const { origin } = new URL(config.R2_PUBLIC_URL)
    return isHttpsOrigin(origin) ? origin : ""
  } catch {
    return ""
  }
}
