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

  it("403 with a challenge marker is blocked; 403 without one is not", () => {
    expect(computeVerdict({ ...ok, status: 403, challenge: { markerCount: 1, coverage: 0.05 } })).toBe("blocked")
    expect(computeVerdict({ ...ok, status: 403 })).toBe("ok")
  })

  it("429 with a challenge marker is blocked; 429 without one is not (spec §4.4 step 7: status AND marker)", () => {
    expect(computeVerdict({ ...ok, status: 429, challenge: { markerCount: 1, coverage: 0 } })).toBe("blocked")
    expect(computeVerdict({ ...ok, status: 429 })).toBe("ok")
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

  it("under 150 visible characters and no heading is empty", () => {
    expect(computeVerdict(summaryOf([], { anchors: [], visibleTextLength: 40 }))).toBe("empty")
  })

  it("a short page that still has a heading is ok", () => {
    expect(computeVerdict({ ...ok, visibleTextLength: 90 })).toBe("ok")
  })
})
