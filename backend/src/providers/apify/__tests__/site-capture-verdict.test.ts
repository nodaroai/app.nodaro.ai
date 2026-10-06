import { describe, expect, it } from "vitest"
import { computeVerdict } from "../site-capture-page.js"
import { LANDING, summaryOf } from "./fixtures/site-capture-summaries.js"

const ok = summaryOf(LANDING)

describe("computeVerdict", () => {
  it("a normal page is ok", () => expect(computeVerdict(ok)).toBe("ok"))

  it.each([
    "Just a moment...",
    "Attention Required! | Cloudflare",
    "Access denied",
    "Pardon Our Interruption",
    "Please verify you are human",
    "Checking your browser before accessing",
    "Request blocked",
    "Are you a robot?",
    "Unusual traffic from your network",
    "DDoS Protection",
    "We're verifying your browser",
  ])("a wall title is blocked: %s", (title) => {
    expect(computeVerdict({ ...ok, title })).toBe("blocked")
  })

  it("a short page asking the visitor to verify is blocked", () => {
    expect(computeVerdict({ ...ok, visibleTextLength: 800, bodyText: "Please verify you are human to continue." })).toBe("blocked")
  })

  it("a long normal page that mentions a wall phrase is ok (Review Focus 2)", () => {
    const bodyText = "Our CDN includes DDoS protection on every plan. " + "lorem ".repeat(800)
    expect(computeVerdict({ ...ok, visibleTextLength: bodyText.length, bodyText })).toBe("ok")
  })

  it("a normal page with the word access in its copy is ok", () => {
    expect(computeVerdict({ ...ok, bodyText: "Get early access to every feature." })).toBe("ok")
  })

  it("403 and 429 are blocked with or without a marker (ruling SP4-R-T4a: a bare 403/429 is the site's own refusal)", () => {
    for (const status of [403, 429]) {
      expect(computeVerdict({ ...ok, status, challenge: { markerCount: 1, coverage: 0.05 } })).toBe("blocked")
      expect(computeVerdict({ ...ok, status })).toBe("blocked")
    }
  })

  it("401 and 503 keep the spec's rule: blocked only with a marker", () => {
    for (const status of [401, 503]) expect(computeVerdict({ ...ok, status, challenge: { markerCount: 1, coverage: 0 } })).toBe("blocked")
    expect(computeVerdict({ ...ok, status: 401 })).toBe("ok")
  })

  it("a 403 with an empty page (g2.com answered this way: HTTP 403, no text) is blocked, not empty", () => {
    expect(computeVerdict(summaryOf([], { anchors: [], status: 403, visibleTextLength: 0, bodyText: "", pageHeight: 839 }))).toBe("blocked")
  })

  it("a 200 page with no text and no marker is still empty", () => {
    expect(computeVerdict(summaryOf([], { anchors: [], status: 200, visibleTextLength: 0, bodyText: "" }))).toBe("empty")
  })

  it("the Vercel Security Checkpoint (429, 'We're verifying your browser') is blocked, not empty (spike run RQ0IC632nbtTpZj3t)", () => {
    const bodyText = "We're verifying your browser Vercel Security Checkpoint iad1::1791214085-8bKlv4sET5FhL1ko2xk1SJGoHdtAcihK"
    const personio = summaryOf([], { anchors: [], status: 429, title: "Vercel Security Checkpoint", bodyText, visibleTextLength: bodyText.length })
    expect(computeVerdict(personio)).toBe("blocked")
  })

  it("a wall status with a wall phrase in the visible text is blocked however long the page is", () => {
    const bodyText = "Access denied. You do not have permission to view this page. " + "lorem ".repeat(800)
    const page = { ...ok, visibleTextLength: bodyText.length, bodyText }
    expect(computeVerdict({ ...page, status: 403 })).toBe("blocked")
    expect(computeVerdict({ ...page, status: 200 })).toBe("ok")
    expect(computeVerdict({ ...page, status: 503 })).toBe("blocked")
  })

  it("a challenge covering more than 30 % of the viewport is blocked", () => {
    expect(computeVerdict({ ...ok, challenge: { markerCount: 1, coverage: 0.5 } })).toBe("blocked")
  })

  it("404, 410 and 5xx without a marker are unreachable", () => {
    for (const status of [404, 410, 500, 503]) expect(computeVerdict({ ...ok, status })).toBe("unreachable")
  })

  it("503 with a marker is blocked, not unreachable", () => {
    expect(computeVerdict({ ...ok, status: 503, challenge: { markerCount: 1, coverage: 0 } })).toBe("blocked")
  })

  // nowsecure.nl, rendered locally on the Pixel 7 descriptor (probe run 1: verdict ok, 1 still of the demo
  // challenge). A Cloudflare Turnstile test widget (.cf-turnstile, data-sitekey 3x00000000000000000000FF) in a
  // 336 x 140 box (12.5 % of the 412 x 915 viewport), a hidden 1 x 1 iframe with an EMPTY src, 43 visible
  // characters, status 200. None of the spec's three signals fire: no wall phrase in the DOM text (the widget
  // paints "Verify you are human" itself), no wall status, coverage under 30 %.
  describe("a challenge widget on a page with nothing else (ruling SP4-R-T4b)", () => {
    const nowsecure = summaryOf(LANDING, {
      status: 200,
      title: "nowsecure.nl",
      bodyText: "NOWSECURE\nBY NODRIVER\nNOWSECURE\nBY NODRIVER",
      visibleTextLength: 43,
      challenge: { markerCount: 2, coverage: 0.125 },
    })
    it("is blocked", () => expect(computeVerdict(nowsecure)).toBe("blocked"))
    it("a real page with a Turnstile on its contact form is ok", () => {
      expect(computeVerdict({ ...ok, challenge: { markerCount: 1, coverage: 0.03 } })).toBe("ok")
    })
    it("a short page with a heading and no widget is ok", () => {
      expect(computeVerdict({ ...nowsecure, challenge: { markerCount: 0, coverage: 0 } })).toBe("ok")
    })
  })

  it("under 150 visible characters and no heading is empty", () => {
    expect(computeVerdict(summaryOf([], { anchors: [], visibleTextLength: 40 }))).toBe("empty")
  })

  it("a short page that still has a heading is ok", () => {
    expect(computeVerdict({ ...ok, visibleTextLength: 90 })).toBe("ok")
  })
})
