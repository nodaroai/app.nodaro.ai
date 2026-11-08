/**
 * Which node a credit-guarded route runs (lib/route-node-gate.ts) — the name
 * the credit guard asks the availability funnel about. It used to be the route
 * path minus `/v1/`, so a nested route was asked about under a name no
 * allowlist holds (`suno/generate`) and ran on a deployment that had withdrawn
 * its node. The whole-app totality lives in
 * src/__tests__/credit-guard-route-nodes.test.ts; these are the rules.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest"
import { NODE_RUN_ROUTES } from "@nodaro/shared/nodes"
import {
  routeNodeGate,
  isKnownNodeType,
  refusesUnclassifiedRoutes,
  PLUGIN_CREDIT_GUARDED_ROUTES,
} from "../route-node-gate.js"
import { __availabilityUniverseReadyForTests, ROUTE_GATES_GENERATION } from "../availability-override.js"
import { __resetSurfaceProfileCacheForTests } from "../surface-profile.js"

beforeAll(() => __availabilityUniverseReadyForTests())

afterEach(() => {
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
})

function nodeOf(route: string, body: unknown = {}) {
  const gate = routeNodeGate(route, body)
  if (gate.kind !== "node") throw new Error(`${route}: expected a node, got ${gate.kind}`)
  return gate
}

describe("routeNodeGate — a nested route runs the node it is the run of", () => {
  it("Suno's routes are its nodes, from the shared run-route contract", () => {
    expect(nodeOf("/v1/suno/generate").types).toEqual(["suno-generate"])
    expect(nodeOf("/v1/suno/voice/generate").types).toEqual(["suno-voice"])
    expect(nodeOf("/v1/suno/upload-extend").types).toEqual(["suno-upload-extend"])
  })

  it("every single-node run route in NODE_RUN_ROUTES resolves to its node", () => {
    const byRoute = new Map<string, string[]>()
    for (const [type, route] of Object.entries(NODE_RUN_ROUTES)) byRoute.set(route, [...(byRoute.get(route) ?? []), type])
    for (const [route, types] of byRoute) {
      const gate = routeNodeGate(route, {})
      expect(gate.kind, route).toBe("node")
      if (gate.kind !== "node") continue
      if (types.length === 1) expect(gate.types, route).toEqual(types)
    }
  })

  it("a run variant of a node follows the node: continue, stream, async job", () => {
    expect(nodeOf("/v1/tighten-episode/continue").types).toEqual(["tighten-episode"])
    expect(nodeOf("/v1/llm-chat/generate-stream").types).toEqual(["llm-chat"])
    expect(nodeOf("/v1/generate-video-pro/continue").types).toEqual(["generate-video-pro"])
    expect(nodeOf("/v1/voice-changer-pro/translate").types).toEqual(["voice-changer-pro"])
  })

  it("Nodaro Motion's routes and the trend run's engine follow cast-swap", () => {
    expect(nodeOf("/v1/cast-swap").types).toEqual(["cast-swap"])
    expect(nodeOf("/v1/cast-swap/:jobId/full-quality").types).toEqual(["cast-swap"])
    expect(nodeOf("/v1/video-face-mesh").types).toEqual(["cast-swap"])
  })

  it("a route parameter's name does not matter", () => {
    expect(nodeOf("/v1/cast-swap/:id/full-quality").types).toEqual(["cast-swap"])
    expect(nodeOf("/v1/characters/:characterId/llm-caption").types).toEqual(["character"])
  })
})

describe("routeNodeGate — a route several nodes run resolves from the body", () => {
  it("Edit Image is Upscale, Remove Background or Modify Image by provider", () => {
    expect(nodeOf("/v1/edit-image", {}).types).toEqual(["upscale-image"])
    expect(nodeOf("/v1/edit-image", { provider: "topaz-image-upscale" }).types).toEqual(["upscale-image"])
    expect(nodeOf("/v1/edit-image", { provider: "recraft-remove-bg" }).types).toEqual(["remove-background"])
    expect(nodeOf("/v1/edit-image", { provider: "nano-banana-edit" }).types).toEqual(["modify-image"])
    expect(nodeOf("/v1/edit-image", { provider: "grok-2-edit" }).types).toEqual(["modify-image"])
    expect(nodeOf("/v1/image-to-image").types).toEqual(["modify-image"])
  })

  it("Publish to Social is the platform's own post node OR the unified node", () => {
    expect(nodeOf("/v1/social/publish", { platform: "instagram" }).types).toEqual(["instagram-post", "publish-social"])
    expect(nodeOf("/v1/social/publish", { platform: "youtube" }).types).toEqual(["youtube-upload", "publish-social"])
    // A platform only the unified node publishes to.
    expect(nodeOf("/v1/social/publish", { platform: "threads" }).types).toEqual(["publish-social"])
  })
})

describe("routeNodeGate — generations", () => {
  it("a route the path derivation already named keeps generation 0 (no stored override is re-read for it)", () => {
    expect(nodeOf("/v1/generate-image").since).toBe(0)
    expect(nodeOf("/v1/cast-swap").since).toBe(0)
    expect(nodeOf("/v1/voice-changer-pro").since).toBe(0)
  })

  it("a route that follows its node only since route gating is a newer door", () => {
    expect(nodeOf("/v1/suno/generate").since).toBe(ROUTE_GATES_GENERATION)
    expect(nodeOf("/v1/edit-image", { provider: "nano-banana-edit" }).since).toBe(ROUTE_GATES_GENERATION)
    expect(nodeOf("/v1/generate-character").since).toBe(ROUTE_GATES_GENERATION)
  })
})

describe("routeNodeGate — what is no node", () => {
  it("a documented exemption says why", () => {
    const gate = routeNodeGate("/v1/copilot/threads/:id/messages", {})
    expect(gate.kind).toBe("exempt")
    if (gate.kind === "exempt") expect(gate.reason).toMatch(/copilot/i)
  })

  it("a route no table and no node names is unclassified, nested or not", () => {
    expect(routeNodeGate("/v1/brand-new/thing", {}).kind).toBe("unclassified")
    expect(routeNodeGate("/v1/not-a-node-type", {}).kind).toBe("unclassified")
  })

  it("an unclassified route is refused only under a nodes.allow whitelist", () => {
    expect(refusesUnclassifiedRoutes()).toBe(false)
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ nodes: { deny: ["suno-generate"] } })
    __resetSurfaceProfileCacheForTests()
    expect(refusesUnclassifiedRoutes()).toBe(false)
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ nodes: { allow: ["generate-image"] } })
    __resetSurfaceProfileCacheForTests()
    expect(refusesUnclassifiedRoutes()).toBe(true)
  })
})

describe("routeNodeGate — the Cloud plugin's credit-guarded routes", () => {
  it("every one resolves to a node the availability funnel knows", () => {
    for (const route of PLUGIN_CREDIT_GUARDED_ROUTES) {
      const gate = routeNodeGate(route, {})
      expect(gate.kind, route).toBe("node")
      if (gate.kind === "node") for (const t of gate.types) expect(isKnownNodeType(t), `${route} → ${t}`).toBe(true)
    }
  })

  it("Recast's routes follow Generate Video Pro, the render they produce", () => {
    expect(nodeOf("/v1/recast").types).toEqual(["generate-video-pro"])
    expect(nodeOf("/v1/recast/:id/continue").types).toEqual(["generate-video-pro"])
  })

  it("a competitor scan is the governed host type (Social Search answers for it)", () => {
    expect(nodeOf("/v1/competitor-scan").types).toEqual(["competitor-scan"])
    expect(isKnownNodeType("competitor-scan")).toBe(true)
  })
})
