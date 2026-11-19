import { describe, it, expect, vi } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"
import {
  REFINE_FROM_VIDEO_REMOVED_CODE,
  REFINE_FROM_VIDEO_REMOVED_MCP_MESSAGE,
} from "../../../entity-motion-refine.js"

vi.mock("../../../supabase.js", () => ({
  supabase: { from: vi.fn() },
}))

vi.mock("../../../config.js", () => ({
  config: { INTERNAL_ORCHESTRATOR_SECRET: "test-secret", PUBLIC_URL: "" },
  hasCredits: () => true,
  hasAdmin: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
}))

const { registerLocationTools } = await import("../locations.js")
const { registerObjectTools } = await import("../objects.js")
const { registerCreatureTools } = await import("../creatures.js")

/**
 * `refine_from_video_url` is not an argument of the three entity motion
 * tools. A call that still passes it is refused by the tool itself: dropped
 * as an unknown argument, it would reach the route as a plain image-to-video
 * request and be charged for a run the caller did not ask for.
 */
const TOOLS = [
  { tool: "generate_location_motion", route: "/v1/generate-location-motion", register: registerLocationTools },
  { tool: "generate_object_motion", route: "/v1/generate-object-motion", register: registerObjectTools },
  { tool: "generate_creature_motion", route: "/v1/generate-creature-motion", register: registerCreatureTools },
] as const

function executeSession() {
  return newSession({
    userId: "u1",
    scopes: ["assets:read", "assets:write", "workflows:execute"] as Scope[],
    clientName: "Claude",
  })
}

const ARGS = {
  motion_prompt: "same shot, slower",
  source_image_url: "https://example.com/still.png",
  name: "Subject",
}

describe.each(TOOLS)("$tool and refine_from_video_url", ({ tool, route, register }) => {
  function serverWithRoute() {
    const fastify = Fastify()
    const routeCalls = vi.fn()
    fastify.post(route, async (req) => {
      routeCalls(req.body)
      return { jobId: "job-1" }
    })
    const server = buildServer()
    register({ server, session: executeSession(), fastify })
    return { server, routeCalls }
  }

  it("refuses the call before its route is reached: nothing is reserved, charged or queued", async () => {
    const { server, routeCalls } = serverWithRoute()
    const result = await callTool(server, tool, { ...ARGS, refine_from_video_url: "https://example.com/clip.mp4" })

    expect(result.isError).toBe(true)
    const text = result.content[0]?.text ?? ""
    expect(text).toContain(REFINE_FROM_VIDEO_REMOVED_MCP_MESSAGE)
    expect(text).toContain(REFINE_FROM_VIDEO_REMOVED_CODE)
    expect(text).toContain("video_remake")
    expect(result.structuredContent?.jobId).toBeUndefined()
    // The route is where credits are reserved and the job is queued.
    expect(routeCalls).not.toHaveBeenCalled()
  })

  it("does not list the argument", async () => {
    const { server } = serverWithRoute()
    const listed = (await listTools(server)).find((t) => t.name === tool)
    const properties = (listed?.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}
    expect(Object.keys(properties)).not.toContain("refine_from_video_url")
    expect(Object.keys(properties)).toContain("source_image_url")
  })

  it("runs a call without it as before", async () => {
    const { server, routeCalls } = serverWithRoute()
    const result = await callTool(server, tool, ARGS)

    expect(result.isError).toBeUndefined()
    expect(result.structuredContent?.jobId).toBe("job-1")
    expect(routeCalls).toHaveBeenCalledTimes(1)
    expect(routeCalls.mock.calls[0][0]).not.toHaveProperty("refineFromVideoUrl")
  })
})
