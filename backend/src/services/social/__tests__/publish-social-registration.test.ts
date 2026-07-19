import { describe, it, expect } from "vitest"
import { SOCIAL_POST_NODE_TYPES } from "@nodaro/shared"
import { SYNC_HTTP_ROUTES } from "../../workflow-engine/node-executor.js"
import { NODE_REGISTRY } from "../../../lib/node-registry.js"

/**
 * The unified `publish-social` node must be registered everywhere the 7
 * per-platform nodes are, so the shared-set-driven routing (carousel, caption,
 * refMap) and the sync-HTTP dispatch cover it. Missing any one silently breaks
 * a run.
 */
describe("publish-social node registration", () => {
  it("is in the shared SOCIAL_POST_NODE_TYPES set (drives carousel/caption/refMap routing)", () => {
    expect(SOCIAL_POST_NODE_TYPES.has("publish-social")).toBe(true)
  })

  it("maps to the publish route in SYNC_HTTP_ROUTES", () => {
    expect(SYNC_HTTP_ROUTES["publish-social"]).toBe("/v1/social/publish")
  })

  it("has a NODE_REGISTRY descriptor (GET /v1/nodes discovery)", () => {
    const entry = NODE_REGISTRY.find((n) => n.type === "publish-social")
    expect(entry).toBeDefined()
    expect(entry?.category).toBe("output")
    expect(entry?.outputType).toBe("none")
  })
})
