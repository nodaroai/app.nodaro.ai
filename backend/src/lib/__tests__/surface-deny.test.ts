import { describe, it, expect, afterEach } from "vitest"
import {
  isNodeDenied,
  findDeniedNodeTypes,
  deniedNodeRejectionMessage,
  isModelDenied,
  filterDeniedModels,
} from "../surface-deny.js"
import { __resetSurfaceProfileCacheForTests } from "../surface-profile.js"

afterEach(() => {
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
})

describe("surface-deny — node deny reads the profile", () => {
  it("denies nothing by default", () => {
    expect(isNodeDenied("social-publish")).toBe(false)
    expect(findDeniedNodeTypes([{ type: "social-publish" }])).toEqual([])
  })

  it("denies the profile's nodes.deny (requires __resetSurfaceProfileCacheForTests)", () => {
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ nodes: { deny: ["social-publish"] } })
    __resetSurfaceProfileCacheForTests()
    expect(isNodeDenied("social-publish")).toBe(true)
    expect(findDeniedNodeTypes([{ type: "social-publish" }, { type: "generate-image" }])).toEqual([
      "social-publish",
    ])
  })

  it("message names the denied types", () => {
    expect(deniedNodeRejectionMessage(["social-publish"])).toMatch(/social-publish/)
  })
})

describe("surface-deny — model deny reads the profile", () => {
  it("denies nothing by default", () => {
    expect(isModelDenied("veo3")).toBe(false)
    expect(filterDeniedModels([{ id: "veo3" }, { id: "flux" }])).toEqual([{ id: "veo3" }, { id: "flux" }])
  })

  it("denies the profile's models.deny", () => {
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ models: { deny: ["veo3"] } })
    __resetSurfaceProfileCacheForTests()
    expect(isModelDenied("veo3")).toBe(true)
    expect(filterDeniedModels([{ id: "veo3" }, { id: "flux" }])).toEqual([{ id: "flux" }])
  })
})
