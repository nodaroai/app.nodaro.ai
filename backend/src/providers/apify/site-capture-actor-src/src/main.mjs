// Nodaro Site Capture — one web page, the way a phone shows it.
//
// The page script itself is passed in as input (`pageScript`, built by
// backend/src/providers/apify/site-capture-page.ts :: buildPageFunctionSource), so this actor only
// owns what a generic scraper cannot: the phone browser context. Device scale factor, isMobile and
// hasTouch are context options fixed when the context is created, and the official scrapers create
// that context themselves and overwrite the user agent and DPR with a fingerprint layer. Here the
// context is Playwright's own Pixel 7 descriptor, with no fingerprint injection.
//
// Like a generic scraper's pageFunction, the script is the caller's own code, run in the caller's
// own Apify run. What the run leaves behind is exactly what the provider reads
// (backend/src/providers/apify/site-capture.ts):
//   - default key-value store: FULL_PAGE (JPEG, CSS scale) and STILL_<i> (device scale), written by
//     the page script through `context.Actor.setValue` — plus the INPUT record Apify keeps itself;
//   - default dataset: ONE item — the page script's CaptureItem (`verdict`, `sections`, `stills`, …),
//     or, when navigation or the script failed, `{ "#error": true, stage, errorMessages, #debug }`.
// Nothing else is written: no crawler, no request queue, no session or statistics state.
//
// Proxy: off by default. The official scrapers cannot run without the Apify proxy, and its
// datacenter IPs are walled by some sites; this actor can. A residential group is refused (Nodaro
// never uses residential proxies).
import { Actor } from "apify"
import { chromium, devices } from "playwright"

const UA_TOKEN = " NodaroCapture/1.0 (+https://nodaro.ai/capture)"
const NAVIGATION_TIMEOUT_MS = 60_000

/** The proxy to launch with, or undefined for a direct connection (the default). */
async function resolveProxy(proxyInput) {
  const pc = proxyInput && typeof proxyInput === "object" ? proxyInput : {}
  const groups = Array.isArray(pc.apifyProxyGroups) ? pc.apifyProxyGroups : []
  if (groups.some((g) => /residential/i.test(String(g)))) {
    throw new Error("residential proxies are not allowed for Nodaro Site Capture")
  }
  const customUrls = Array.isArray(pc.proxyUrls) && pc.proxyUrls.length > 0
  // Only an explicit opt-in turns a proxy on. Actor.createProxyConfiguration({}) would pick the
  // Apify proxy in "auto" mode, so an empty or missing object must never reach it.
  if (pc.useApifyProxy !== true && !customUrls) return undefined
  const config = await Actor.createProxyConfiguration({
    useApifyProxy: pc.useApifyProxy === true,
    ...(groups.length ? { groups } : {}),
    ...(pc.apifyProxyCountry ? { countryCode: pc.apifyProxyCountry } : {}),
    ...(customUrls ? { proxyUrls: pc.proxyUrls } : {}),
  })
  if (!config) return undefined
  const proxyUrl = new URL(await config.newUrl())
  return {
    server: `${proxyUrl.protocol}//${proxyUrl.host}`,
    ...(proxyUrl.username ? { username: decodeURIComponent(proxyUrl.username) } : {}),
    ...(proxyUrl.password ? { password: decodeURIComponent(proxyUrl.password) } : {}),
  }
}

function errorItem(url, stage, err) {
  const message = String(err && err.message ? err.message : err)
  // Both shapes: our own `errorMessages`, and the official scrapers' `#debug.errorMessages`.
  return { "#error": true, url, stage, errorMessages: [message], "#debug": { url, errorMessages: [message] } }
}

await Actor.init()
let browser
try {
  const input = (await Actor.getInput()) ?? {}
  const { url, pageScript } = input
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) throw new Error("input.url must be an http(s) URL")
  if (typeof pageScript !== "string" || pageScript.trim().length === 0) throw new Error("input.pageScript is required")
  const pageFunction = new Function(`return (${pageScript})`)()
  if (typeof pageFunction !== "function") throw new Error("input.pageScript must evaluate to a function")
  const proxy = await resolveProxy(input.proxyConfiguration)

  const pixel = devices["Pixel 7"]
  browser = await chromium.launch({ headless: true, ...(proxy ? { proxy } : {}) })
  const { defaultBrowserType: _unused, ...descriptor } = pixel
  const context = await browser.newContext({ ...descriptor, userAgent: `${pixel.userAgent}${UA_TOKEN}` })
  const page = await context.newPage()

  let item
  let response
  try {
    response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS })
  } catch (err) {
    item = errorItem(url, "navigation", err)
  }
  if (!item) {
    try {
      item = await pageFunction({ page, response, request: { url }, Actor })
    } catch (err) {
      item = errorItem(url, "pageScript", err)
    }
  }
  await Actor.pushData(item)
} catch (err) {
  // Bad input or a refused proxy: the run fails, with the reason as its status message.
  if (browser) await browser.close().catch(() => undefined)
  browser = undefined
  await Actor.fail(String(err && err.message ? err.message : err))
} finally {
  if (browser) await browser.close().catch(() => undefined)
}
await Actor.exit()
