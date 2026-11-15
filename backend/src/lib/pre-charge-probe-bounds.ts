/**
 * The bounds a measure before a charge runs under (Trim, Loop and Combine
 * Videos since they were measured; Video SFX and AI Avatar since they read a
 * header-less recording the same way). A leaf, so any measuring module can
 * share them without the modules that use them.
 */

/** How long one clip's header read before a charge may take, on every path. */
export const PRE_CHARGE_PROBE_TIMEOUT_MS = 30_000

/**
 * How long a route may spend measuring a request's clips before its charge, all
 * clips together: below the about 100 seconds the proxy in front of the API
 * waits for an answer, so a client always gets one.
 */
export const ROUTE_MEASURE_DEADLINE_MS = 90_000
