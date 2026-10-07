import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ safeFetch: vi.fn() }))
vi.mock("../safe-fetch.js", () => ({ safeFetch: h.safeFetch }))

const { checkRobots, classifyRobotsFetchError, isPathAllowed, robotsPatternMatches, rulesFor, ROBOTS_MAX_BYTES } = await import("../site-capture-robots.js")

const answer = (status: number, body = "") => vi.fn(async () => new Response(body, { status }))
const netError = (code: string) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`getaddrinfo ${code} example.test`), { code }) })

describe("rulesFor — which group applies (RFC 9309)", () => {
  const text = ["User-agent: *", "Disallow: /all", "", "User-agent: NodaroCapture", "Disallow: /ours"].join("\n")
  it("the product-token group beats *", () => {
    expect(rulesFor(text, "NodaroCapture")).toEqual([{ allow: false, pattern: "/ours" }])
  })
  it("matches the token case-insensitively", () => {
    expect(rulesFor(text.replace("NodaroCapture", "nodarocapture"), "NodaroCapture")).toEqual([{ allow: false, pattern: "/ours" }])
  })
  it("falls back to * when no group names the token", () => {
    expect(rulesFor("User-agent: *\nDisallow: /all", "NodaroCapture")).toEqual([{ allow: false, pattern: "/all" }])
  })
  it("a group with only an empty Disallow still applies, and allows everything", () => {
    expect(rulesFor("User-agent: *\nDisallow: /\n\nUser-agent: NodaroCapture\nDisallow:", "NodaroCapture")).toEqual([])
  })
})

describe("isPathAllowed — the longest match wins, Allow wins a tie", () => {
  it("longest match", () => {
    expect(isPathAllowed([{ allow: false, pattern: "/a" }, { allow: true, pattern: "/a/b" }], "/a/b/c")).toBe(true)
    expect(isPathAllowed([{ allow: true, pattern: "/a" }, { allow: false, pattern: "/a/b" }], "/a/b/c")).toBe(false)
  })
  it("Allow wins a tie", () => {
    expect(isPathAllowed([{ allow: false, pattern: "/p" }, { allow: true, pattern: "/p" }], "/p")).toBe(true)
  })
  it("* and $ are honoured", () => {
    expect(isPathAllowed([{ allow: false, pattern: "/*.pdf$" }], "/files/x.pdf")).toBe(false)
    expect(isPathAllowed([{ allow: false, pattern: "/*.pdf$" }], "/files/x.pdf?y=1")).toBe(true)
  })
  it("no matching rule allows", () => expect(isPathAllowed([{ allow: false, pattern: "/private" }], "/")).toBe(true))
})

describe("checkRobots — the pre-flight", () => {
  beforeEach(() => h.safeFetch.mockReset())

  it("reads <origin>/robots.txt through safeFetch with a 5 s timeout and the product token", async () => {
    h.safeFetch.mockResolvedValue(new Response("User-agent: *\nAllow: /", { status: 200 }))
    expect(await checkRobots("https://example.com/pricing?x=1")).toBe("allowed")
    expect(h.safeFetch).toHaveBeenCalledWith("https://example.com/robots.txt", expect.objectContaining({ timeoutMs: 5000 }))
    const init = h.safeFetch.mock.calls[0]![1] as { headers: Record<string, string> }
    expect(init.headers["user-agent"]).toContain("NodaroCapture/1.0 (+https://nodaro.ai/capture)")
  })

  it("a real Disallow on the exact path is disallowed", async () => {
    expect(await checkRobots("https://example.com/private/page", { fetch: answer(200, "User-agent: *\nDisallow: /private") })).toBe("disallowed")
  })

  it("4xx means everything is allowed", async () => {
    expect(await checkRobots("https://example.com/", { fetch: answer(404) })).toBe("allowed")
  })

  it("5xx is robots_unreachable, never disallowed", async () => {
    expect(await checkRobots("https://example.com/", { fetch: answer(503) })).toBe("unreachable")
  })

  it("a read timeout is robots_unreachable", async () => {
    const fetch = vi.fn(async () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError") })
    expect(await checkRobots("https://example.com/", { fetch })).toBe("unreachable")
  })

  it.each(["ENOTFOUND", "ECONNREFUSED", "CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID"])("%s is site_unreachable", async (code) => {
    const fetch = vi.fn(async () => { throw netError(code) })
    expect(await checkRobots("https://example.com/", { fetch })).toBe("site_unreachable")
  })

  it.each([
    "safeFetch: blocked — 10.0.0.1 is a private/reserved IP",
    "safeFetch: refusing connection — DNS resolution includes private/reserved IP 10.0.0.1",
  ])("a safeFetch refusal is refused_address: %s", async (message) => {
    const fetch = vi.fn(async () => { throw new Error(message) })
    expect(await checkRobots("https://example.com/", { fetch })).toBe("refused_address")
  })

  it("more than five redirects counts as unavailable, so allowed (Review Focus 1)", async () => {
    const fetch = vi.fn(async () => { throw new Error("safeFetch: blocked — more than 5 redirects") })
    expect(await checkRobots("https://example.com/", { fetch })).toBe("allowed")
  })

  it("an HTML soft-404 robots.txt allows everything (Review Focus 1)", async () => {
    expect(await checkRobots("https://example.com/", { fetch: answer(200, "<!doctype html><html><body>Not found</body></html>") })).toBe("allowed")
  })

  it("a body over 512 KB is cut at the cap", async () => {
    const body = "# " + "x".repeat(ROBOTS_MAX_BYTES) + "\nUser-agent: *\nDisallow: /"
    expect(await checkRobots("https://example.com/", { fetch: answer(200, body) })).toBe("allowed")
  })

  it("an unclassifiable network error is robots_unreachable (no charge, no job)", () => {
    expect(classifyRobotsFetchError(new Error("socket hang up"))).toBe("unreachable")
  })
})

describe("robotsPatternMatches — * and $ without a regex", () => {
  it.each([
    ["/a", "/a/b", true],
    ["/a", "/b", false],
    ["/a$", "/a", true],
    ["/a$", "/a/", false],
    ["/*.pdf$", "/files/x.pdf", true],
    ["/*.pdf$", "/files/x.pdf?y=1", false],
    ["/*.pdf", "/files/x.pdf?y=1", true],
    ["/**a***b", "/xaxxb", true],
    ["/*a*b", "/xbxa", false],
    ["*", "/anything", true],
    ["/a*$", "/abc", true],
    ["/ab*ba$", "/aba", false],
    ["/a$b", "/a$b/c", true],
    ["/a$b", "/ab", false],
  ])("%s on %s is %s", (pattern, path, expected) => {
    expect(robotsPatternMatches(pattern, path)).toBe(expected)
  })

  it("agrees with the anchored regex reading of the pattern on every short case", () => {
    const viaRegex = (pattern: string, path: string) => {
      const anchored = pattern.endsWith("$")
      const body = anchored ? pattern.slice(0, -1) : pattern
      const escaped = body.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")
      return new RegExp(`^${escaped}${anchored ? "$" : ""}`).test(path)
    }
    const alphabet = ["a", "b", "*", "$", "/"]
    const strings = (n: number): string[] => (n === 0 ? [""] : strings(n - 1).flatMap((s) => alphabet.map((c) => s + c)))
    const patterns = [1, 2, 3, 4].flatMap(strings)
    const paths = [0, 1, 2, 3, 4].flatMap(strings).filter((s) => !s.includes("*"))
    const disagreements: string[] = []
    for (const pattern of patterns) {
      for (const path of paths) if (robotsPatternMatches(pattern, path) !== viaRegex(pattern, path)) disagreements.push(`${pattern} on ${path}`)
    }
    expect(disagreements).toEqual([])
  })

  it("a pattern full of * against a 2048-character path that never matches returns at once", () => {
    const path = `/${"a".repeat(2047)}`
    const rules = [
      { allow: false, pattern: `/${"*a".repeat(50)}*b` },
      { allow: false, pattern: `/${"*a".repeat(50)}*b$` },
      { allow: false, pattern: "/*a*a*a*a*a*a*a*a*b" },
    ]
    const t0 = performance.now()
    expect(isPathAllowed(rules, path)).toBe(true)
    expect(performance.now() - t0).toBeLessThan(50)
  })
})

describe("parsing stays linear in the size of robots.txt", () => {
  it("45,000 rules in one group parse quickly and all apply", () => {
    const text = ["User-agent: *", ...Array.from({ length: 45_000 }, (_, i) => `Disallow: /a${i}`)].join("\n")
    const t0 = performance.now()
    const rules = rulesFor(text, "NodaroCapture")
    expect(performance.now() - t0).toBeLessThan(250)
    expect(rules).toHaveLength(45_000)
    expect(isPathAllowed(rules, "/a44999")).toBe(false)
  })

  it("a group naming several agents shares its rules once with each", () => {
    const text = ["User-agent: NodaroCapture", "User-agent: NodaroCapture/1.0", "User-agent: other", "Disallow: /x", "Allow: /x/y"].join("\n")
    expect(rulesFor(text, "NodaroCapture")).toEqual([{ allow: false, pattern: "/x" }, { allow: true, pattern: "/x/y" }])
    expect(rulesFor(text, "other")).toEqual([{ allow: false, pattern: "/x" }, { allow: true, pattern: "/x/y" }])
  })

  it("two groups naming the same agent are merged", () => {
    const text = ["User-agent: *", "Disallow: /a", "", "User-agent: *", "Disallow: /b"].join("\n")
    expect(rulesFor(text, "NodaroCapture")).toEqual([{ allow: false, pattern: "/a" }, { allow: false, pattern: "/b" }])
  })

  it.each([
    ["spaces before a line separator", `Disallow:${" ".repeat(400_000)}x\u2028y`],
    ["hashes before a line separator", `${"#".repeat(400_000)}\u2028`],
  ])("a long line of %s does not backtrack", (_, line) => {
    const t0 = performance.now()
    rulesFor(`User-agent: *\n${line}\nDisallow: /p`, "NodaroCapture")
    expect(performance.now() - t0).toBeLessThan(250)
  })
})
