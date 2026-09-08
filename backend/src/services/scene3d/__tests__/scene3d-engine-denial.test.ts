import { beforeEach, describe, expect, it, vi } from "vitest"
import type { FastifyReply, FastifyRequest } from "fastify"

const state = vi.hoisted(() => ({ denied: new Set<string>(), capabilities: vi.fn(), generate: vi.fn(), edit: vi.fn(), proRender: vi.fn(), quoteProRender: vi.fn() }))
vi.mock("@/lib/config.js", () => ({ config: { SCENE3D_ADVANCED_ENABLED: true, SCENE3D_LOCAL_ENABLED: false }, hasCredits: () => true }))
vi.mock("@/lib/private-plugins/engine-registry.js", () => ({ getPluginEngines: () => ({ scene3d: state }) }))
vi.mock("@/lib/surface-deny.js", () => ({ isNodeDenied: (type: string) => state.denied.has(type), deniedNodeRejectionMessage: (types: string[]) => `Unavailable: ${types.join(", ")}` }))
vi.mock("@/lib/http-errors.js", () => ({
  sendInternalError: vi.fn(),
  __flushHttpErrorTelemetry: vi.fn(),
  __resetHttpErrorTelemetry: vi.fn(),
}))

import { dispatchAdvancedScene3D, dispatchPro3DRender, dispatchPro3DRenderQuote, scene3DProAvailable } from "../scene3d-engine.js"

beforeEach(() => {
  vi.clearAllMocks()
  state.denied.clear()
  state.capabilities.mockResolvedValue({ engines: ["blender-cloud"] })
})

const request = { userId: "user", body: { engine: "blender-cloud" } } as FastifyRequest
function reply() {
  const value = { status: vi.fn(), send: vi.fn(), sent: false }
  value.status.mockReturnValue(value)
  return value
}

describe("Advanced scene deployment policy", () => {
  it.each(["generate", "edit"] as const)("refuses denied %s before engine admission", async (operation) => {
    state.denied.add(`${operation}-3d-scene`)
    const response = reply()
    await dispatchAdvancedScene3D(operation, request, response as unknown as FastifyReply)
    expect(response.status).toHaveBeenCalledWith(403)
    expect(response.send).toHaveBeenCalledWith({ error: { code: "node_not_available", message: `Unavailable: ${operation}-3d-scene` } })
    expect(state.capabilities).not.toHaveBeenCalled()
    expect(state[operation]).not.toHaveBeenCalled()
  })

  it("does not deny a permitted operation because the other node is disabled", async () => {
    state.denied.add("generate-3d-scene")
    const response = reply()
    await dispatchAdvancedScene3D("edit", request, response as unknown as FastifyReply)
    expect(state.edit).toHaveBeenCalledWith(request, response)
    expect(response.status).not.toHaveBeenCalledWith(403)
  })

  it("hides denied Pro and refuses both direct dispatch methods", async () => {
    expect(scene3DProAvailable()).toBe(true)
    state.denied.add("pro-3d-render")
    expect(scene3DProAvailable()).toBe(false)
    for (const dispatch of [dispatchPro3DRender, dispatchPro3DRenderQuote]) {
      const response = reply()
      await dispatch(request, response as unknown as FastifyReply)
      expect(response.status).toHaveBeenCalledWith(403)
    }
    expect(state.proRender).not.toHaveBeenCalled()
    expect(state.quoteProRender).not.toHaveBeenCalled()
  })
})
