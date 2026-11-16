/**
 * The deployment profiles the input-link recordings run under: no profile,
 * link imports off, link imports on — and, since the lever exists
 * (`imports.inputLinks`), each of its values on either side of the switch.
 * Each recording asserts what a request with an outside media link (and one
 * on this deployment's own storage) does under each, so a change to what an
 * input link does is a change to a recording.
 */
import { __resetSurfaceProfileCacheForTests } from "../../surface-profile.js"
import { __resetInputLinkReportsForTests } from "../../input-links.js"

export interface InputLinkProfile {
  readonly name: string
  /** The surface profile, or undefined for none at all. */
  readonly profile: Record<string, unknown> | undefined
}

/** The profiles in place before the input-link lever exists. */
export const TODAYS_PROFILES: readonly InputLinkProfile[] = [
  { name: "no profile", profile: undefined },
  { name: "link imports off", profile: { imports: { links: false } } },
  { name: "link imports on", profile: { imports: { links: true } } },
]

/**
 * The profiles under which nothing may change, the lever included: the lever
 * at "allow" with link imports off, and every value of it with link imports on.
 */
export const LEVER_INERT_PROFILES: readonly InputLinkProfile[] = [
  { name: "link imports off, inputLinks allow", profile: { imports: { links: false, inputLinks: "allow" } } },
  { name: "link imports on, inputLinks allow", profile: { imports: { links: true, inputLinks: "allow" } } },
  { name: "link imports on, inputLinks report", profile: { imports: { links: true, inputLinks: "report" } } },
  { name: "link imports on, inputLinks refuse", profile: { imports: { links: true, inputLinks: "refuse" } } },
]

/** Link imports off, input links reported. */
export const REPORT_PROFILE: InputLinkProfile = { name: "link imports off, inputLinks report", profile: { imports: { links: false, inputLinks: "report" } } }

/** Link imports off, input links refused. */
export const REFUSE_PROFILE: InputLinkProfile = { name: "link imports off, inputLinks refuse", profile: { imports: { links: false, inputLinks: "refuse" } } }

/** Sets NODARO_SURFACE_PROFILE (or clears it), drops the memoized profile and the input-link counts. */
export function useProfile(profile: Record<string, unknown> | undefined): void {
  if (profile === undefined) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  __resetSurfaceProfileCacheForTests()
  __resetInputLinkReportsForTests()
}

/** The `[input-links]` lines a console.warn spy saw. */
export function inputLinkLines(warn: { mock: { calls: unknown[][] } }): string[] {
  return warn.mock.calls.map((c) => String(c[0])).filter((line) => line.startsWith("[input-links]"))
}

/** An outside media host, and this deployment's own storage (set as R2_PUBLIC_URL by each recording). */
export const OUTSIDE_HOST = "https://cdn.example"
export const OWN_STORAGE = "https://media.nodaro.test"
