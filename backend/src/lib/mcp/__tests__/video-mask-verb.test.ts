import { describe, it, expect, vi, beforeEach } from "vitest"
import { _resetRegistry } from "../tasks.js"
import { buildServer, callTool, executeSession, stubRoute } from "../tools/__tests__/_helpers.js"

/**
 * `video_mask` maps its snake_case args onto the route's camelCase body:
 * `per_shot` → `perShot`, `redetect_every_sec` → `redetectEverySec`, `zone.{left,right,top,bottom}_pct` →
 * `zone.{left,right,top,bottom}Pct`; an arg left out is not sent (the route's
 * default applies), and neither is a zone with no margin (`{}`).
 */

vi.mock("../../supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
          single: async () => ({ data: { mcp_preferences: {} }, error: null }),
        }),
      }),
    }),
  },
}))

const { registerVideoMaskVerbs } = await import("../tools/verbs-video-mask.js")

beforeEach(() => {
  _resetRegistry()
})

function setup() {
  const { fastify, received } = stubRoute("POST", "/v1/video-mask", { jobId: "j-1" })
  const server = buildServer()
  registerVideoMaskVerbs({ server, session: executeSession(), fastify })
  return { server, received }
}

const base = { video_url: "https://cdn.nodaro.ai/videos/clip.mp4", prompt: "face" }

describe("video_mask per_shot and zone", () => {
  it("sends perShot and the zone margins in the route's names", async () => {
    const { server, received } = setup()
    const res = await callTool(server, "video_mask", { ...base, per_shot: true, zone: { left_pct: 10, right_pct: 12, top_pct: 5 } })
    expect(res.isError, JSON.stringify(res.content)).toBeFalsy()
    expect(received.body).toMatchObject({ perShot: true, zone: { leftPct: 10, rightPct: 12, topPct: 5 } })
    expect(received.body?.zone).not.toHaveProperty("bottomPct")
  })

  it("sends neither when they are not given", async () => {
    const { server, received } = setup()
    await callTool(server, "video_mask", base)
    expect(received.body).not.toHaveProperty("perShot")
    expect(received.body).not.toHaveProperty("zone")
  })

  it("drops an empty zone ({}): off, as when it is left out", async () => {
    const { server, received } = setup()
    const res = await callTool(server, "video_mask", { ...base, zone: {} })
    expect(res.isError, JSON.stringify(res.content)).toBeFalsy()
    expect(received.body).toBeDefined()
    expect(received.body).not.toHaveProperty("zone")
  })

  it("refuses a margin above 49 and dispatches nothing", async () => {
    const { server, received } = setup()
    const res = await callTool(server, "video_mask", { ...base, zone: { left_pct: 60 } })
    expect(res.isError).toBe(true)
    expect(received.body).toBeUndefined()
  })
})

describe("video_mask redetect_every_sec", () => {
  it("sends redetectEverySec in the route's name, beside perShot or alone", async () => {
    for (const args of [{ redetect_every_sec: 1 }, { redetect_every_sec: 2.5, per_shot: true }, { redetect_every_sec: 0 }]) {
      const { server, received } = setup()
      const res = await callTool(server, "video_mask", { ...base, ...args })
      expect(res.isError, JSON.stringify(res.content)).toBeFalsy()
      expect(received.body).toMatchObject({ redetectEverySec: args.redetect_every_sec })
    }
  })

  it("is not sent when left out (the route's default, 0 = off, applies)", async () => {
    const { server, received } = setup()
    await callTool(server, "video_mask", base)
    expect(received.body).not.toHaveProperty("redetectEverySec")
  })

  it("refuses a value between 0 and 1 s or past 10 s, and dispatches nothing", async () => {
    for (const v of [0.5, 11, -1]) {
      const { server, received } = setup()
      const res = await callTool(server, "video_mask", { ...base, redetect_every_sec: v })
      expect(res.isError).toBe(true)
      expect(received.body).toBeUndefined()
    }
  })
})
