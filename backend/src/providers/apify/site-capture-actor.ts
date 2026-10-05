/**
 * The Apify actor Site Capture runs, and how. These values were fixed by a test
 * run of every candidate before the capture shipped; change them only with a new
 * test run (site-capture-actor.test.ts checks their shape).
 */
export interface SiteCaptureActorConfig {
  /** "B": a generic scraper runs our page function. "B-prime": our own actor runs it. */
  readonly option: "B" | "B-prime"
  readonly apifyActorId: string
  /** The actor build tag, pinned so an upstream input change cannot break capture. */
  readonly build: string
  readonly memoryMbytes: number
  /** Apify aborts the run here, so billing stops. */
  readonly runTimeoutSecs: number
  /** How long the call waits before the run is aborted. */
  readonly waitSecs: number
  readonly stillFormat: "png" | "jpeg"
  readonly proxyConfiguration: Readonly<Record<string, unknown>>
  /** Option B: the scraper input fields that set the phone viewport, scale, touch and user agent. */
  readonly deviceInput: Readonly<Record<string, unknown>>
  /** Delete a run's storages once a completed capture is read; failed runs are kept. */
  readonly deleteStoragesAfterSuccess: boolean
}

/**
 * Nodaro's own actor (`nodaro-site-capture`, source in ./site-capture-actor-src). It owns the
 * Playwright "Pixel 7" context and appends the NodaroCapture user-agent token itself, so the
 * run input is only `{ url, pageScript, maxStills, proxyConfiguration }` and `deviceInput`
 * stays empty. Its navigation timeout is fixed at 60 s inside the actor. Pass build, memory and
 * timeout on every start: the actor's own defaults (latest build, 1,024 MB, 300 s) are not ours.
 */
export const SITE_CAPTURE_ACTOR: SiteCaptureActorConfig = {
  option: "B-prime",
  apifyActorId: "acjahOC5bWmkdpwxT", // gitleaks:allow — an actor id, not a credential
  build: "0.1.1",
  memoryMbytes: 4096,
  runTimeoutSecs: 150,
  waitSecs: 170,
  stillFormat: "png",
  // A direct connection. The actor refuses residential proxies.
  proxyConfiguration: { useApifyProxy: false },
  deviceInput: {},
  deleteStoragesAfterSuccess: true,
}
