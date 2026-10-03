/**
 * A capability that lives INSIDE another node shares the availability of the
 * dedicated node it duplicates.
 *
 * Web Scrape's Instagram source IS the Instagram node's capability (the same
 * scraper behind a different door). Withholding the Instagram node in Admin →
 * Availability must therefore withdraw that source too — otherwise the switch
 * closes one door and leaves the other open. One registry in surface-deny.ts
 * says which hosted capability is governed by which node; everything else
 * (the direct-route guard, the orchestrator's door, the publish rule, the list
 * the browser hides options by) derives from it.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest"

const checkIsAdmin = vi.fn<(userId: string) => Promise<boolean>>()
vi.mock("../admin-check.js", () => ({ checkIsAdmin: (userId: string) => checkIsAdmin(userId) }))

import {
  governingNodeType,
  availabilityChecksFor,
  findUnavailableCapabilities,
  findUnpublishableNodeTypes,
  findDeniedNodeTypes,
  effectiveDeniedWebScrapeSources,
  webScrapeSourcesHiddenFromUsers,
  ADMIN_VIEWER,
  USER_VIEWER,
} from "../surface-deny.js"
import { deniedCapabilityForUser, assertNodeAvailableForUser } from "../availability-viewer.js"
import { __resetSurfaceProfileCacheForTests } from "../surface-profile.js"
import {
  __resetAvailabilityOverridesForTests,
  __availabilityUniverseReadyForTests,
  GATEABLE_NODE_TYPES,
} from "../availability-override.js"

beforeAll(() => __availabilityUniverseReadyForTests())

/** The production shape: everything on except the two dedicated scraper nodes. */
function withholdInstagramNode(): void {
  const off = new Set(["instagram-scrape", "meta-ads-scrape"])
  __resetAvailabilityOverridesForTests({ nodes: new Set([...GATEABLE_NODE_TYPES].filter((t) => !off.has(t))) })
}

beforeEach(() => {
  checkIsAdmin.mockReset()
  checkIsAdmin.mockImplementation(async (id) => id === "admin-1")
})
afterEach(() => {
  __resetAvailabilityOverridesForTests()
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
})

const igSource = { id: "n1", type: "web-scrape", data: { actor: "instagram", target: "nasa" } }
const googleSource = { id: "n2", type: "web-scrape", data: { actor: "google-search", query: "nasa" } }

describe("the registry — which hosted capability is governed by which node", () => {
  it("Web Scrape's Instagram source is governed by the Instagram node; its other sources by nothing", () => {
    expect(governingNodeType("web-scrape", { actor: "instagram" })).toBe("instagram-scrape")
    for (const actor of ["google-search", "content-crawler", "tiktok", "rss"]) {
      expect(governingNodeType("web-scrape", { actor })).toBeUndefined()
    }
  })

  it("is inert for every other node, for junk data, and for prototype keys", () => {
    expect(governingNodeType("generate-image", { actor: "instagram" })).toBeUndefined()
    expect(governingNodeType("web-scrape", undefined)).toBeUndefined()
    expect(governingNodeType("web-scrape", { actor: 7 })).toBeUndefined()
    expect(governingNodeType("web-scrape", { actor: "constructor" })).toBeUndefined()
    expect(governingNodeType("constructor", { actor: "instagram" })).toBeUndefined()
  })

  it("a node raises its own availability question first, then the hosted capability's", () => {
    expect(availabilityChecksFor("web-scrape", { actor: "instagram" })).toEqual([
      { governedBy: "web-scrape", label: "web-scrape" },
      { governedBy: "instagram-scrape", label: "web-scrape:instagram" },
    ])
    expect(availabilityChecksFor("web-scrape", { actor: "rss" })).toEqual([{ governedBy: "web-scrape", label: "web-scrape" }])
  })
})

describe("withholding the Instagram node withdraws Web Scrape's Instagram source", () => {
  it("nothing is withdrawn while the node is released", () => {
    expect(findUnavailableCapabilities([igSource, googleSource], USER_VIEWER)).toEqual([])
    expect(effectiveDeniedWebScrapeSources(USER_VIEWER)).toEqual([])
    expect(webScrapeSourcesHiddenFromUsers()).toEqual([])
  })

  it("a user loses the source — and only that source; an admin keeps it", () => {
    withholdInstagramNode()
    expect(findUnavailableCapabilities([igSource, googleSource], USER_VIEWER)).toEqual(["web-scrape:instagram"])
    expect(findUnavailableCapabilities([igSource, googleSource], ADMIN_VIEWER)).toEqual([])
    expect(effectiveDeniedWebScrapeSources(USER_VIEWER)).toEqual(["instagram"])
    expect(effectiveDeniedWebScrapeSources(ADMIN_VIEWER)).toEqual([])
    expect(webScrapeSourcesHiddenFromUsers()).toEqual(["instagram"])
  })

  it("a PROFILE removal of the Instagram node withdraws the source from admins too", () => {
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ nodes: { deny: ["instagram-scrape"] } })
    __resetSurfaceProfileCacheForTests()
    expect(effectiveDeniedWebScrapeSources(ADMIN_VIEWER)).toEqual(["instagram"])
    expect(webScrapeSourcesHiddenFromUsers()).toEqual([])
  })

  it("withholding Web Scrape itself names the node, not the source", () => {
    __resetAvailabilityOverridesForTests({ nodes: new Set([...GATEABLE_NODE_TYPES].filter((t) => t !== "web-scrape")) })
    expect(findUnavailableCapabilities([igSource], USER_VIEWER)).toEqual(["web-scrape"])
  })

  it("the publish rule covers the source; the WRITE guard stays on node types", () => {
    withholdInstagramNode()
    // Publishing hands the thing to users, so it must be runnable by them.
    expect(findUnpublishableNodeTypes([igSource, googleSource])).toEqual(["web-scrape:instagram"])
    // Saving is not refused: a user's existing workflow must stay saveable while
    // they move off the source — the run is where it is refused.
    expect(findDeniedNodeTypes([igSource], USER_VIEWER)).toEqual([])
  })
})

describe("per-user questions (the direct-route guard and the orchestrator's door)", () => {
  it("names the withdrawn source for a user, nothing for an admin", async () => {
    withholdInstagramNode()
    expect(await deniedCapabilityForUser("web-scrape", { actor: "instagram" }, "user-1")).toBe("web-scrape:instagram")
    expect(await deniedCapabilityForUser("web-scrape", { actor: "instagram" }, "admin-1")).toBeUndefined()
    expect(await deniedCapabilityForUser("web-scrape", { actor: "instagram" }, undefined)).toBe("web-scrape:instagram")
  })

  it("asks nobody's role for a source that is not governed, or a node that is released", async () => {
    withholdInstagramNode()
    expect(await deniedCapabilityForUser("web-scrape", { actor: "google-search" }, "user-1")).toBeUndefined()
    __resetAvailabilityOverridesForTests()
    expect(await deniedCapabilityForUser("web-scrape", { actor: "instagram" }, "user-1")).toBeUndefined()
    expect(checkIsAdmin).not.toHaveBeenCalled()
  })

  it("the door throws the coded error naming the source, and resolves for an admin", async () => {
    withholdInstagramNode()
    await expect(assertNodeAvailableForUser("web-scrape", "user-1", { actor: "instagram" })).rejects.toMatchObject({
      code: "node_not_available",
      message: expect.stringContaining("web-scrape:instagram"),
    })
    await expect(assertNodeAvailableForUser("web-scrape", "admin-1", { actor: "instagram" })).resolves.toBeUndefined()
    await expect(assertNodeAvailableForUser("web-scrape", "user-1", { actor: "rss" })).resolves.toBeUndefined()
  })
})

describe("competitor scans follow Social Search", () => {
  function withholdSocialSearch(): void {
    __resetAvailabilityOverridesForTests({ nodes: new Set([...GATEABLE_NODE_TYPES].filter((t) => t !== "social-search")) })
  }

  it("a scan (the route's body, any shape) is governed by the Social Search node", () => {
    expect(governingNodeType("competitor-scan", { competitorId: "c1" })).toBe("social-search")
  })

  it("withholding Social Search withdraws scans from users, not from admins", async () => {
    withholdSocialSearch()
    expect(await deniedCapabilityForUser("competitor-scan", { competitorId: "c1" }, "user-1")).toBe("competitor-scan")
    expect(await deniedCapabilityForUser("competitor-scan", { competitorId: "c1" }, "admin-1")).toBeUndefined()
    __resetAvailabilityOverridesForTests()
    expect(await deniedCapabilityForUser("competitor-scan", { competitorId: "c1" }, "user-1")).toBeUndefined()
  })
})
