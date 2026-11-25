// @test-watches frontend/src/routes/*.tsx
/**
 * The availability answer (`GET /v1/surface/availability`) is loaded on every
 * page that runs a workflow outside the dashboard — a published app, its
 * embed, a shared presentation — the way the dashboard loads it, so their live
 * estimate prices what this install runs (a Nodaro Video Upscale node with no
 * mode in Sharp where Transparent cannot run) and not the static profile alone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const auth = vi.hoisted(() => ({ current: { user: null as null | { id: string }, loading: true } }))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => auth.current }))
vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({ authorization: "Bearer t" }) }))

import { useSurfaceAvailabilityLoader } from "../use-surface-availability-loader"
import { __resetSurfaceAvailabilityForTests, isModelModeUnavailable, surfaceAvailabilityLoaded } from "@/lib/surface-availability"
import { NODARO_VIDEO_UPSCALE_TRANSPARENT_MODE_ID } from "@nodaro/render-rules"

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ nodes: { denied: [] }, models: { denied: [], deniedModes: [NODARO_VIDEO_UPSCALE_TRANSPARENT_MODE_ID] } }), { status: 200 }))
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  __resetSurfaceAvailabilityForTests(null)
})

describe("useSurfaceAvailabilityLoader", () => {
  it("waits for auth, then loads the signed-in viewer's answer (with their auth) and the answer is read", async () => {
    auth.current = { user: null, loading: true }
    const { rerender } = renderHook(() => useSurfaceAvailabilityLoader())
    expect(fetchMock).not.toHaveBeenCalled()

    auth.current = { user: { id: "u1" }, loading: false }
    rerender()
    await waitFor(() => expect(surfaceAvailabilityLoaded()).toBe(true))
    expect(fetchMock).toHaveBeenCalledWith("/v1/surface/availability", { headers: { authorization: "Bearer t" } })
    expect(isModelModeUnavailable(NODARO_VIDEO_UPSCALE_TRANSPARENT_MODE_ID)).toBe(true)
  })

  it("asks nothing for a signed-out viewer (the route needs one), and drops a previous viewer's answer", () => {
    __resetSurfaceAvailabilityForTests({ nodes: [], models: [], modelModes: [NODARO_VIDEO_UPSCALE_TRANSPARENT_MODE_ID] })
    auth.current = { user: null, loading: false }
    renderHook(() => useSurfaceAvailabilityLoader())
    expect(fetchMock).not.toHaveBeenCalled()
    expect(surfaceAvailabilityLoaded()).toBe(false)
  })
})

describe("every page that runs a workflow outside the dashboard loads the answer", () => {
  const ROUTES = join(dirname(fileURLToPath(import.meta.url)), "../../routes")
  const runners = readdirSync(ROUTES)
    .filter((f) => f.endsWith(".tsx"))
    .filter((f) => /<(PresentationView|MobileAppShell)\b/.test(readFileSync(join(ROUTES, f), "utf8")))

  it("finds the runner pages", () => {
    expect(runners).toEqual(expect.arrayContaining(["app-runner-page.tsx", "embed-page.tsx", "present-page.tsx"]))
  })

  it.each(runners)("%s calls useSurfaceAvailabilityLoader()", (file) => {
    expect(readFileSync(join(ROUTES, file), "utf8")).toMatch(/\buseSurfaceAvailabilityLoader\(\)/)
  })
})
