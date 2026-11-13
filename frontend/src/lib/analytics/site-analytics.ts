import { whenActivated } from "@/lib/prerender"
import { gaVisitIdsFromCookies, type GaVisitIds } from "./ga-cookies"

/**
 * The app's own events in the site analytics: Google Analytics (GA4, a tag in
 * the shared tag container) and Microsoft Clarity.
 *
 * Inert by construction; index.html's analytics loader is the one gate (never
 * inside an iframe or on a public surface, the production host only, only once
 * the page is shown, only with ids configured):
 * - GA4: only once the loader has loaded the container AND exposed the tag's
 *   measurement id (`window.__NODARO_GA__`, set from VITE_GA_ID). Without it
 *   nothing here reaches the data layer.
 * - Clarity: only when the loader loaded Clarity (it defines `window.clarity`);
 *   it then gets the same events and the signed-in account's id.
 * So a self-hosted install, a local build and the test runner send nothing
 * anywhere. Nothing here throws into the app.
 *
 * Everything waits for the page to be shown (lib/prerender.ts): a prerendered
 * page may never be, and its loader has not run yet. The loader's own
 * activation listener was registered first, so by the time anything here runs
 * on activation, the container and the measurement id are in place.
 *
 * Why gtag-style commands, addressed with `send_to`: the container's GA4 tag
 * reads a command from the data layer only as a real `arguments` object, and
 * an `event` command reaches it only when it names the measurement id (a plain
 * `{ event: … }` object fires no tag at all). A `set` command needs no id and
 * applies to every later hit, page views included.
 *
 * What is sent about a person: their internal account id, their plan, and
 * whether they are staff — never an email or a name.
 */

/**
 * localStorage key, "1" on a browser where a staff account signed in. index.html
 * reads it before the container loads, so a staff visit's very first hit is
 * marked internal too (the role is known only after the profile loads).
 */
export const STAFF_BROWSER_KEY = "nodaro.analytics.staff"

/** The events the app sends: GA4's recommended names where one exists. */
export type AnalyticsEvent = "sign_up" | "login" | "workflow_run" | "begin_checkout"

type ParamValue = string | number | boolean
export type AnalyticsItem = Readonly<Record<string, ParamValue>>
export type AnalyticsParams = Readonly<Record<string, ParamValue | ReadonlyArray<AnalyticsItem>>>

export interface AnalyticsIdentity {
  /** The account's internal id. */
  readonly userId: string
  /** Nodaro's own people: their traffic is marked internal, which the reports filter out. */
  readonly staff: boolean
  /** The account's plan, a user property to segment by. */
  readonly plan: string
}

interface AnalyticsWindow {
  dataLayer?: unknown
  clarity?: unknown
  /** Set by the loader: the GA4 measurement id, and whether this page already carries the internal mark. */
  __NODARO_GA__?: { readonly measurementId?: unknown; readonly internal?: unknown }
}

const MEASUREMENT_ID = /^G-[A-Z0-9]{4,20}$/

function analyticsWindow(): AnalyticsWindow | null {
  return typeof window === "undefined" ? null : (window as unknown as AnalyticsWindow)
}

/** The GA4 measurement id the loader exposed, or null when it loaded no container. */
export function loadedMeasurementId(): string | null {
  const id = analyticsWindow()?.__NODARO_GA__?.measurementId
  return typeof id === "string" && MEASUREMENT_ID.test(id) ? id : null
}

/** One gtag-style command onto the data layer, as the `arguments` object the container reads. */
function pushCommand(...command: unknown[]): void {
  const layer = analyticsWindow()?.dataLayer
  if (!Array.isArray(layer) || command.length === 0) return
  // eslint-disable-next-line prefer-rest-params
  layer.push(arguments)
}

function callClarity(...command: unknown[]): void {
  const call = analyticsWindow()?.clarity
  if (typeof call === "function") (call as (...args: unknown[]) => void)(...command)
}

/** Send one of the app's events, once the page is shown. Never throws. */
export function trackEvent(name: AnalyticsEvent, params: AnalyticsParams = {}): void {
  whenActivated(() => {
    try {
      const measurementId = loadedMeasurementId()
      if (measurementId) pushCommand("event", name, { ...params, send_to: measurementId })
      callClarity("event", name)
    } catch {
      // Analytics never breaks the app.
    }
  })
}

// What this page has already told the analytics: so an identity re-read on
// every token refresh or tab focus pushes nothing new, and the internal mark
// changes only when it differs from what this page carries — starting from
// what the loader pushed (another tab may have changed the browser's key since).
let sentIdentity: AnalyticsIdentity | null = null
let pageMarkedInternal: boolean | null = null

/**
 * Tell the analytics who is signed in (null: nobody), once the page is shown.
 * Called on every session change; pushes only what changed. Never throws.
 */
export function syncAnalyticsIdentity(identity: AnalyticsIdentity | null): void {
  whenActivated(() => {
    try {
      if (sameIdentity(identity, sentIdentity)) return
      const previous = sentIdentity
      sentIdentity = identity
      const ga = loadedMeasurementId() !== null
      if (pageMarkedInternal === null) pageMarkedInternal = analyticsWindow()?.__NODARO_GA__?.internal === true
      if (!identity) {
        // Signed out: later hits are nobody's. The staff mark stays — the
        // browser is still a staff member's.
        if (previous && ga) pushCommand("set", { user_id: null })
        return
      }
      if (ga && identity.staff !== pageMarkedInternal) {
        pushCommand("set", { traffic_type: identity.staff ? "internal" : null })
        pageMarkedInternal = identity.staff
        writeStaffBrowser(identity.staff)
      }
      if (ga) {
        pushCommand("set", { user_id: identity.userId })
        pushCommand("set", "user_properties", { plan: identity.plan })
      }
      callClarity("identify", identity.userId)
      callClarity("set", "plan", identity.plan)
      if (identity.staff) callClarity("set", "staff", "yes")
    } catch {
      // Analytics never breaks the app.
    }
  })
}

function sameIdentity(a: AnalyticsIdentity | null, b: AnalyticsIdentity | null): boolean {
  if (!a || !b) return a === b
  return a.userId === b.userId && a.staff === b.staff && a.plan === b.plan
}

function writeStaffBrowser(staff: boolean): void {
  try {
    if (staff) localStorage.setItem(STAFF_BROWSER_KEY, "1")
    else localStorage.removeItem(STAFF_BROWSER_KEY)
  } catch {
    // Storage unavailable: only the first hit of a later visit goes unmarked.
  }
}

/**
 * The visitor's GA ids for a checkout request, so the payment can be reported
 * against this visit. Empty unless the loader loaded the container.
 */
export function checkoutAnalyticsIds(): GaVisitIds {
  try {
    const measurementId = loadedMeasurementId()
    if (!measurementId || typeof document === "undefined") return {}
    return gaVisitIdsFromCookies(document.cookie, measurementId)
  } catch {
    return {}
  }
}

/** Test seam: forget what this page has sent. */
export function resetAnalyticsStateForTests(): void {
  sentIdentity = null
  pageMarkedInternal = null
}
