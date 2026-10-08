import { describe, expect, it } from "vitest"
import { durationText, pageAddress, perUser, positionText, siteDomainOf } from "../format"

describe("durationText", () => {
  it("seconds, then minutes and seconds, then hours and minutes", () => {
    expect(durationText(0)).toBe("0s")
    expect(durationText(42.4)).toBe("42s")
    expect(durationText(754)).toBe("12m 34s")
    expect(durationText(4000)).toBe("1h 06m")
  })
})

describe("perUser", () => {
  it("is a total divided by the people who came, and nothing when nobody came", () => {
    expect(perUser(300, 100)).toBe(3)
    expect(perUser(300, 0)).toBe(0)
  })
})

describe("positionText", () => {
  it("one decimal; a dash for a page that never showed", () => {
    expect(positionText(9.24)).toBe("9.2")
    expect(positionText(0)).toBe("–")
  })
})

describe("siteDomainOf", () => {
  it("reads the domain a Search Console site covers", () => {
    expect(siteDomainOf("sc-domain:nodaro.ai")).toBe("nodaro.ai")
    expect(siteDomainOf("https://www.nodaro.ai/")).toBe("nodaro.ai")
    expect(siteDomainOf("https://docs.example.com/")).toBe("docs.example.com")
    expect(siteDomainOf(null)).toBeNull()
  })
})

describe("pageAddress", () => {
  it("links the site's own pages, on the domain and its subdomains", () => {
    expect(pageAddress({ host: "nodaro.ai", path: "/docs" }, "nodaro.ai")).toBe("https://nodaro.ai/docs")
    expect(pageAddress({ host: "App.Nodaro.ai", path: "/" }, "nodaro.ai")).toBe("https://app.nodaro.ai/")
    expect(pageAddress({ host: "nodaro.ai", path: "//evil.com" }, "nodaro.ai")).toBe("https://nodaro.ai//evil.com")
  })

  it("never links a site name someone else sent GA", () => {
    // Each ends in ".nodaro.ai" as text, and each opens evil.com as a link.
    expect(pageAddress({ host: "evil.com#.nodaro.ai", path: "/" }, "nodaro.ai")).toBeNull()
    expect(pageAddress({ host: "evil.com?.nodaro.ai", path: "/" }, "nodaro.ai")).toBeNull()
    expect(pageAddress({ host: "evil.com/.nodaro.ai", path: "/" }, "nodaro.ai")).toBeNull()
    expect(pageAddress({ host: "evil.com\\.nodaro.ai", path: "/" }, "nodaro.ai")).toBeNull()
    expect(pageAddress({ host: "nodaro.ai.attacker.tld", path: "/" }, "nodaro.ai")).toBeNull()
    expect(pageAddress({ host: "evilnodaro.ai", path: "/" }, "nodaro.ai")).toBeNull()
    expect(pageAddress({ host: "x@evil.com", path: "/" }, "nodaro.ai")).toBeNull()
    expect(pageAddress({ host: "192.168.1.1", path: "/" }, "nodaro.ai")).toBeNull()
    expect(pageAddress({ host: "nodaro.ai", path: "evil" }, "nodaro.ai")).toBeNull()
    expect(pageAddress({ path: "/docs" }, "nodaro.ai")).toBeNull()
    expect(pageAddress({ host: "nodaro.ai", path: "/docs" }, null)).toBeNull()
  })
})
