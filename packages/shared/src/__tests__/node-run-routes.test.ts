import { describe, expect, it } from "vitest"
import {
  NODE_RUN_ROUTES,
  NODE_TYPES_WITHOUT_RUN_ROUTE,
  SOCIAL_POST_NODE_PLATFORM,
  SOCIAL_POST_NODE_TYPES,
  nodeRunRoute,
} from "../index.js"

describe("nodeRunRoute", () => {
  it("is POST /v1/<type> for a node that follows the convention", () => {
    expect(nodeRunRoute("generate-image")).toBe("/v1/generate-image")
    expect(nodeRunRoute("pro-3d-render")).toBe("/v1/pro-3d-render")
  })

  it("names the nested route of a node that does not", () => {
    expect(nodeRunRoute("llm-chat")).toBe("/v1/llm-chat/generate")
    expect(nodeRunRoute("image-to-text")).toBe("/v1/image-to-text/describe")
    expect(nodeRunRoute("video-composer")).toBe("/v1/scene-graph/generate")
    expect(nodeRunRoute("generate-3d-scene")).toBe("/v1/3d-scene/generate")
    expect(nodeRunRoute("suno-generate")).toBe("/v1/suno/generate")
    expect(nodeRunRoute("suno-voice")).toBe("/v1/suno/voice/generate")
    expect(nodeRunRoute("telegram-channel-feed")).toBe("/v1/telegram-channel/fetch")
    expect(nodeRunRoute("ugc-creator")).toBe("/v1/ugc/creator")
  })

  it("sends every social post node to the one publish route", () => {
    for (const type of SOCIAL_POST_NODE_TYPES) expect(nodeRunRoute(type)).toBe("/v1/social/publish")
  })

  it("is null for a node with no route of its own", () => {
    expect(nodeRunRoute("modify-image")).toBeNull()
    expect(nodeRunRoute("paint-mask")).toBeNull()
  })

  it("escapes a type that is not a plain slug", () => {
    expect(nodeRunRoute("a/b")).toBe("/v1/a%2Fb")
  })
})

describe("the node route tables", () => {
  it("list only routes that differ from the convention, under /v1/", () => {
    for (const [type, route] of Object.entries(NODE_RUN_ROUTES)) {
      expect(route.startsWith("/v1/"), type).toBe(true)
      expect(route, type).not.toBe(`/v1/${type}`)
    }
  })

  it("never list a type as both routed and route-less", () => {
    expect(Object.keys(NODE_RUN_ROUTES).filter((t) => t in NODE_TYPES_WITHOUT_RUN_ROUTE)).toEqual([])
  })

  it("say what to run instead for every route-less type", () => {
    for (const [type, hint] of Object.entries(NODE_TYPES_WITHOUT_RUN_ROUTE)) expect(hint.length, type).toBeGreaterThan(10)
  })

  it("give every per-platform social node its platform, and only those", () => {
    const perPlatform = [...SOCIAL_POST_NODE_TYPES].filter((t) => t !== "publish-social").sort()
    expect(Object.keys(SOCIAL_POST_NODE_PLATFORM).sort()).toEqual(perPlatform)
    expect(SOCIAL_POST_NODE_PLATFORM["x-post"]).toBe("x")
    expect(SOCIAL_POST_NODE_PLATFORM["youtube-upload"]).toBe("youtube")
  })
})
